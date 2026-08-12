'use strict';

/**
 * tech_bug_reports (Firestore) -> tech_bug_reports (MariaDB)
 *
 * Firestore : { id, userId, userName, role, title, description,
 *               imageBase64?, status, timestamp }
 *
 * TABEL INI TIDAK PUNYA KOLOM user_name MAUPUN role.
 * Backend/01_schema.sql hanya menyimpan user_id; nama dan role pelapor diambil
 * lewat JOIN ke users saat dibaca. Keduanya sudah di-null-kan di
 * config/mapping.js sehingga tidak ikut ditulis.
 *
 * STATUS PUNYA TIGA NILAI, bukan dua: Open, In Progress, Resolved.
 * types.ts di frontend baru mengenal dua, tapi database menerima ketiganya dan
 * backend sudah memakainya, jadi nilai "In Progress" dari data lama tidak boleh
 * dipaksa jadi "Open".
 *
 * CATATAN UKURAN DATA:
 * imageBase64 berisi data URL JPEG (frontend mengecilkan ke lebar 800px,
 * kualitas 0.7 — lihat compressImage() di Frontend/src/utils/bugReport.ts),
 * jadi satu baris bisa ratusan KB. Karena itu batch-nya sengaja kecil
 * (BUG_REPORT_BATCH_SIZE, default 10) dan dibatasi 2 MB per batch supaya
 * tidak menabrak max_allowed_packet MySQL Hostinger.
 *
 * Gambar tetap disimpan base64 di V1 — pemindahan ke file upload sudah
 * masuk backlog V2, jadi jangan diubah di sini.
 */

const t = require('../lib/transform');

const VALID_STATUS = new Set(['Open', 'In Progress', 'Resolved']);

/** "in progress" / "IN PROGRESS" -> "In Progress". */
function matchStatus(value) {
  const s = t.str(value);
  if (s === null) return null;
  if (VALID_STATUS.has(s)) return s;
  for (const opt of VALID_STATUS) {
    if (opt.toLowerCase() === s.toLowerCase()) return opt;
  }
  return null;
}

module.exports = {
  name: 'bug_reports',
  collection: 'tech_bug_reports',
  tableKey: 'bug_reports',
  order: 2,

  batchSize: (options) => options.bugReportBatchSize,
  maxBatchBytes: 2 * 1024 * 1024,

  async prepare(ctx) {
    await ctx.ensureUserIndex();
  },

  transform(doc, ctx) {
    const d = doc.data || {};

    const id = t.str(doc.id) || t.str(d.id);
    if (!id) return { skip: 'tidak punya id' };

    const title = t.str(d.title);
    if (!title) return { skip: 'title kosong' };

    // userId di sini memang Firebase UID (firestore.rules memaksa
    // request.resource.data.userId == request.auth.uid), jadi bisa langsung
    // jadi FK. Kolomnya NOT NULL, jadi pelapor yang akunnya sudah dihapus
    // diarahkan ke akun penampung.
    let userId = t.str(d.userId);
    if (!userId || !ctx.users.exists(userId)) {
      ctx.report.warn(
        doc.id,
        'user_id',
        `user "${userId || '(kosong)'}" tidak ada di tabel users, diarahkan ke "${ctx.users.legacyUserId}"`
      );
      userId = ctx.users.legacyUserId;
    }

    let status = matchStatus(d.status);
    if (!status) {
      if (d.status) ctx.report.warn(doc.id, 'status', `status "${d.status}" tidak dikenal, diubah jadi "Open"`);
      status = 'Open';
    }

    let createdAt = t.toMysqlDateTime(d.timestamp, ctx.options.tzOffsetMinutes);
    if (!createdAt) {
      ctx.report.warn(doc.id, 'created_at', 'timestamp tidak valid, diisi waktu migrasi');
      createdAt = ctx.now;
    }

    // Kolomnya TEXT NOT NULL.
    let description = t.str(d.description);
    if (!description) {
      ctx.report.warn(doc.id, 'description', 'kosong, diisi "-" (kolomnya NOT NULL)');
      description = '-';
    }

    return {
      record: {
        id,
        user_id: userId,
        title,
        description,
        image_base64: t.str(d.imageBase64),
        status,
        created_at: createdAt,
      },
    };
  },
};
