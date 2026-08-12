'use strict';

/**
 * Mesin migrasi generik.
 *
 * Semua migrator di migrators/*.js cukup menyediakan fungsi transform() untuk
 * satu dokumen. Urusan paging Firestore, batching, potong nilai kepanjangan,
 * checkpoint, retry per baris, dan laporan ditangani di sini.
 */

const { streamCollection } = require('../firebase/firebase');
const db = require('../database/mysql');
const state = require('./state');
const log = require('./logger');
const { Report } = require('./report');
const { truncate } = require('./transform');
const { COLUMNS, TABLES, PRIMARY_KEYS, NO_TRUNCATE } = require('../config/mapping');
const { effectiveMaxLengths } = require('./schema-check');
const { MigrationBlocked } = require('./blockers');

/** Perkiraan ukuran satu baris dalam byte, untuk menjaga max_allowed_packet. */
function rowBytes(row) {
  let n = 0;
  for (const v of row) {
    if (v === null || v === undefined) n += 4;
    else if (typeof v === 'number') n += 8;
    else n += Buffer.byteLength(String(v), 'utf8') + 3;
  }
  return n;
}

/**
 * @param {object} migrator  modul dari migrators/
 * @param {object} ctx       konteks bersama (opsi, firestore, resolver, dll)
 */
