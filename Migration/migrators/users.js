'use strict';

/**
 * users  (Firestore)  ->  users  (MariaDB)
 *
 * Firestore : { id, email, name, role, nik?, divisi? }
 *   id = Firebase UID, dipakai apa adanya sebagai PK supaya login Google
 *        nanti tetap nyambung tanpa mapping tambahan.
 *
 * Wajib dijalankan PALING AWAL — tiga tabel lain menunjuk ke sini lewat FK.
 *
 * DUA HAL YANG BERUBAH SETELAH SCHEMA ASLI TERSEDIA:
 *
 * 1. `divisi` di Firestore berupa teks ("Mekanik"), sedangkan kolomnya
 *    `division_id INT NOT NULL` dengan FK ke master_divisions. Teksnya
 *    diterjemahkan lewat lib/master-resolver.js; yang tidak dikenal jatuh ke
 *    divisi "-", bukan NULL.
 * 2. `nik` opsional di Firestore tapi NOT NULL UNIQUE di MariaDB. User tanpa
 *    NIK diberi penanda sementara NOREG-001, NOREG-002, ... lihat
 *    lib/nik-allocator.js.
 */

const t = require('../lib/transform');
const log = require('../lib/logger');

const VALID_ROLES = new Set(['karyawan', 'atasan', 'admin']);

module.exports = {
  name: 'users',
  collection: 'users',
  tableKey: 'users',
  order: 1,

  async prepare(ctx) {
    await ctx.ensureMaster();
    await ctx.nik.loadExisting();
  },

  transform(doc, ctx) {
    const d = doc.data || {};
    const report = ctx.report;

    // Sebagian dokumen lama menyimpan field `id` di dalam data, sebagian tidak.
    // Nama dokumen (doc.id) adalah sumber yang paling bisa dipercaya.
    const id = t.str(doc.id) || t.str(d.id);
    if (!id) return { skip: 'tidak punya id' };

    const email = t.str(d.email);
    if (!email) return { skip: 'email kosong' };

    let role = (t.str(d.role) || 'karyawan').toLowerCase();
    if (!VALID_ROLES.has(role)) {
      report.warn(doc.id, 'role', `role "${d.role}" tidak dikenal, diubah jadi "karyawan"`);
      role = 'karyawan';
    }

    const rawName = t.str(d.name);
    const displayName = ctx.options.normalizeNames ? t.normalizeName(rawName || '') : rawName;

    // --- divisi -> division_id ------------------------------------------------
    // "-" dipakai frontend sebagai penanda "tidak ada divisi" (lihat
    // DEFAULT_USERS di Frontend/src/utils/auth.ts) dan memang ada barisnya di
    // master_divisions, jadi tidak perlu diperlakukan khusus.
    const rawDivisi = t.str(d.divisi);
    let divisionId = rawDivisi ? ctx.master.divisionId(rawDivisi) : null;

    if (divisionId === null) {
      divisionId = ctx.master.defaultDivisionId;
      if (rawDivisi && rawDivisi !== '-') {
        report.warn(
          doc.id,
          'division_id',
          `divisi "${rawDivisi}" tidak ada di master_divisions, dipakai "-"`
        );
      }
    }

    // --- nik ------------------------------------------------------------------
    const claim = ctx.nik.claim(id, d.nik);

    if (claim.conflictWith) {
      ctx.blockers.add({
        collection: 'users',
        docId: doc.id,
        field: 'nik',
        message: `NIK "${claim.nik}" sudah dipakai user "${claim.conflictWith}"`,
        hint:
          'users.nik bertipe UNIQUE. Tentukan sendiri siapa pemilik NIK ini lalu ' +
          'perbaiki salah satunya di Firestore sebelum migrasi diulang.',
      });

      return { skip: `NIK bentrok dengan user ${claim.conflictWith}` };
    }

    if (claim.placeholder) {
      report.warn(
        doc.id,
        'nik',
        `NIK kosong, diberi penanda sementara "${claim.nik}" (kolomnya NOT NULL UNIQUE)`
      );
    }

    return {
      record: {
        id,
        email: email.toLowerCase(),
        display_name: displayName || email.split('@')[0],
        role,
        nik: claim.nik,
        division_id: divisionId,
        created_at: ctx.now,
      },
    };
  },

  async finalize(ctx) {
    if (ctx.nik.placeholders) {
      log.warn(
        `${ctx.nik.placeholders} user tidak punya NIK dan diberi penanda sementara berawalan "NOREG-".`
      );
      log.detail('Ganti dengan NIK asli lewat AdminPanel setelah migrasi selesai.');
    }
  },
};
