'use strict';

/**
 * Sumber kebenaran tabel master, dibaca langsung dari MariaDB.
 *
 * KENAPA TIDAK DITULIS TETAP DI KODE:
 * versi lama menyimpan daftar kategori dan kode delay sebagai konstanta di
 * migrators/tech_logs.js. Masalahnya arti tiga kode sempat salah di
 * 02_seed.sql dan baru dibetulkan oleh Backend/03_align_master_data.sql
 * (PR: Procurement -> Permit, AC: Accessories -> Access, OT: Overtime -> Other).
 * Selama daftarnya disalin di dua tempat, keduanya bisa berbeda lagi tanpa ada
 * yang sadar. Sekarang migrasi mengikuti apa pun yang ada di database.
 *
 * Dibaca di kedua mode, termasuk --dry-run: tabel master memang sudah terisi
 * sebelum migrasi dijalankan (02_seed.sql lalu 03_align_master_data.sql), jadi
 * isinya sudah benar walaupun keempat tabel data masih kosong.
 */

const db = require('../database/mysql');

/** Nama divisi yang dipakai frontend sebagai "tidak ada divisi". */
const DIVISI_KOSONG = '-';

function key(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

class MasterResolver {
  constructor() {
    this.divisions = new Map();   // nama (lowercase) -> id
    this.categories = new Set();  // kode huruf besar
    this.delayCodes = new Set();
    this.supervisors = new Set(); // nama (lowercase)
    this.defaultDivisionId = null;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this;

    for (const r of await db.query('SELECT id, name FROM master_divisions')) {
      this.divisions.set(key(r.name), Number(r.id));
    }
    for (const r of await db.query('SELECT code FROM master_categories')) {
      this.categories.add(String(r.code).toUpperCase());
    }
    for (const r of await db.query('SELECT code FROM master_delay_codes')) {
      this.delayCodes.add(String(r.code).toUpperCase());
    }
    for (const r of await db.query('SELECT name FROM master_supervisors')) {
      this.supervisors.add(key(r.name));
    }

    this.defaultDivisionId = this.divisions.get(key(DIVISI_KOSONG)) ?? null;
    this.loaded = true;

    return this;
  }

  /**
   * Masalah yang membuat migrasi tidak mungkin benar. Dicek sekali di awal,
   * jauh sebelum ada baris yang ditulis.
   *
   * @returns {string[]}
   */
  problems() {
    const out = [];

    if (!this.divisions.size) {
      out.push('Tabel master_divisions kosong. Jalankan Backend/02_seed.sql dulu.');
    } else if (this.defaultDivisionId === null) {
      out.push(
        `Divisi "${DIVISI_KOSONG}" tidak ada di master_divisions. Divisi itu dipakai sebagai ` +
          'tujuan user yang tidak punya divisi, dan kolom users.division_id NOT NULL. ' +
          'Jalankan Backend/02_seed.sql.'
      );
    }

    if (!this.categories.size) {
      out.push('Tabel master_categories kosong. Jalankan Backend/02_seed.sql dulu.');
    }
    if (!this.delayCodes.size) {
      out.push('Tabel master_delay_codes kosong. Jalankan Backend/02_seed.sql dulu.');
    }

    return out;
  }

  /** @returns {number|null} id divisi, atau null kalau namanya tidak dikenal. */
  divisionId(name) {
    const k = key(name);
    if (!k) return null;
    return this.divisions.has(k) ? this.divisions.get(k) : null;
  }

  divisionNames() {
    return [...this.divisions.keys()];
  }

  hasCategory(code) {
    return this.categories.has(String(code ?? '').toUpperCase());
  }

  hasDelayCode(code) {
    return this.delayCodes.has(String(code ?? '').toUpperCase());
  }

  hasSupervisor(name) {
    return this.supervisors.has(key(name));
  }
}

module.exports = { MasterResolver, DIVISI_KOSONG };
