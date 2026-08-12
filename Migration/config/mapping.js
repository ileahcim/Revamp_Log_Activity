'use strict';

/**
 * ===========================================================================
 *  PETA KOLOM  Firestore -> MariaDB   (Database LOCK V1.0)
 * ===========================================================================
 *
 *  Sumber kebenaran nama kolom: Backend/01_schema.sql
 *  Berkas ini sudah dicocokkan baris per baris dengan schema itu pada
 *  4 Agustus 2026. Versi sebelumnya ditulis sebelum schema tersedia dan
 *  beberapa namanya cuma tebakan -- lihat catatan "DIPERBAIKI" di bawah.
 *
 *  Format:
 *      <nama logis yang dipakai kode>: '<nama kolom asli di MariaDB>'
 *
 *  - Kiri  : nama internal, dipakai oleh migrators/*.js.
 *  - Kanan : nama kolom fisik di MariaDB.
 *  - Isi `null` di sebelah kanan kalau kolom itu tidak ada di tabelmu
 *    -> field tersebut otomatis dilewati saat INSERT.
 *
 *  Cara memastikan nama kolom yang benar:
 *      npm run inspect:schema
 *
 *  Sebelum menulis data, `migrate.js` selalu menjalankan pengecekan:
 *  kalau ada kolom di sini yang tidak ada di DB, proses berhenti dan
 *  menampilkan daftar kolom asli. Jadi tidak akan ada data masuk setengah
 *  jadi karena salah nama kolom.
 */

/** Nama tabel di MariaDB. */
const TABLES = {
  users: 'users',
  tech_logs: 'tech_logs',
  audit_logs: 'audit_logs',
  bug_reports: 'tech_bug_reports',
};

/** Nama collection di Firestore (jangan diubah, ini sudah sesuai frontend). */
const COLLECTIONS = {
  users: 'users',
  tech_logs: 'tech_logs',
  audit_logs: 'audit_logs',
  bug_reports: 'tech_bug_reports',
};

const COLUMNS = {
  // -------------------------------------------------------------------------
  // users
  // Firestore: { id (Firebase UID), email, name, role, nik?, divisi? }
  // -------------------------------------------------------------------------
  users: {
    id: 'id',                     // Firebase UID, dipakai apa adanya sebagai PK
    email: 'email',               // NOT NULL UNIQUE
    display_name: 'name',         // DIPERBAIKI: kolomnya "name", bukan "display_name"
    role: 'role',                 // ENUM('admin','atasan','karyawan') NOT NULL
    nik: 'nik',                   // NOT NULL UNIQUE -> lihat lib/nik-allocator.js
    division_id: 'division_id',   // DIPERBAIKI: INT FK ke master_divisions,
                                  //             bukan kolom teks "division"
    created_at: 'created_at',
  },

  // -------------------------------------------------------------------------
  // tech_logs  (tabel paling besar)
  // Catatan: Firestore TIDAK menyimpan userId di tech_logs, hanya nik + nama.
  //          user_id direkonstruksi lewat lookup nik -> users, fallback nama,
  //          dan kalau tetap tidak ketemu diarahkan ke user penampung
  //          'legacy-unknown' -- kolomnya NOT NULL, tidak bisa diisi NULL.
  //          Lihat lib/user-resolver.js.
  // -------------------------------------------------------------------------
  tech_logs: {
    id: 'id',                     // CHAR(36)
    user_id: 'user_id',           // VARCHAR(128) NOT NULL, FK ke users.id
    display_name: 'display_name', // snapshot <- Firestore: "nama_technician"
    nik_snapshot: 'nik_snapshot', // snapshot <- Firestore: "nik"
    supervisor: 'supervisor',     // snapshot
    tanggal: 'tanggal',           // DATE NOT NULL
    shift: 'shift',               // ENUM('Pagi','Siang','Malam') NOT NULL
    wo_notif: 'wo_notif',
    asset_tag: 'asset_tag',
    party: 'party',
    sn: 'sn',                     // TEXT sejak Backend/05_widen_sn.sql (dulu VARCHAR(100))
    deskripsi_pekerjaan: 'deskripsi_pekerjaan',
    kategori_code: 'kategori_code', // VARCHAR(5) NOT NULL, tanpa FK
    start_time: 'start_time',     // TIME NOT NULL
    finish_time: 'finish_time',   // TIME NOT NULL
    duration_minutes: 'duration_minutes', // INT NOT NULL
    status: 'status',             // ENUM('Done','Ongoing','Hold','-') NOT NULL
    delay_code: 'delay_code',     // VARCHAR(5), tanpa FK
    output_qty: 'output_qty',     // DECIMAL(10,2) -- bukan INT
    catatan: 'catatan',
    created_at: 'created_at',
  },

  // -------------------------------------------------------------------------
  // audit_logs
  // Firestore: { id, timestamp, userId, userName, action }
  // -------------------------------------------------------------------------
  audit_logs: {
    id: 'id',                  // CHAR(36)
    user_id: 'user_id',        // NOT NULL <- Firestore: "userId"
    // DIPERBAIKI: tabel ini TIDAK punya kolom user_name. Nama pelaku diambil
    // lewat JOIN ke users saat dibaca. Snapshot nama dari Firestore tetap
    // diselamatkan ke kolom description supaya tidak hilang begitu saja --
    // lihat migrators/audit_logs.js.
    user_name: null,
    action: 'action',          // VARCHAR(100) NOT NULL
    description: 'description', // TEXT
    created_at: 'created_at',  // <- Firestore: "timestamp"
  },

  // -------------------------------------------------------------------------
  // tech_bug_reports
  // Firestore: { id, userId, userName, role, title, description,
  //              imageBase64?, status, timestamp }
  // -------------------------------------------------------------------------
  bug_reports: {
    id: 'id',                     // CHAR(36)
    user_id: 'user_id',           // NOT NULL <- Firestore: "userId"
    // DIPERBAIKI: kedua kolom ini tidak ada di tabel. Nama dan role pelapor
    // diambil lewat JOIN ke users saat dibaca.
    user_name: null,
    role: null,
    title: 'title',               // VARCHAR(255) NOT NULL
    description: 'description',   // TEXT NOT NULL
    image_base64: 'image_base64', // LONGTEXT
    status: 'status',             // ENUM('Open','In Progress','Resolved')
    created_at: 'created_at',     // <- Firestore: "timestamp"
  },
};

