'use strict';

/**
 * audit_logs (Firestore) -> audit_logs (MariaDB)
 *
 * Firestore : { id, timestamp, userId, userName, action }
 *   id dibuat dari Date.now().toString() (lihat addAuditLog() di
 *   Frontend/src/utils/auth.ts). Dua aksi pada milidetik yang sama akan
 *   menimpa satu sama lain di Firestore, jadi jumlah baris di MariaDB memang
 *   bisa sedikit lebih kecil dari total aktivitas sebenarnya — itu bawaan
 *   data lama, bukan kesalahan migrasi.
 *
 * TABEL INI TIDAK PUNYA KOLOM user_name.
 * Berbeda dengan Firestore, Backend/01_schema.sql hanya menyimpan user_id dan
 * mengambil namanya lewat JOIN ke users saat dibaca. Artinya yang tampil adalah
 * nama sekarang, bukan nama saat kejadian.
 *
 * Snapshot nama dari Firestore tetap diselamatkan ke kolom `description` yang
 * selama ini kosong, supaya jejaknya tidak hilang sama sekali. Frontend tidak
 * menampilkan field itu (AuditLogItem di auth.ts tidak punya `description`),
 * jadi tidak ada tampilan yang berubah. Kalau kamu memilih membuangnya saja,
 * hapus baris `description` di bawah.
 */

const t = require('../lib/transform');

module.exports = {
  name: 'audit_logs',
  collection: 'audit_logs',
  tableKey: 'audit_logs',
  order: 3,

  async prepare(ctx) {
    await ctx.ensureUserIndex();
  },

  transform(doc, ctx) {
    const d = doc.data || {};

    const id = t.str(doc.id) || t.str(d.id);
    if (!id) return { skip: 'tidak punya id' };

    const action = t.str(d.action);
    if (!action) return { skip: 'action kosong' };

    // Kolomnya NOT NULL dengan FK ke users. User yang sudah dihapus diarahkan
    // ke akun penampung, bukan NULL.
    let userId = t.str(d.userId);
    if (!userId || !ctx.users.exists(userId)) {
      ctx.report.warn(
        doc.id,
        'user_id',
        `user "${userId || '(kosong)'}" tidak ada di tabel users, diarahkan ke "${ctx.users.legacyUserId}"`
      );
      userId = ctx.users.legacyUserId;
    }

    // TIMESTAMP di MariaDB tidak menerima NULL kecuali kolomnya memang
    // NULL-able; daripada barisnya ditolak, dipakai waktu migrasi.
    let createdAt = t.toMysqlDateTime(d.timestamp, ctx.options.tzOffsetMinutes);
    if (!createdAt) {
      ctx.report.warn(doc.id, 'created_at', 'timestamp tidak valid, diisi waktu migrasi');
      createdAt = ctx.now;
    }

    const rawName = t.str(d.userName);
    const snapshotName = ctx.options.normalizeNames ? t.normalizeName(rawName || '') : rawName;

    return {
      record: {
        id,
        user_id: userId,
        action,
        description: snapshotName ? `Nama pelaku saat kejadian: ${snapshotName}` : null,
        created_at: createdAt,
      },
    };
  },
};
