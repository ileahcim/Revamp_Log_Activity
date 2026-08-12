'use strict';

/**
 * Kumpulan catatan hasil migrasi per collection.
 *
 * Yang dicatat:
 *  - skipped   : dokumen yang tidak dimigrasi (beserta alasannya)
 *  - warnings  : data masuk tapi ada yang dikoreksi (dipotong, dihitung ulang)
 *  - failed    : baris yang ditolak MariaDB
 *
 * Hasilnya ditulis ke reports/ sebagai JSON + CSV supaya bisa dibuka di Excel
 * dan dicocokkan manual dengan data Firestore.
 */

const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, '..', 'reports');

class Report {
  constructor(name) {
    this.name = name;
    this.startedAt = new Date();
    this.read = 0;
    this.written = 0;
    this.skipped = [];
    this.warnings = [];
    this.failed = [];
  }

  skip(docId, reason, extra) {
    this.skipped.push({ id: docId, reason, ...(extra || {}) });
  }

  warn(docId, field, message) {
    this.warnings.push({ id: docId, field, message });
  }

  fail(docId, error) {
    this.failed.push({ id: docId, error });
  }

  get durationMs() {
    return Date.now() - this.startedAt.getTime();
  }

  summary() {
    return {
      collection: this.name,
      read: this.read,
      written: this.written,
      skipped: this.skipped.length,
      warnings: this.warnings.length,
      failed: this.failed.length,
      durationSec: Math.round(this.durationMs / 100) / 10,
    };
  }

  /** Ringkasan alasan skip, diurutkan dari yang terbanyak. */
  skipBreakdown() {
    const counts = new Map();
    for (const s of this.skipped) counts.set(s.reason, (counts.get(s.reason) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  save(stamp) {
    if (!this.skipped.length && !this.warnings.length && !this.failed.length) return null;

    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

    const base = path.join(REPORT_DIR, `${stamp}-${this.name}`);

    fs.writeFileSync(
      `${base}.json`,
      JSON.stringify(
        {
          summary: this.summary(),
          skipped: this.skipped,
          warnings: this.warnings,
          failed: this.failed,
        },
        null,
        2
      )
    );

    const csvRows = [
      ['jenis', 'doc_id', 'keterangan'],
      ...this.skipped.map((s) => ['SKIP', s.id, s.reason]),
      ...this.warnings.map((w) => ['WARNING', w.id, `${w.field}: ${w.message}`]),
      ...this.failed.map((f) => ['GAGAL', f.id, f.error]),
    ];

    const csv = csvRows
      .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    fs.writeFileSync(`${base}.csv`, '﻿' + csv, 'utf8');

    return `${base}.csv`;
  }
}

module.exports = { Report, REPORT_DIR };
