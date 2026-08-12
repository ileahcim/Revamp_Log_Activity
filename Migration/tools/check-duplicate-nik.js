'use strict';

/**
 * Bandingkan pemakaian dua akun yang memperebutkan satu NIK.
 *
 *   node tools/check-duplicate-nik.js
 *   node tools/check-duplicate-nik.js UID_A UID_B
 *   node tools/check-duplicate-nik.js --aksi=30
 *
 * Kenapa skrip ini ada
 * --------------------
 * `users.nik` bertipe UNIQUE di MariaDB. Kalau dua dokumen Firestore memakai
 * NIK yang sama, migrasi berhenti (migrators/users.js -> blockers) dengan pesan
 *
 *     NIK "..." sudah dipakai user "..."
 *
 * Tool sengaja tidak menebak siapa pemilik NIK itu — salah tebak berarti
 * menempelkan pekerjaan orang ke akun lain. Skrip ini mengumpulkan bukti dari
 * audit_logs supaya keputusannya bisa diambil dengan dasar: akun mana yang
 * masih dipakai sehari-hari, dan akun mana yang sudah lama diam.
 *
 * Skrip ini TIDAK memutuskan apa pun dan TIDAK mengubah apa pun. Setelah
 * pemiliknya ditentukan, perbaikannya dilakukan manual di Firestore, lalu
 * `npm run dry` diulang.
 *
 * Read-only
 * ---------
 * Firestore diambil lewat firebase/firebase.js, yang membungkus instance-nya
 * dengan kuncian read-only. Skrip ini hanya membaca; tidak ada jalan untuk
 * menulis sekalipun ada salah ketik.
 *
 * Hemat kuota
 * -----------
 * Collection TIDAK pernah dibaca seluruhnya. Semua query memakai filter
 * `where('userId', '==', ...)`, dan jumlahnya diambil lewat aggregate count()
 * yang tidak mengunduh dokumen sama sekali.
 *
 * Biaya per akun kira-kira:
 *
 *   count()             1 baca per 1000 entri index  (bukan per dokumen)
 *   aktivitas terawal   1 dokumen
 *   aktivitas terakhir  N dokumen  (--aksi, default 15)
 *
 * Jadi memeriksa dua akun sekali jalan biayanya puluhan baca, bukan ribuan.
 *
 * Skrip sekali pakai: setelah NIK-nya beres, berkas ini dan baris
 * "check:nik" di package.json boleh dihapus.
 */

require('dotenv').config();

const { connectFirestore, FieldPath } = require('../firebase/firebase');
const t = require('../lib/transform');
const log = require('../lib/logger');

const COLLECTION = 'audit_logs';

/** Dua akun yang memperebutkan NIK 52102001. */
const UID_DEFAULT = [
  'RemjphCmhYVmR9iJMwthRkh0Od42',
  'aSD2Ww9ZyNeVgSzsROaHZBrIaUY2',
];

const AKSI_DEFAULT = 15;

/** Ambang "masih dipakai", dipakai untuk kesimpulan di akhir. */
const HARI_AKTIF = 30;

const HARI_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Argumen
// ---------------------------------------------------------------------------

