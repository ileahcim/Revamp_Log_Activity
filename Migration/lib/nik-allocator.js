'use strict';

/**
 * Pembagi NIK untuk tabel users.
 *
 * MASALAHNYA:
 * `users.nik` di Backend/01_schema.sql bertipe VARCHAR(50) NOT NULL UNIQUE,
 * sedangkan di Firestore field `nik` opsional -- lihat User di
 * Frontend/src/utils/auth.ts, dan DEFAULT_USERS di sana memang punya dua akun
 * (atasan & admin) tanpa NIK sama sekali.
 *
 * ATURANNYA:
 *   1. Punya NIK      -> dipakai apa adanya (dirapikan huruf besar & spasi)
 *   2. Tidak punya    -> diberi penanda sementara NOREG-001, NOREG-002, ...
 *   3. NIK dipakai dua user berbeda -> BUKAN urusan tool ini. Tool tidak punya
 *      dasar untuk memutuskan siapa pemilik aslinya, dan menebak berarti
 *      menempelkan pekerjaan orang ke akun yang salah. Dilaporkan sebagai
 *      blocker.
 *
 * Penanda sementara dicek terhadap NIK yang sudah ada di tabel users, jadi
 * tidak mungkin bertabrakan dengan LEGACY-000 milik akun penampung dari
 * 04_legacy_user.sql, maupun dengan hasil migrasi sebelumnya.
 *
 * Menjalankan ulang migrasi tidak menggeser nomor: kalau user yang sama sudah
 * pernah dapat NOREG-003, nomor itu dipakai lagi.
 */

const db = require('../database/mysql');
const { TABLES, COLUMNS } = require('../config/mapping');
const { nikKey } = require('./transform');

const PREFIX = 'NOREG';

class NikAllocator {
  constructor() {
    this.byNik = new Map();   // NIK (kunci) -> id user pemiliknya
    this.byUserId = new Map(); // id user -> NIK yang sudah tercatat di DB
    this.nextNumber = 1;
    this.placeholders = 0;
    this.loaded = false;
  }

  /** Baca NIK yang sudah terpakai di MariaDB (termasuk akun penampung). */
  async loadExisting() {
    if (this.loaded) return this;

    const c = COLUMNS.users;
    const rows = await db.query(
      `SELECT ${db.escapeId(c.id)} AS id, ${db.escapeId(c.nik)} AS nik
         FROM ${db.escapeId(TABLES.users)}`
    );

    for (const r of rows) {
      const k = nikKey(r.nik);
      if (!k) continue;

      this.byNik.set(k, String(r.id));
      this.byUserId.set(String(r.id), k);

      const m = new RegExp(`^${PREFIX}-(\\d+)$`).exec(k);
      if (m) this.nextNumber = Math.max(this.nextNumber, Number(m[1]) + 1);
    }

    this.loaded = true;
    return this;
  }

  /**
   * @param {string} userId  id user (Firebase UID)
   * @param {*} rawNik       nilai `nik` dari Firestore, boleh kosong
   * @returns {{ nik: string, placeholder: boolean, conflictWith: string|null }}
   */
  claim(userId, rawNik) {
    const id = String(userId);
    const k = nikKey(rawNik);

    if (k) {
      const pemilik = this.byNik.get(k);

      if (pemilik !== undefined && pemilik !== id) {
        return { nik: k, placeholder: false, conflictWith: pemilik };
      }

      this.byNik.set(k, id);
      this.byUserId.set(id, k);

      return { nik: k, placeholder: false, conflictWith: null };
    }

    // Sudah pernah dapat penanda pada migrasi sebelumnya -> pakai yang sama.
    const sebelumnya = this.byUserId.get(id);
    if (sebelumnya) {
      return { nik: sebelumnya, placeholder: sebelumnya.startsWith(`${PREFIX}-`), conflictWith: null };
    }

    let nik;
    do {
      nik = `${PREFIX}-${String(this.nextNumber).padStart(3, '0')}`;
      this.nextNumber += 1;
    } while (this.byNik.has(nik));

    this.byNik.set(nik, id);
    this.byUserId.set(id, nik);
    this.placeholders += 1;

    return { nik, placeholder: true, conflictWith: null };
  }
}

module.exports = { NikAllocator, PREFIX };