/**
 * Kolom yang jadi primary key tiap tabel.
 * Dipakai untuk menyusun klausa ON DUPLICATE KEY UPDATE (kolom PK tidak ikut
 * di-update) dan untuk laporan verifikasi.
 */
const PRIMARY_KEYS = {
  users: ['id'],
  tech_logs: ['id'],
  audit_logs: ['id'],
  bug_reports: ['id'],
};

/**
 * Batas panjang kolom VARCHAR, disalin dari Backend/01_schema.sql.
 *
 * Nilai di sini hanya jaring pengaman; panjang sebenarnya tetap dibaca dari
 * database saat migrasi berjalan dan yang lebih kecil yang dipakai.
 *
 * Kolom ENUM sengaja tidak didaftarkan: nilainya sudah dicocokkan ke salah satu
 * pilihan resmi di migrator, jadi tidak mungkin kepanjangan.
 */
const MAX_LENGTHS = {
  users: {
    id: 128,
    email: 255,
    display_name: 150,
    nik: 50,
  },
  tech_logs: {
    id: 36,
    user_id: 128,
    display_name: 150,
    nik_snapshot: 50,
    supervisor: 150,
    wo_notif: 100,
    asset_tag: 100,
    party: 100,
    // sn TIDAK didaftarkan lagi: sejak Backend/05_widen_sn.sql tipenya TEXT,
    // sama seperti deskripsi_pekerjaan dan catatan yang juga tidak ada di sini.
    // Batas 65535-nya tetap terbaca otomatis dari information_schema saat
    // preflight, dan NO_TRUNCATE di bawah yang menjaganya.
    kategori_code: 5,
    delay_code: 5,
  },
  audit_logs: {
    id: 36,
    user_id: 128,
    action: 100,
  },
  bug_reports: {
    id: 36,
    user_id: 128,
    title: 255,
  },
};

/**
 * Kolom yang TIDAK BOLEH dipotong diam-diam.
 *
 * Default runner adalah memotong nilai yang melebihi panjang kolom lalu
 * mencatatnya sebagai warning. Untuk kolom di daftar ini perlakuannya berbeda:
 * migrasi DIHENTIKAN dan barisnya dilaporkan, karena memotongnya berarti
 * merusak data tanpa bisa dikembalikan.
 *
 *   id             memotong primary key bisa membuat dua baris berbeda
 *                  bertabrakan jadi satu
 *   email, nik     penanda identitas; potongan email membuat login tidak cocok
 *   sn             satu aktivitas bisa memuat banyak serial number sekaligus;
 *                  potongan berarti sebagian nomor seri hilang tanpa jejak
 *   deskripsi, catatan, description   isi laporan kerja
 *   image_base64   data URL yang terpotong = gambar rusak, tidak bisa dibuka
 *
 * Kolom TEXT tetap didaftarkan di sini. Batasnya memang jauh (65535), tapi
 * kalau suatu saat terlampaui, berhenti tetap lebih baik daripada memotong.
 *
 * Catatan sn: dulu kolomnya VARCHAR(100) dan tujuh log lama dari divisi
 * Instrument (terpanjang 1199 karakter) berhenti di sini. Jalan keluarnya
 * bukan mengeluarkan sn dari daftar ini, melainkan memperlebar kolomnya --
 * lihat Backend/05_widen_sn.sql. Pola itu yang dipakai kalau kejadian serupa
 * muncul lagi di kolom lain: laporkan, putuskan, lalu perlebar; jangan
 * diam-diam memotong.
 */
const NO_TRUNCATE = {
  users: ['id', 'email', 'nik'],
  tech_logs: ['id', 'sn', 'deskripsi_pekerjaan', 'catatan'],
  audit_logs: ['id'],
  bug_reports: ['id', 'description', 'image_base64'],
};

module.exports = { TABLES, COLLECTIONS, COLUMNS, PRIMARY_KEYS, MAX_LENGTHS, NO_TRUNCATE };
