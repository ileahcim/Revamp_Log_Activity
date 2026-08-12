'use strict';

/**
 * Preflight: cocokkan config/mapping.js dengan struktur tabel yang benar-benar
 * ada di MariaDB, SEBELUM satu baris pun ditulis.
 *
 * Tujuannya supaya kesalahan nama kolom ketahuan dalam 2 detik, bukan setelah
 * 30.000 baris masuk setengah jalan.
 */

const db = require('../database/mysql');
const { TABLES, COLUMNS, PRIMARY_KEYS } = require('../config/mapping');
const log = require('./logger');

/**
 * @param {string[]} tableKeys  kunci tabel di mapping (users, tech_logs, ...)
 * @returns {Promise<{ ok: boolean, problems: string[], notes: string[], schemas: object }>}
 */
async function checkSchema(tableKeys) {
  const problems = [];
  const notes = [];
  const schemas = {};

  const existingTables = await db.listTables();

  for (const key of tableKeys) {
    const table = TABLES[key];

    if (!existingTables.includes(table)) {
      problems.push(
        `Tabel "${table}" tidak ada di database ${process.env.DB_NAME}.\n` +
          `      Tabel yang ada: ${existingTables.join(', ') || '(kosong)'}`
      );
      continue;
    }

    const cols = await db.describeTable(table);
    schemas[key] = cols;

    const actual = new Map(cols.map((c) => [c.name, c]));
    const mapped = COLUMNS[key];

    // 1. Kolom yang ditulis oleh migrator tapi tidak ada di tabel.
    const missing = [];
    for (const [logical, physical] of Object.entries(mapped)) {
      if (physical === null) continue;
      if (!actual.has(physical)) missing.push({ logical, physical });
    }

    if (missing.length) {
      problems.push(
        `Tabel "${table}": kolom berikut ada di config/mapping.js tapi TIDAK ADA di database:\n` +
          missing.map((m) => `        - ${m.physical}   (field logis: ${m.logical})`).join('\n') +
          `\n      Kolom asli tabel ini: ${cols.map((c) => c.name).join(', ')}` +
          `\n      -> Perbaiki nama di config/mapping.js bagian COLUMNS.${key}`
      );
    }

    // 2. Kolom NOT NULL tanpa default yang tidak diisi migrator -> pasti error.
    const willWrite = new Set(Object.values(mapped).filter(Boolean));
    const unfilled = cols.filter(
      (c) =>
        !willWrite.has(c.name) &&
        !c.nullable &&
        c.default === null &&
        !/auto_increment/i.test(c.extra || '') &&
        !/^(CURRENT_TIMESTAMP|current_timestamp)/.test(String(c.default || '')) &&
        !/DEFAULT_GENERATED|on update/i.test(c.extra || '')
    );

    if (unfilled.length) {
      problems.push(
        `Tabel "${table}": kolom NOT NULL berikut tidak diisi migrator dan tidak punya DEFAULT:\n` +
          unfilled.map((c) => `        - ${c.name} (${c.type})`).join('\n') +
          `\n      -> Tambahkan pemetaannya di config/mapping.js, atau beri DEFAULT di tabel.`
      );
    }

    // 3. Info: kolom tabel yang dibiarkan kosong (biasanya wajar, misal updated_at).
    const untouched = cols.filter((c) => !willWrite.has(c.name)).map((c) => c.name);
    if (untouched.length) {
      notes.push(`${table}: kolom tidak diisi migrasi -> ${untouched.join(', ')}`);
    }

    // 4. Primary key di mapping harus benar (dipakai ON DUPLICATE KEY UPDATE).
    const realPk = cols.filter((c) => c.key === 'PRI').map((c) => c.name);
    const mappedPk = (PRIMARY_KEYS[key] || []).map((p) => mapped[p]).filter(Boolean);
    if (realPk.length && mappedPk.length && realPk.join(',') !== mappedPk.join(',')) {
      notes.push(
        `${table}: PRIMARY KEY di database = [${realPk.join(', ')}], ` +
          `di mapping = [${mappedPk.join(', ')}]. Cek PRIMARY_KEYS di config/mapping.js.`
      );
    }

    // 5. Selaraskan MAX_LENGTHS dengan panjang kolom sebenarnya.
    for (const [logical, physical] of Object.entries(mapped)) {
      if (!physical) continue;
      const col = actual.get(physical);
      if (!col || !col.maxLength) continue;
      const configured = (require('../config/mapping').MAX_LENGTHS[key] || {})[logical];
      if (configured && configured > col.maxLength) {
        notes.push(
          `${table}.${physical}: MAX_LENGTHS ${configured} > panjang asli ${col.maxLength}, ` +
            `dipakai ${col.maxLength}.`
        );
      }
    }
  }

  return { ok: problems.length === 0, problems, notes, schemas };
}

