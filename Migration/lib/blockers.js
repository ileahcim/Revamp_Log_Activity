'use strict';

/**
 * Masalah data yang tidak boleh diselesaikan sendiri oleh tool.
 *
 * Ada dua jenis kesalahan pada migrasi ini:
 *
 *   warning  nilai dikoreksi, migrasi jalan terus, semuanya tercatat di
 *            reports/. Contoh: nama dirapikan, durasi dihitung ulang.
 *   blocker  tool tidak punya dasar untuk memutuskan, dan menebak berarti
 *            merusak data. Contoh: dua user memakai NIK yang sama, atau nilai
 *            yang lebih panjang dari kolom tujuannya sehingga harus dipotong.
 *
 * Daftar kolom yang tidak boleh dipotong ada di NO_TRUNCATE pada
 * config/mapping.js, bukan di berkas ini.
 *
 * Blocker BUKAN alasan untuk melonggarkan NO_TRUNCATE. Ia sedang bekerja
 * sebagaimana mestinya: memaksa keputusan diambil manusia. Kasus nyata yang
 * sudah terjadi -- tech_logs.sn kepanjangan pada tujuh log lama -- diselesaikan
 * dengan memperlebar kolomnya (Backend/05_widen_sn.sql), bukan dengan
 * mengeluarkan sn dari daftar.
 *
 * Blocker diperlakukan berbeda tergantung mode:
 *
 *   --dry-run   dikumpulkan semua dulu supaya bisa dilihat sekaligus, lalu
 *               proses keluar dengan kode 2. Tidak ada yang ditulis, jadi aman
 *               untuk terus berjalan.
 *   migrasi     berhenti pada temuan pertama. Menulis separuh data lalu
 *               berhenti jauh lebih merepotkan daripada berhenti lebih awal;
 *               mode upsert membuat pengulangan aman setelah datanya dibetulkan.
 */

class MigrationBlocked extends Error {
  constructor(item) {
    super(`${item.collection}/${item.docId}: ${item.message}`);
    this.name = 'MigrationBlocked';
    this.item = item;
  }
}

class Blockers {
  constructor({ dryRun = false } = {}) {
    this.dryRun = dryRun;
    this.items = [];
  }

  /**
   * @param {{ collection: string, docId: string, field?: string,
   *           message: string, hint?: string }} item
   */
  add(item) {
    this.items.push(item);

    if (!this.dryRun) throw new MigrationBlocked(item);
  }

  get count() {
    return this.items.length;
  }

  /** Kelompokkan per collection + field supaya ringkasannya tidak berhalaman. */
  grouped() {
    const map = new Map();

    for (const item of this.items) {
      const key = `${item.collection}.${item.field || '-'}`;
      if (!map.has(key)) map.set(key, { key, hint: item.hint, contoh: [], total: 0 });
      const g = map.get(key);
      g.total += 1;
      if (g.contoh.length < 5) g.contoh.push(item);
    }

    return [...map.values()];
  }
}

module.exports = { Blockers, MigrationBlocked };
