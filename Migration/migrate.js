'use strict';

/**
 * ===========================================================================
 *  MIGRATION TOOL  -  Log Activity
 *  Firebase Firestore  ->  MariaDB (Hostinger)
 * ===========================================================================
 *
 *  Firestore diperlakukan READ ONLY. Tool ini tidak pernah menulis, mengubah,
 *  atau menghapus apa pun di Firebase (dikunci di firebase/firebase.js).
 *
 *  Urutan migrasi (karena FK dan ukuran data):
 *      1. users          -> dipakai sebagai tujuan FK tiga tabel lain
 *      2. bug_reports    -> paling sedikit, sekaligus uji coba koneksi
 *      3. audit_logs
 *      4. tech_logs      -> paling besar, dijalankan terakhir
 *
 *  Cara pakai:
 *      npm run check                  cek koneksi + kecocokan struktur tabel
 *      npm run dry                    simulasi penuh, tidak menulis ke DB
 *      npm run migrate                migrasi sungguhan
 *      npm run verify                 bandingkan jumlah data Firestore vs MariaDB
 *
 *      node migrate.js --only=users
 *      node migrate.js --only=tech_logs --limit=100 --dry-run
 *      node migrate.js --resume       lanjutkan dari checkpoint terakhir
 *      node migrate.js --mode=ignore  lewati baris yang id-nya sudah ada
 *      node migrate.js --yes          jalan tanpa konfirmasi
 */

require('dotenv').config();

const readline = require('readline');

const db = require('./database/mysql');
const { connectFirestore, countCollection } = require('./firebase/firebase');
const { checkSchema, checkReferenceData, printResult } = require('./lib/schema-check');
const { UserResolver, DEFAULT_LEGACY_USER_ID } = require('./lib/user-resolver');
const { MasterResolver } = require('./lib/master-resolver');
const { NikAllocator } = require('./lib/nik-allocator');
const { Blockers, MigrationBlocked } = require('./lib/blockers');
const { runMigrator } = require('./lib/runner');
const { toMysqlDateTime } = require('./lib/transform');
const { TABLES } = require('./config/mapping');
const state = require('./lib/state');
const log = require('./lib/logger');

const MIGRATORS = [
  require('./migrators/users'),
  require('./migrators/bug_reports'),
  require('./migrators/audit_logs'),
  require('./migrators/tech_logs'),
].sort((a, b) => a.order - b.order);

// ---------------------------------------------------------------------------
// Argumen CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = new Set();
  const values = {};

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [rawKey, rawValue] = arg.slice(2).split('=');
    if (rawValue === undefined) flags.add(rawKey);
    else values[rawKey] = rawValue;
  }

  const envInt = (key, fallback) => {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const only = values.only
    ? values.only.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const mode = values.mode || process.env.WRITE_MODE || 'upsert';
  if (!['insert', 'ignore', 'upsert'].includes(mode)) {
    throw new Error(`--mode tidak dikenal: "${mode}" (pilihannya: insert, ignore, upsert)`);
  }

  return {
    check: flags.has('check'),
    verify: flags.has('verify'),
    dryRun: flags.has('dry-run') || flags.has('dry'),
    resume: flags.has('resume'),
    yes: flags.has('yes') || flags.has('y'),
    help: flags.has('help') || flags.has('h'),
    only,
    limit: values.limit ? Number(values.limit) : null,
    batchSize: values.batch ? Number(values.batch) : envInt('BATCH_SIZE', 500),
    bugReportBatchSize: envInt('BUG_REPORT_BATCH_SIZE', 10),
    mode,
    tzOffsetMinutes: Number.isFinite(Number(process.env.TZ_OFFSET_MINUTES))
      ? Number(process.env.TZ_OFFSET_MINUTES)
      : 420,
    normalizeNames: String(process.env.NORMALIZE_NAMES ?? 'true').toLowerCase() !== 'false',
    legacyUserId: (process.env.LEGACY_USER_ID || '').trim() || DEFAULT_LEGACY_USER_ID,
  };
}

function printHelp() {
  console.log(`
Migration Tool - Log Activity (Firestore -> MariaDB)

  node migrate.js [pilihan]

Pilihan:
  --check              Hanya cek koneksi + kecocokan struktur tabel, tidak menulis
  --dry-run            Jalankan semua transformasi tanpa menulis ke MariaDB
  --verify             Bandingkan jumlah dokumen Firestore vs baris MariaDB
  --only=a,b           Jalankan sebagian saja (users, bug_reports, audit_logs, tech_logs)
  --limit=N            Batasi N dokumen per collection (untuk uji coba)
  --batch=N            Jumlah baris per INSERT (default dari BATCH_SIZE di .env)
  --mode=upsert|ignore|insert
                       upsert  = timpa kalau id sudah ada (default, aman diulang)
                       ignore  = lewati kalau id sudah ada
                       insert  = gagal kalau id sudah ada
  --resume             Lanjutkan dari checkpoint terakhir
  --yes                Jalan tanpa konfirmasi
  --help               Tampilkan bantuan ini
`);
}