async function runMigrator(migrator, ctx) {
  const { options } = ctx;
  const tableKey = migrator.tableKey;
  const table = TABLES[tableKey];
  const collection = migrator.collection;
  const mapped = COLUMNS[tableKey];

  const report = new Report(migrator.name);
  ctx.report = report;

  log.title(`${migrator.name.toUpperCase()}   ${collection} -> ${table}`);

  // --- Kolom fisik yang akan ditulis --------------------------------------
  const logicalKeys = Object.keys(mapped).filter((k) => mapped[k] !== null);
  const physicalCols = logicalKeys.map((k) => mapped[k]);
  const pkPhysical = (PRIMARY_KEYS[tableKey] || []).map((k) => mapped[k]).filter(Boolean);
  const maxLengths = effectiveMaxLengths(tableKey, (ctx.schemas || {})[tableKey]);
  const noTruncate = new Set(NO_TRUNCATE[tableKey] || []);

  // --- Batch & checkpoint --------------------------------------------------
  const batchSize = migrator.batchSize ? migrator.batchSize(options) : options.batchSize;
  const maxBatchBytes = migrator.maxBatchBytes || 3 * 1024 * 1024; // 3 MB, aman untuk shared hosting

  let startAfter = null;
  if (options.resume) {
    const cp = state.getCheckpoint(migrator.name);
    if (cp && cp.lastDocId) {
      startAfter = cp.lastDocId;
      log.info(`Melanjutkan dari checkpoint: setelah dokumen "${startAfter}" (${cp.written} baris sudah masuk)`);
      report.written = cp.written || 0;
    }
  } else {
    state.clearCheckpoint(migrator.name);
  }

  if (migrator.prepare) await migrator.prepare(ctx);

  // --- Loop utama ----------------------------------------------------------
  let buffer = [];
  let bufferBytes = 0;
  let lastDocId = startAfter;
  const seenIds = new Set();

  async function flush() {
    if (!buffer.length) return;

    const rows = buffer.map((b) => b.row);
    const ids = buffer.map((b) => b.id);

    if (options.dryRun) {
      report.written += rows.length;
    } else {
      const { written, failed } = await db.bulkWriteSafe(table, physicalCols, rows, {
        mode: options.mode,
        pkColumns: pkPhysical,
      });

      report.written += written;

      for (const f of failed) {
        const idIndex = physicalCols.indexOf(mapped.id);
        const docId = idIndex >= 0 ? f.row[idIndex] : '(?)';
        report.fail(docId, f.error);
      }

      state.setCheckpoint(migrator.name, {
        lastDocId: ids[ids.length - 1],
        written: report.written,
      });
    }

    buffer = [];
    bufferBytes = 0;
  }

  const stream = streamCollection(ctx.firestore, collection, {
    pageSize: Math.min(batchSize, 1000),
    startAfter,
    limit: options.limit,
  });

  for await (const doc of stream) {
    report.read += 1;
    lastDocId = doc.id;

    let result;
    try {
      result = migrator.transform(doc, ctx);
    } catch (e) {
      // Blocker bukan kesalahan satu dokumen, melainkan alasan untuk berhenti.
      // Kalau ikut ditelan jadi "skip", migrasi akan lanjut seolah tidak ada
      // apa-apa dan datanya hilang tanpa ada yang tahu.
      if (e instanceof MigrationBlocked) throw e;
      report.skip(doc.id, `error transform: ${e.message}`);
      continue;
    }

    if (!result || result.skip) {
      report.skip(doc.id, (result && result.skip) || 'transform mengembalikan kosong');
      continue;
    }

    const record = result.record;

    // Id duplikat di dalam satu batch bikin ON DUPLICATE KEY UPDATE tidak
    // deterministik — ambil yang pertama, catat sisanya.
    const idValue = String(record.id);
    if (seenIds.has(idValue)) {
      report.skip(doc.id, 'id duplikat di dalam collection');
      continue;
    }
    seenIds.add(idValue);

    // Potong nilai yang melebihi panjang kolom -- kecuali kolom yang ada di
    // NO_TRUNCATE, yang justru menghentikan migrasi.
    const row = logicalKeys.map((key) => {
      let value = record[key] === undefined ? null : record[key];
      const max = maxLengths[key];

      if (max && typeof value === 'string' && value.length > max) {
        if (noTruncate.has(key)) {
          ctx.blockers.add({
            collection: migrator.name,
            docId: doc.id,
            field: key,
            message:
              `panjangnya ${value.length} karakter, sedangkan kolom ${mapped[key]} ` +
              `hanya menampung ${max}`,
            hint:
              `Kolom ${table}.${mapped[key]} tidak boleh dipotong otomatis. ` +
              'Rapikan datanya di Firestore, atau putuskan bersama apakah kolomnya ' +
              'perlu diperlebar -- kalau diperlebar, catat ALTER-nya di berkas SQL ' +
              'tersendiri di Backend/ seperti 05_widen_sn.sql.',
            contoh: value.length > 120 ? `${value.slice(0, 117)}...` : value,
          });
        } else {
          report.warn(doc.id, key, `dipotong dari ${value.length} ke ${max} karakter`);
          value = truncate(value, max).value;
        }
      }

      return value;
    });

    const size = rowBytes(row);
    if (buffer.length && (buffer.length >= batchSize || bufferBytes + size > maxBatchBytes)) {
      await flush();
    }

    buffer.push({ id: doc.id, row });
    bufferBytes += size;

    if (report.read % 100 === 0) {
      log.progress(`${migrator.name}: dibaca ${report.read}, ditulis ${report.written}...`);
    }
  }

  await flush();
  log.progressDone();

  if (migrator.finalize) await migrator.finalize(ctx);

  if (!options.dryRun) state.clearCheckpoint(migrator.name);

  // --- Ringkasan -----------------------------------------------------------
  const s = report.summary();
  log.ok(
    `${s.read} dokumen dibaca, ${s.written} baris ${options.dryRun ? 'siap ditulis (dry-run)' : 'masuk'} ` +
      `dalam ${s.durationSec}s`
  );

  if (s.skipped) {
    log.warn(`${s.skipped} dokumen dilewati:`);
    for (const [reason, count] of report.skipBreakdown().slice(0, 8)) {
      log.detail(`${count}x  ${reason}`);
    }
  }
  if (s.warnings) log.warn(`${s.warnings} nilai dikoreksi (lihat file laporan)`);
  if (s.failed) log.error(`${s.failed} baris ditolak MariaDB (lihat file laporan)`);

  const file = report.save(ctx.stamp);
  if (file) log.detail(`Laporan: ${file}`);

  return report;
}

module.exports = { runMigrator };
