'use strict';

/**
 * Tampilkan struktur tabel yang benar-benar ada di MariaDB Hostinger.
 *
 * Dipakai untuk memastikan nama kolom di config/mapping.js sudah benar,
 * tanpa perlu buka phpMyAdmin.
 *
 *   npm run inspect:schema
 */

require('dotenv').config();

const db = require('../database/mysql');
const { TABLES, COLUMNS } = require('../config/mapping');
const log = require('../lib/logger');

async function main() {
  log.title('STRUKTUR TABEL MARIADB');

  const info = await db.ping();
  log.detail(`server: ${info.version}   database: ${info.db}`);

  const tables = await db.listTables();
  log.detail(`tabel: ${tables.join(', ')}`);

  for (const [key, table] of Object.entries(TABLES)) {
    log.blank();

    if (!tables.includes(table)) {
      log.error(`${table} — TIDAK ADA di database`);
      continue;
    }

    const cols = await db.describeTable(table);
    const rows = await db.countRows(table);
    const mappedPhysical = new Set(Object.values(COLUMNS[key]).filter(Boolean));

    console.log(`${log.color.bold(table)}  ${log.color.dim(`(${rows} baris)`)}`);
    console.log(`  ${'-'.repeat(74)}`);

    for (const c of cols) {
      const used = mappedPhysical.has(c.name);
      const mark = used ? log.color.green('*') : log.color.dim(' ');
      const nullable = c.nullable ? 'NULL' : 'NOT NULL';
      const extra = [c.key === 'PRI' ? 'PK' : '', c.extra || ''].filter(Boolean).join(' ');

      console.log(
        `  ${mark} ${c.name.padEnd(24)} ${String(c.type).padEnd(22)} ${nullable.padEnd(9)} ${extra}`
      );
    }

    const inDb = new Set(cols.map((c) => c.name));
    const notInDb = [...mappedPhysical].filter((c) => !inDb.has(c));
    if (notInDb.length) {
      console.log(`  ${log.color.red('!')} ada di mapping tapi tidak ada di tabel: ${notInDb.join(', ')}`);
    }
  }

  log.blank();
  log.detail(`${log.color.green('*')} = kolom ini diisi oleh migration tool`);
  log.detail('Kolom tanpa tanda tidak akan disentuh migrasi.');
}

main()
  .then(async () => {
    await db.closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    log.error(err.message);
    if (process.env.DEBUG) console.error(err);
    await db.closePool().catch(() => {});
    process.exit(1);
  });