function bacaArgumen(argv) {
  const uids = [];
  let aksi = AKSI_DEFAULT;

  for (const arg of argv) {
    const m = /^--aksi=(\d+)$/.exec(arg);
    if (m) {
      aksi = Math.max(1, Number(m[1]));
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Argumen tidak dikenal: ${arg}`);
    uids.push(arg);
  }

  return { uids: uids.length ? uids : UID_DEFAULT, aksi };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Firestore menolak query yang butuh composite index yang belum dibuat.
 * `where(userId) + orderBy(timestamp)` termasuk yang butuh index seperti itu.
 */
function butuhIndex(err) {
  return err && (err.code === 9 || /requires an index|FAILED_PRECONDITION/i.test(err.message || ''));
}

/** Firestore menyertakan URL pembuatan index di pesan errornya. */
function urlIndex(err) {
  const m = /(https:\/\/console\.firebase\.google\.com\S+)/.exec((err && err.message) || '');
  return m ? m[1].replace(/[).,]+$/, '') : null;
}

function dasar(db, uid) {
  return db.collection(COLLECTION).where('userId', '==', uid);
}

/**
 * Dua cara mengurutkan aktivitas satu user, dari yang paling tepat ke yang
 * paling mudah dijalankan:
 *
 *   timestamp  benar menurut isi dokumen, tapi butuh composite index
 *              (userId ASC, timestamp ASC/DESC) yang mungkin belum dibuat.
 *   dokumen    urut menurut ID dokumen. Di collection ini ID dibuat dari
 *              Date.now().toString() (lihat addAuditLog() di
 *              Frontend/src/utils/auth.ts), jadi urutannya praktis kronologis
 *              dan Firestore melayaninya tanpa composite index tambahan.
 *
 * Yang kedua dipakai otomatis kalau yang pertama ditolak, dan cara yang
 * dipakai selalu ikut dicetak supaya angkanya bisa dinilai sendiri.
 */
const URUTAN = [
  { nama: 'timestamp', field: 'timestamp' },
  { nama: 'ID dokumen', field: FieldPath.documentId() },
];

async function ambil(db, uid, urutan, arah, batas) {
  const snap = await dasar(db, uid).orderBy(urutan.field, arah).limit(batas).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/**
 * Jalankan pengambilan dengan urutan terbaik yang tersedia.
 *
 * @param {string[]} catatan  diisi kalau ada urutan yang ditolak, supaya
 *                            keterangannya muncul di bawah akun yang tepat
 *                            dan bukan tercecer di atas semua hasil.
 * @returns {{ urutan: object, terawal: object[], terakhir: object[] }}
 */
async function ambilRentang(db, uid, jumlahAksi, catatan) {
  let terakhirError = null;

  for (const urutan of URUTAN) {
    try {
      // Dua query terpisah: satu dokumen tertua, lalu N dokumen termuda.
      const terawal = await ambil(db, uid, urutan, 'asc', 1);
      const terakhir = await ambil(db, uid, urutan, 'desc', jumlahAksi);
      return { urutan, terawal, terakhir };
    } catch (err) {
      if (!butuhIndex(err)) throw err;
      terakhirError = err;
      catatan.push(`urut menurut ${urutan.nama} ditolak: composite index belum dibuat`);
    }
  }

  const err = new Error(
    'Semua cara pengurutan ditolak Firestore karena index belum ada. ' +
      'Jumlah aktivitas di bawah tetap benar; hanya rentang waktunya yang tidak terbaca.'
  );
  err.url = urlIndex(terakhirError);
  err.asli = terakhirError;
  throw err;
}

// ---------------------------------------------------------------------------
// Pengumpulan per akun
// ---------------------------------------------------------------------------

const tz = Number(process.env.TZ_OFFSET_MINUTES || 420);

function waktu(nilai) {
  return t.toMysqlDateTime(nilai, tz);
}

function selisihHari(dari) {
  if (!dari) return null;
  return Math.floor((Date.now() - dari.getTime()) / HARI_MS);
}

async function periksa(db, uid, jumlahAksi) {
  const hasil = { uid, total: 0, terawal: null, terakhir: null, aksi: [], urutan: null, catatan: [] };

  // Aggregate count: tidak mengunduh satu dokumen pun.
  const agg = await dasar(db, uid).count().get();
  hasil.total = agg.data().count;

  if (hasil.total === 0) {
    hasil.catatan.push('tidak punya satu pun baris di audit_logs');
    return hasil;
  }

  let rentang;
  try {
    rentang = await ambilRentang(db, uid, jumlahAksi, hasil.catatan);
  } catch (err) {
    hasil.catatan.push(err.message);
    if (err.url) hasil.catatan.push(`Buat index di sini, lalu ulangi: ${err.url}`);
    return hasil;
  }

  hasil.urutan = rentang.urutan.nama;

  const awal = rentang.terawal[0];
  hasil.terawal = awal ? t.toDate(awal.data.timestamp) : null;

  hasil.aksi = rentang.terakhir.map((d) => ({
    waktu: t.toDate(d.data.timestamp),
    action: t.str(d.data.action) || '(kosong)',
    nama: t.str(d.data.userName) || '',
  }));

  hasil.terakhir = hasil.aksi.length ? hasil.aksi[0].waktu : null;

  // Timestamp yang tidak terbaca akan muncul sebagai null di atas; sebut saja
  // apa adanya daripada diam-diam ditampilkan sebagai "-".
  const rusak = hasil.aksi.filter((a) => !a.waktu).length;
  if (rusak) hasil.catatan.push(`${rusak} dari ${hasil.aksi.length} aktivitas terakhir timestamp-nya tidak terbaca`);

  return hasil;
}

// ---------------------------------------------------------------------------
// Tampilan
// ---------------------------------------------------------------------------

function cetakAkun(h, jumlahAksi) {
  log.blank();
  console.log(log.color.bold(h.uid));
  console.log(`  ${'-'.repeat(72)}`);

  console.log(`  jumlah aktivitas   ${log.color.bold(String(h.total))}`);

  // Nol aktivitas bukan "tidak terbaca" — bedanya penting untuk kesimpulan.
  const kosong = log.color.dim(h.total === 0 ? '(tidak ada aktivitas)' : '(tidak terbaca)');

  const umur = selisihHari(h.terakhir);
  console.log(`  paling awal        ${waktu(h.terawal) || kosong}`);
  console.log(
    `  paling akhir       ${waktu(h.terakhir) || kosong}` +
      (umur === null ? '' : log.color.dim(`   (${umur} hari lalu)`))
  );

  if (h.urutan) log.detail(`urutan dipakai: ${h.urutan}`);
  for (const c of h.catatan) log.detail(c);

  if (!h.aksi.length) return;

  console.log('');
  console.log(`  ${log.color.dim(`${h.aksi.length} aktivitas terakhir (diminta ${jumlahAksi}):`)}`);

  for (const a of h.aksi) {
    const w = waktu(a.waktu) || '(waktu tidak terbaca)';
    const nama = a.nama ? log.color.dim(`  <- ${a.nama}`) : '';
    console.log(`    ${log.color.dim(w)}  ${a.action}${nama}`);
  }
}

/**
 * Kesimpulan sengaja dibatasi pada apa yang benar-benar terlihat di data.
 * Penentuan pemilik NIK tetap keputusan manusia.
 */
function cetakKesimpulan(hasil) {
  log.blank();
  log.title('RINGKASAN');

  const lebar = Math.max(...hasil.map((h) => h.uid.length));
  console.log(
    `  ${'akun'.padEnd(lebar)}  ${'aktivitas'.padStart(9)}  ${'terakhir'.padEnd(19)}  umur`
  );

  for (const h of hasil) {
    const umur = selisihHari(h.terakhir);
    console.log(
      `  ${h.uid.padEnd(lebar)}  ${String(h.total).padStart(9)}  ` +
        `${(waktu(h.terakhir) || '-').padEnd(19)}  ${umur === null ? '-' : `${umur} hari lalu`}`
    );
  }

  log.blank();

  bandingkan(hasil);

  log.blank();
  log.info('Langkah berikutnya (semuanya manual, skrip ini tidak mengubah apa pun):');
  log.detail('1. Pastikan ke orangnya / atasan akun mana yang benar memiliki NIK tersebut.');
  log.detail('2. Perbaiki NIK yang salah di Firestore, atau kosongkan salah satunya.');
  log.detail('3. Ulangi `npm run dry` — blocker NIK harusnya hilang.');
  log.detail('Akun yang tidak dipakai tetap ikut termigrasi selama NIK-nya tidak bentrok.');
}

/** Tiga kemungkinan bentuk data, masing-masing dengan kesimpulan berbeda. */
function bandingkan(hasil) {
  const terbaca = hasil.filter((h) => h.terakhir);
  const kosong = hasil.filter((h) => h.total === 0);

  // 1. Satu akun berjejak, sisanya benar-benar nol. Ini sinyal paling tegas
  //    yang bisa diberikan audit_logs -- bukan "kurang data".
  if (terbaca.length === 1 && kosong.length === hasil.length - 1) {
    const dipakai = terbaca[0];
    log.ok(`Hanya satu akun yang punya jejak di ${COLLECTION}: ${log.color.bold(dipakai.uid)}`);
    log.detail(`${dipakai.total} aktivitas, terakhir ${selisihHari(dipakai.terakhir)} hari lalu`);
    for (const h of kosong) log.detail(`${h.uid} tidak pernah muncul sama sekali`);
    log.blank();
    log.warn(
      'Nol aktivitas bukan bukti akunnya boleh dibuang. Akun yang baru dibuat, atau yang ' +
        'dipakai sebelum fitur audit log ada, juga tampak nol di sini.'
    );
    return;
  }

  // 2. Rentang waktunya tidak terbaca (index belum ada, timestamp rusak).
  if (terbaca.length < 2) {
    log.warn('Belum cukup data untuk dibandingkan. Lihat catatan di tiap akun di atas.');
    return;
  }

  // 3. Keduanya berjejak -- yang menentukan adalah jarak aktivitas terakhir.
  const [aktif, diam] = [...terbaca].sort((a, b) => b.terakhir - a.terakhir);
  const jarak = Math.floor((aktif.terakhir - diam.terakhir) / HARI_MS);
  const umurAktif = selisihHari(aktif.terakhir);

  log.info(`Paling baru dipakai : ${log.color.bold(aktif.uid)}`);
  log.detail(`${aktif.total} aktivitas, terakhir ${umurAktif} hari lalu`);
  log.info(`Paling lama diam    : ${diam.uid}`);
  log.detail(`${diam.total} aktivitas, terakhir ${selisihHari(diam.terakhir)} hari lalu`);
  log.blank();

  if (umurAktif > HARI_AKTIF) {
    log.warn(
      `Kedua akun sama-sama tidak aktif dalam ${HARI_AKTIF} hari terakhir. ` +
        'Bedanya tipis, jadi jangan disimpulkan dari sini saja.'
    );
  } else if (jarak < HARI_AKTIF) {
    log.warn(
      `Keduanya masih dipakai dalam rentang ${HARI_AKTIF} hari yang sama (beda ${jarak} hari). ` +
        'Bisa jadi memang dua orang berbeda yang NIK-nya salah ketik, bukan satu orang dengan dua akun.'
    );
  } else {
    log.ok(`Selisihnya ${jarak} hari — polanya cukup jelas.`);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const { uids, aksi } = bacaArgumen(process.argv.slice(2));

  log.title('PEMAKAIAN AKUN DENGAN NIK KEMBAR');

  const { db, projectId, databaseId } = connectFirestore();
  log.detail(`project    : ${projectId}`);
  log.detail(`database   : ${databaseId}`);
  log.detail(`collection : ${COLLECTION}`);
  log.detail(`zona waktu : UTC${tz >= 0 ? '+' : ''}${tz / 60} (TZ_OFFSET_MINUTES=${tz})`);

  const hasil = [];
  for (const uid of uids) {
    hasil.push(await periksa(db, uid, aksi));
  }

  for (const h of hasil) cetakAkun(h, aksi);

  cetakKesimpulan(hasil);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.blank();
    log.error(err.message);

    const url = urlIndex(err);
    if (url) log.detail(`Buat index-nya di sini: ${url}`);

    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