/**
 * Preflight kedua: isi tabel master dan akun penampung.
 *
 * Struktur tabel yang benar belum cukup. Migrasi juga bergantung pada isi:
 * setiap user butuh division_id yang sah, dan setiap tech_log yang tidak
 * ketemu pemiliknya butuh akun penampung. Keduanya berasal dari skrip SQL di
 * folder Backend/ yang gampang terlewat urutannya.
 *
 * @param {import('./master-resolver').MasterResolver} master  sudah di-load()
 * @param {string} legacyUserId
 * @returns {Promise<string[]>} daftar masalah, kosong berarti aman
 */
async function checkReferenceData(master, legacyUserId) {
  const problems = master.problems();

  const c = COLUMNS.users;
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM ${db.escapeId(TABLES.users)} WHERE ${db.escapeId(c.id)} = ?`,
    [legacyUserId]
  );

  if (!Number(rows[0].n)) {
    problems.push(
      `Akun penampung "${legacyUserId}" tidak ada di tabel users.\n` +
        '      Semua tech_log yang tidak ketemu pemiliknya diarahkan ke sana, dan\n' +
        '      tech_logs.user_id bertipe NOT NULL dengan FK ke users.\n' +
        '      -> Jalankan Backend/04_legacy_user.sql.'
    );
  }

  return problems;
}

/**
 * Ambil panjang VARCHAR sebenarnya dari database dan gabungkan dengan
 * MAX_LENGTHS di mapping (yang lebih kecil menang). Dipakai runner untuk
 * memotong nilai kepanjangan alih-alih menggagalkan batch.
 */
function effectiveMaxLengths(tableKey, schemaColumns) {
  const { COLUMNS: cols, MAX_LENGTHS } = require('../config/mapping');
  const mapped = cols[tableKey];
  const configured = MAX_LENGTHS[tableKey] || {};
  const byName = new Map((schemaColumns || []).map((c) => [c.name, c]));
  const out = {};

  for (const [logical, physical] of Object.entries(mapped)) {
    if (!physical) continue;
    const col = byName.get(physical);
    const fromDb = col && col.maxLength ? Number(col.maxLength) : null;
    const fromConfig = configured[logical] || null;
    const candidates = [fromDb, fromConfig].filter((n) => typeof n === 'number' && n > 0);
    if (candidates.length) out[logical] = Math.min(...candidates);
  }

  return out;
}

function printResult(result) {
  for (const note of result.notes) log.detail(note);

  if (result.ok) {
    log.ok('Struktur tabel cocok dengan config/mapping.js');
    return;
  }

  log.blank();
  log.error('Struktur tabel TIDAK cocok dengan config/mapping.js:');
  for (const p of result.problems) {
    console.error(`\n   ${log.color.yellow('*')} ${p}`);
  }
  log.blank();
  log.info('Jalankan `npm run inspect:schema` untuk melihat struktur tabel lengkap.');
}

module.exports = { checkSchema, checkReferenceData, effectiveMaxLengths, printResult };