async function confirm(question) {
  if (!process.stdin.isTTY) {
    log.error('Terminal tidak interaktif. Tambahkan --yes kalau memang mau langsung jalan.');
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${question} (ketik: ya) `, resolve));
  rl.close();

  return answer.trim().toLowerCase() === 'ya';
}

// ---------------------------------------------------------------------------
// Mode --verify
// ---------------------------------------------------------------------------

async function runVerify(firestore, selected) {
  log.title('VERIFIKASI JUMLAH DATA');

  const rows = [];
  let allMatch = true;

  for (const m of selected) {
    const fsCount = await countCollection(firestore, m.collection);
    const dbCount = await db.countRows(TABLES[m.tableKey]);
    const diff = fsCount - dbCount;
    if (diff !== 0) allMatch = false;
    rows.push({ name: m.name, fsCount, dbCount, diff });
  }

  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);

  console.log('');
  console.log(`   ${pad('COLLECTION', 16)} ${padL('FIRESTORE', 10)} ${padL('MARIADB', 10)} ${padL('SELISIH', 9)}`);
  console.log(`   ${'-'.repeat(48)}`);
  for (const r of rows) {
    const mark = r.diff === 0 ? log.color.green('OK') : log.color.yellow('!!');
    console.log(`   ${pad(r.name, 16)} ${padL(r.fsCount, 10)} ${padL(r.dbCount, 10)} ${padL(r.diff, 9)}  ${mark}`);
  }
  console.log('');

  if (allMatch) {
    log.ok('Semua jumlah data cocok.');
  } else {
    log.warn('Ada selisih. Selisih tidak selalu berarti gagal — cek dulu file di reports/');
    log.detail('Dokumen yang dilewati (skip) tercatat lengkap di sana beserta alasannya.');
  }

  return allMatch;
}

// ---------------------------------------------------------------------------
// Masalah yang tidak boleh diputuskan tool
// ---------------------------------------------------------------------------

function printBlockers(blockers) {
  log.blank();
  log.error(`${blockers.count} data harus dibereskan dulu — migrasi TIDAK dilanjutkan.`);
  log.info('Tidak ada yang ditebak dan tidak ada yang dipotong. Semuanya ada di bawah ini.');

  for (const g of blockers.grouped()) {
    log.blank();
    console.error(`   ${log.color.yellow('*')} ${g.key}  (${g.total} baris)`);
    if (g.hint) console.error(`     ${g.hint}`);

    for (const item of g.contoh) {
      console.error(`       - ${item.docId}: ${item.message}`);
      if (item.contoh) console.error(`         isi: ${JSON.stringify(item.contoh)}`);
    }

    if (g.total > g.contoh.length) {
      console.error(`       ... dan ${g.total - g.contoh.length} baris lain`);
    }
  }

  log.blank();
  log.info('Perbaiki datanya di Firestore, lalu jalankan `npm run dry` lagi.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return 0;
  }

  log.title('MIGRATION TOOL - LOG ACTIVITY');

  const selected = options.only
    ? MIGRATORS.filter((m) => options.only.includes(m.name))
    : MIGRATORS;

  if (!selected.length) {
    log.error(`--only tidak cocok dengan migrator mana pun. Pilihan: ${MIGRATORS.map((m) => m.name).join(', ')}`);
    return 1;
  }

  if (options.only && selected.length < MIGRATORS.length) {
    const names = selected.map((m) => m.name);
    if (!names.includes('users') && names.some((n) => n !== 'users')) {
      log.warn('users tidak ikut dijalankan — pastikan tabel users sudah terisi, kalau tidak FK akan gagal.');
    }
  }

  // --- Firestore ------------------------------------------------------------
  log.step('Menghubungkan ke Firestore (read-only)');
  const { db: firestore, projectId, databaseId, clientEmail } = connectFirestore();
  log.detail(`project    : ${projectId}`);
  log.detail(`database   : ${databaseId}`);
  log.detail(`service acc: ${clientEmail}`);
  if (databaseId === '(default)') {
    log.warn('Database "(default)" terpilih. Project ini pakai named database — cek FIRESTORE_DATABASE_ID di .env.');
  }

  // --- MariaDB --------------------------------------------------------------
  log.step('Menghubungkan ke MariaDB');
  const info = await db.ping();
  log.detail(`server     : ${info.version}`);
  log.detail(`database   : ${info.db}`);
  log.detail(`waktu srv  : ${info.now}`);

  const packet = await db.maxAllowedPacket();
  if (packet) {
    log.detail(`max_allowed_packet: ${(packet / 1024 / 1024).toFixed(1)} MB`);
    if (packet < 4 * 1024 * 1024) {
      log.warn('max_allowed_packet kecil. Kalau bug_reports gagal, turunkan BUG_REPORT_BATCH_SIZE jadi 3.');
    }
  }

  // --- Preflight struktur tabel --------------------------------------------
  log.step('Mencocokkan struktur tabel dengan config/mapping.js');
  const schemaResult = await checkSchema(selected.map((m) => m.tableKey));
  printResult(schemaResult);
  if (!schemaResult.ok) return 1;

  // --- Preflight isi tabel master & akun penampung --------------------------
  log.step('Memeriksa tabel master dan akun penampung');
  const master = await new MasterResolver().load();
  const refProblems = await checkReferenceData(master, options.legacyUserId);

  if (refProblems.length) {
    log.blank();
    log.error('Data pendukung belum siap:');
    for (const p of refProblems) console.error(`\n   ${log.color.yellow('*')} ${p}`);
    log.blank();
    log.info(
      'Urutan skrip: 01_schema.sql -> 02_seed.sql -> 03_align_master_data.sql -> ' +
        '04_legacy_user.sql -> 05_widen_sn.sql'
    );
    return 1;
  }

  log.ok(
    `Master siap: ${master.divisions.size} divisi, ${master.categories.size} kategori, ` +
      `${master.delayCodes.size} kode delay, ${master.supervisors.size} supervisor`
  );
  log.detail(`akun penampung: ${options.legacyUserId}`);

  if (options.check) {
    log.blank();
    log.ok('Semua siap. Lanjutkan dengan `npm run dry` lalu `npm run migrate`.');
    return 0;
  }

  if (options.verify) {
    const ok = await runVerify(firestore, selected);
    return ok ? 0 : 2;
  }

  // --- Ringkasan sebelum jalan ---------------------------------------------
  log.step('Rencana migrasi');
  log.detail(`urutan     : ${selected.map((m) => m.name).join(' -> ')}`);
  log.detail(`mode tulis : ${options.mode}${options.dryRun ? '  (DRY RUN, tidak ada yang ditulis)' : ''}`);
  log.detail(`batch      : ${options.batchSize} baris (bug_reports: ${options.bugReportBatchSize})`);
  log.detail(`timezone   : UTC${options.tzOffsetMinutes >= 0 ? '+' : ''}${options.tzOffsetMinutes / 60}`);
  log.detail(`normalisasi nama: ${options.normalizeNames ? 'ya' : 'tidak'}`);
  if (options.limit) log.detail(`limit      : ${options.limit} dokumen per collection`);
  if (options.resume) log.detail('resume     : ya');

  if (!options.dryRun && !options.yes) {
    log.blank();
    const target = `${info.db} di ${process.env.DB_HOST}`;
    const ok = await confirm(`Tulis data ke ${log.color.bold(target)}?`);
    if (!ok) {
      log.info('Dibatalkan.');
      return 0;
    }
  }

  // --- Konteks bersama ------------------------------------------------------
  const users = new UserResolver(options.legacyUserId);
  const nik = new NikAllocator();
  const blockers = new Blockers({ dryRun: options.dryRun });

  const ctx = {
    firestore,
    options,
    users,
    master,
    nik,
    blockers,
    schemas: schemaResult.schemas,
    stamp: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
    now: toMysqlDateTime(new Date(), options.tzOffsetMinutes),

    /** Master sudah dibaca di preflight; ini cuma supaya migrator tidak peduli. */
    async ensureMaster() {
      await master.load();
    },

    async ensureUserIndex() {
      if (users.loaded) return;

      if (options.dryRun) {
        // Tabel users masih kosong saat dry-run, jadi index dibangun langsung
        // dari Firestore supaya simulasi lookup user_id tetap berarti.
        const { streamCollection } = require('./firebase/firebase');
        const n = await users.loadFromFirestore(firestore, streamCollection);
        log.detail(`Index user dibangun dari Firestore (dry-run): ${n} user`);
      } else {
        const n = await users.loadFromMariaDB();
        log.detail(`Index user dibangun dari MariaDB: ${n} user`);
        if (n === 0) {
          log.warn('Tabel users kosong. Jalankan migrasi users lebih dulu, atau semua user_id akan NULL.');
        }
      }
    },
  };

  // --- Jalan ----------------------------------------------------------------
  const summaries = [];
  const startedAt = Date.now();

  for (const migrator of selected) {
    const report = await runMigrator(migrator, ctx);
    summaries.push(report.summary());
  }

  // --- Ringkasan akhir -------------------------------------------------------
  log.title('RINGKASAN');

  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);

  console.log('');
  console.log(
    `   ${pad('COLLECTION', 16)} ${padL('DIBACA', 8)} ${padL('DITULIS', 8)} ${padL('SKIP', 6)} ${padL('WARN', 6)} ${padL('GAGAL', 6)}`
  );
  console.log(`   ${'-'.repeat(60)}`);
  for (const s of summaries) {
    console.log(
      `   ${pad(s.collection, 16)} ${padL(s.read, 8)} ${padL(s.written, 8)} ${padL(s.skipped, 6)} ${padL(s.warnings, 6)} ${padL(s.failed, 6)}`
    );
  }
  console.log('');

  const totalFailed = summaries.reduce((n, s) => n + s.failed, 0);
  const totalSkipped = summaries.reduce((n, s) => n + s.skipped, 0);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);

  log.info(`Selesai dalam ${elapsed} detik.`);

  // --- Masalah yang harus diputuskan manusia --------------------------------
  if (blockers.count) {
    printBlockers(blockers);
    return 2;
  }

  if (options.dryRun) {
    log.blank();
    log.ok('DRY RUN selesai — tidak ada data yang ditulis ke MariaDB.');
    log.info('Kalau angka di atas sudah masuk akal, jalankan: npm run migrate');
  } else if (totalFailed) {
    log.error(`${totalFailed} baris ditolak MariaDB. Cek folder reports/ untuk detailnya.`);
    return 2;
  } else {
    log.ok('Migrasi selesai tanpa baris yang ditolak.');
    if (totalSkipped) log.info(`${totalSkipped} dokumen dilewati — alasannya ada di folder reports/`);
    log.info('Langkah berikutnya: npm run verify');
  }

  return 0;
}

main()
  .then(async (code) => {
    await db.closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    log.progressDone();
    log.blank();

    // Migrasi sungguhan berhenti pada temuan pertama, tidak dikumpulkan seperti
    // saat dry-run: menulis separuh data lalu berhenti lebih merepotkan.
    if (err instanceof MigrationBlocked) {
      log.error('Migrasi dihentikan karena ada data yang tidak boleh ditebak:');
      log.blank();
      console.error(`   ${log.color.yellow('*')} ${err.item.collection}/${err.item.docId}`);
      console.error(`     ${err.item.field}: ${err.item.message}`);
      if (err.item.hint) console.error(`     ${err.item.hint}`);
      log.blank();
      log.info('Jalankan `npm run dry` untuk melihat SEMUA temuan sekaligus, bukan satu per satu.');
      log.info('Mode tulis default (upsert) aman diulang setelah datanya dibetulkan.');

      await db.closePool().catch(() => {});
      process.exit(2);
    }

    log.error(err.message);

    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      log.info('Cek DB_USER / DB_PASSWORD di .env.');
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      log.info('Tidak bisa konek ke MariaDB. Daftarkan IP kamu di hPanel > Databases > Remote MySQL.');
    } else if (err.code === 5 || /NOT_FOUND/.test(err.message)) {
      log.info('Firestore tidak ketemu. Cek FIRESTORE_DATABASE_ID di .env.');
    } else if (err.code === 7 || /PERMISSION_DENIED/.test(err.message)) {
      log.info('Service account tidak punya akses baca Firestore. Beri role "Cloud Datastore User".');
    }

    if (process.env.DEBUG) console.error(err);

    // Hanya tawarkan --resume kalau memang ada progress yang tersimpan.
    // Kalau gagalnya di tahap koneksi, belum ada apa pun untuk dilanjutkan.
    const checkpoints = Object.keys(state.read());
    if (checkpoints.length) {
      log.blank();
      log.info(`Progress tersimpan (${checkpoints.join(', ')}). Lanjutkan dengan: node migrate.js --resume`);
      log.detail(`checkpoint: ${state.STATE_FILE}`);
    }

    await db.closePool().catch(() => {});
    process.exit(1);
  });
