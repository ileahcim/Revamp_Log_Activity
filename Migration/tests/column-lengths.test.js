'use strict';

/**
 * Pengujian batas panjang kolom — TIDAK menyentuh MariaDB maupun Firestore.
 * Struktur tabel yang dipakai di sini disusun sendiri sebagai objek biasa,
 * bentuknya sama dengan hasil database/mysql.js -> describeTable().
 *
 * Latar belakang
 * --------------
 * tech_logs.sn dulu VARCHAR(100). Tujuh log lama divisi Instrument memuat
 * banyak nomor seri sekaligus (terpanjang 1199 karakter), jadi migrasi
 * berhenti di situ — sn ada di NO_TRUNCATE, dan tool menolak memotong.
 *
 * Perbaikannya di sisi database (Backend/05_widen_sn.sql mengubahnya jadi
 * TEXT), bukan dengan mengeluarkan sn dari NO_TRUNCATE. Tes di bawah menjaga
 * kedua sisi keputusan itu:
 *
 *   - batas panjang sn tidak lagi dipatok 100 di config/mapping.js
 *   - sn TETAP di NO_TRUNCATE, jadi kalau suatu saat batas TEXT terlampaui
 *     migrasi tetap berhenti, bukan memotong diam-diam
 *   - kalau 05_widen_sn.sql belum dijalankan, tool ikut kolom aslinya lagi
 *     dan berhenti seperti dulu
 */

const { effectiveMaxLengths } = require('../lib/schema-check');
const { COLUMNS, MAX_LENGTHS, NO_TRUNCATE, TABLES } = require('../config/mapping');

/** Satu baris hasil describeTable(); hanya field yang dipakai yang diisi. */
function kolom(name, maxLength) {
  return { name, maxLength, type: '', nullable: true, key: '', default: null, extra: '' };
}

/** tech_logs setelah Backend/05_widen_sn.sql: sn ikut TEXT. */
const SESUDAH_WIDEN = [
  kolom('id', 36),
  kolom('user_id', 128),
  kolom('display_name', 150),
  kolom('nik_snapshot', 50),
  kolom('supervisor', 150),
  kolom('wo_notif', 100),
  kolom('asset_tag', 100),
  kolom('party', 100),
  kolom('sn', 65535),
  kolom('deskripsi_pekerjaan', 65535),
  kolom('kategori_code', 5),
  kolom('delay_code', 5),
  kolom('catatan', 65535),
];

/** Kondisi lama: 05_widen_sn.sql belum dijalankan. */
const SEBELUM_WIDEN = SESUDAH_WIDEN.map((c) => (c.name === 'sn' ? kolom('sn', 100) : c));

module.exports = {
  nama: 'Batas panjang kolom (config/mapping.js + lib/schema-check.js)',

  tests: {
    'sn tidak lagi dipatok 100 oleh MAX_LENGTHS': (assert) => {
      assert.sama(
        MAX_LENGTHS.tech_logs.sn,
        undefined,
        'sn sudah TEXT, jadi tidak boleh punya angka tetap di MAX_LENGTHS'
      );
    },

    'sn memakai batas TEXT dari struktur tabel, bukan angka di kode': (assert) => {
      const max = effectiveMaxLengths('tech_logs', SESUDAH_WIDEN);
      assert.sama(max.sn, 65535, 'batas sn setelah 05_widen_sn.sql');
      assert.sama(max.deskripsi_pekerjaan, 65535, 'kolom TEXT lain, sebagai pembanding');
    },

    'sn 1199 karakter muat setelah kolomnya diperlebar': (assert) => {
      const max = effectiveMaxLengths('tech_logs', SESUDAH_WIDEN);
      // Nilai terpanjang yang benar-benar ada di Firestore.
      assert.ok(1199 <= max.sn, `sn 1199 karakter harus muat, batasnya sekarang ${max.sn}`);
    },

    'kalau 05_widen_sn.sql belum jalan, sn tetap dibatasi 100': (assert) => {
      // Tool harus ikut kolom yang benar-benar ada di database. Kalau batas ini
      // hilang, 1199 karakter dikirim ke VARCHAR(100) dan MySQL yang memotong.
      const max = effectiveMaxLengths('tech_logs', SEBELUM_WIDEN);
      assert.sama(max.sn, 100, 'batas sn sebelum kolomnya diperlebar');
    },

    'sn tetap di NO_TRUNCATE': (assert) => {
      assert.ok(
        NO_TRUNCATE.tech_logs.includes('sn'),
        'memperlebar kolom bukan alasan untuk membolehkan pemotongan diam-diam'
      );
    },

    'MAX_LENGTHS tetap jadi jaring pengaman kalau kolom database lebih longgar': (assert) => {
      const longgar = SESUDAH_WIDEN.map((c) => (c.name === 'party' ? kolom('party', 500) : c));
      const max = effectiveMaxLengths('tech_logs', longgar);
      assert.sama(max.party, 100, 'yang lebih kecil antara database dan MAX_LENGTHS yang menang');
    },

    'semua kolom di NO_TRUNCATE benar-benar ditulis migrator': (assert) => {
      for (const [tableKey, fields] of Object.entries(NO_TRUNCATE)) {
        const mapped = COLUMNS[tableKey];
        assert.ok(mapped, `tabel "${tableKey}" ada di COLUMNS`);

        for (const field of fields) {
          assert.ok(
            mapped[field],
            `${TABLES[tableKey]}.${field} ada di NO_TRUNCATE tapi tidak dipetakan di COLUMNS.` +
              `${tableKey} — daftarnya jadi tidak menjaga apa pun`
          );
        }
      }
    },

    'setiap kolom di MAX_LENGTHS juga dipetakan di COLUMNS': (assert) => {
      for (const [tableKey, fields] of Object.entries(MAX_LENGTHS)) {
        for (const field of Object.keys(fields)) {
          assert.ok(
            COLUMNS[tableKey] && COLUMNS[tableKey][field],
            `${tableKey}.${field} punya batas panjang tapi tidak dipetakan di COLUMNS`
          );
        }
      }
    },
  },
};
