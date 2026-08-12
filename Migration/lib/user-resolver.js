'use strict';

/**
 * Rekonstruksi user_id untuk tech_logs.
 *
 * MASALAHNYA:
 * collection tech_logs di Firestore TIDAK menyimpan userId sama sekali —
 * hanya `nik` dan `nama_technician` (lihat Frontend/src/types.ts). Padahal
 * tech_logs di MariaDB punya FK user_id ke users.
 *
 * CARA PENYELESAIAN (berurutan, berhenti di yang pertama cocok):
 *   1. cocokkan NIK   (paling kuat — NIK unik per orang)
 *   2. cocokkan nama yang sudah dinormalisasi
 *   3. menyerah -> user_id = akun penampung 'legacy-unknown'
 *
 * Langkah 3 DIPERBAIKI 4 Agustus 2026. Sebelumnya menyimpan NULL, padahal
 * Backend/01_schema.sql menetapkan tech_logs.user_id sebagai VARCHAR(128)
 * NOT NULL dengan FK ke users -- seluruh baris yang tidak ketemu pemiliknya
 * akan ditolak MariaDB. Akun penampungnya dibuat oleh Backend/04_legacy_user.sql.
 *
 * Kolom snapshot (display_name, nik_snapshot, supervisor) TETAP diisi dari
 * data Firestore apa adanya, jadi walaupun barisnya bersandar ke akun
 * penampung, nama teknisi aslinya masih terbaca di histori. Backend juga masih
 * bisa menemukannya: penyaringan "log saya" mencocokkan user_id ATAU
 * nik_snapshot ATAU nama.
 */

const db = require('../database/mysql');
const { TABLES, COLUMNS } = require('../config/mapping');
const { nikKey, nameKey } = require('./transform');
const log = require('./logger');

/** Dipakai kalau .env tidak menyebut LEGACY_USER_ID. */
const DEFAULT_LEGACY_USER_ID = 'legacy-unknown';

class UserResolver {
  constructor(legacyUserId = DEFAULT_LEGACY_USER_ID) {
    this.legacyUserId = legacyUserId;
    this.byId = new Map();
    this.byNik = new Map();
    this.byName = new Map();
    this.ambiguousNames = new Set();
    this.ambiguousNiks = new Set();
    this.stats = { byNik: 0, byName: 0, unresolved: 0 };
    this.loaded = false;
  }

  _add(user) {
    this.byId.set(String(user.id), user);

    const nk = nikKey(user.nik);
    if (nk) {
      if (this.byNik.has(nk) && this.byNik.get(nk).id !== user.id) {
        this.ambiguousNiks.add(nk);
      } else {
        this.byNik.set(nk, user);
      }
    }

    const nm = nameKey(user.name);
    if (nm) {
      if (this.byName.has(nm) && this.byName.get(nm).id !== user.id) {
        this.ambiguousNames.add(nm);
      } else {
        this.byName.set(nm, user);
      }
    }
  }

  /** Sumber utama: tabel users di MariaDB (dipakai saat migrasi sungguhan). */
  async loadFromMariaDB() {
    const c = COLUMNS.users;
    const cols = [c.id, c.display_name, c.nik].filter(Boolean).map(db.escapeId).join(', ');
    const rows = await db.query(`SELECT ${cols} FROM ${db.escapeId(TABLES.users)}`);

    for (const r of rows) {
      this._add({
        id: r[c.id],
        name: c.display_name ? r[c.display_name] : '',
        nik: c.nik ? r[c.nik] : '',
      });
    }

    this.loaded = true;
    return rows.length;
  }

  /** Sumber cadangan: Firestore (dipakai saat --dry-run, karena tabel masih kosong). */
  async loadFromFirestore(firestore, streamCollection) {
    let total = 0;
    for await (const doc of streamCollection(firestore, 'users', { pageSize: 500 })) {
      const d = doc.data || {};
      this._add({ id: d.id || doc.id, name: d.name || '', nik: d.nik || '' });
      total += 1;
    }
    this.loaded = true;
    return total;
  }

  /**
   * @returns {{ userId: string, matchedBy: 'nik'|'name'|null }}
   *          matchedBy null berarti jatuh ke akun penampung.
   */
  resolve({ nik, name }) {
    const nk = nikKey(nik);
    if (nk && !this.ambiguousNiks.has(nk) && this.byNik.has(nk)) {
      this.stats.byNik += 1;
      return { userId: this.byNik.get(nk).id, matchedBy: 'nik' };
    }

    const nm = nameKey(name);
    if (nm && !this.ambiguousNames.has(nm) && this.byName.has(nm)) {
      this.stats.byName += 1;
      return { userId: this.byName.get(nm).id, matchedBy: 'name' };
    }

    this.stats.unresolved += 1;
    return { userId: this.legacyUserId, matchedBy: null };
  }

  /** user_id yang datang langsung dari Firestore (audit_logs & bug_reports). */
  exists(userId) {
    return userId !== null && userId !== undefined && this.byId.has(String(userId));
  }

  /** Akun penampung harus benar-benar ada, kalau tidak FK akan menolak. */
  legacyUserExists() {
    return this.byId.has(String(this.legacyUserId));
  }

  report() {
    const total = this.stats.byNik + this.stats.byName + this.stats.unresolved;
    if (!total) return;

    log.detail(
      `user_id: ${this.stats.byNik} via NIK, ${this.stats.byName} via nama, ` +
        `${this.stats.unresolved} tidak ketemu (diarahkan ke "${this.legacyUserId}")`
    );

    if (this.ambiguousNiks.size) {
      log.warn(
        `${this.ambiguousNiks.size} NIK dipakai lebih dari satu user: ` +
          `${[...this.ambiguousNiks].slice(0, 5).join(', ')}${this.ambiguousNiks.size > 5 ? ', ...' : ''}`
      );
    }
    if (this.ambiguousNames.size) {
      log.warn(
        `${this.ambiguousNames.size} nama dimiliki lebih dari satu user, tidak dipakai untuk lookup: ` +
          `${[...this.ambiguousNames].slice(0, 5).join(', ')}${this.ambiguousNames.size > 5 ? ', ...' : ''}`
      );
    }
  }
}

module.exports = { UserResolver, DEFAULT_LEGACY_USER_ID };
