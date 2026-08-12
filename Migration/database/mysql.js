'use strict';

/**
 * Koneksi & helper tulis ke MariaDB Hostinger.
 */

const mysql = require('mysql2/promise');
const log = require('../lib/logger');

let pool = null;

function escapeId(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

function getPool() {
  if (pool) return pool;

  const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Konfigurasi .env belum lengkap: ${missing.join(', ')}`);
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 4,
    // Ambil DATE/DATETIME sebagai string apa adanya, jangan diubah jadi objek
    // Date JS (yang akan ikut timezone laptop dan menggeser jam).
    dateStrings: true,
    multipleStatements: false,
    enableKeepAlive: true,
    ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/** Cek koneksi + tampilkan info server. */
async function ping() {
  const rows = await query('SELECT VERSION() AS version, DATABASE() AS db, NOW() AS now');
  return rows[0];
}

/** Daftar kolom sebuah tabel, lengkap dengan tipe & nullability. */
async function describeTable(table) {
  const rows = await query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA,
            CHARACTER_MAXIMUM_LENGTH
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [process.env.DB_NAME, table]
  );

  return rows.map((r) => ({
    name: r.COLUMN_NAME,
    type: r.COLUMN_TYPE,
    nullable: r.IS_NULLABLE === 'YES',
    key: r.COLUMN_KEY,
    default: r.COLUMN_DEFAULT,
    extra: r.EXTRA,
    maxLength: r.CHARACTER_MAXIMUM_LENGTH,
  }));
}

async function listTables() {
  const rows = await query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [process.env.DB_NAME]
  );
  return rows.map((r) => r.TABLE_NAME);
}

async function countRows(table) {
  const rows = await query(`SELECT COUNT(*) AS total FROM ${escapeId(table)}`);
  return Number(rows[0].total);
}

/** Nilai max_allowed_packet server (byte). Penting untuk batch bug report. */
async function maxAllowedPacket() {
  try {
    const rows = await query(`SHOW VARIABLES LIKE 'max_allowed_packet'`);
    return rows.length ? Number(rows[0].Value) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Tulis banyak baris sekaligus.
 *
 * @param {string}   table    nama tabel
 * @param {string[]} columns  nama kolom fisik
 * @param {any[][]}  rows     array of array, urutannya mengikuti `columns`
 * @param {object}   opts     { mode: 'upsert'|'ignore'|'insert', pkColumns: [] }
 * @returns {Promise<number>} jumlah baris terpengaruh
 */
async function bulkWrite(table, columns, rows, opts = {}) {
  if (!rows.length) return 0;

  const mode = opts.mode || 'upsert';
  const pkColumns = opts.pkColumns || [];
  const cols = columns.map(escapeId).join(', ');

  let sql;
  if (mode === 'ignore') {
    sql = `INSERT IGNORE INTO ${escapeId(table)} (${cols}) VALUES ?`;
  } else if (mode === 'insert') {
    sql = `INSERT INTO ${escapeId(table)} (${cols}) VALUES ?`;
  } else {
    const updatable = columns.filter((c) => !pkColumns.includes(c));
    if (!updatable.length) {
      sql = `INSERT IGNORE INTO ${escapeId(table)} (${cols}) VALUES ?`;
    } else {
      const setClause = updatable
        .map((c) => `${escapeId(c)} = VALUES(${escapeId(c)})`)
        .join(', ');
      sql = `INSERT INTO ${escapeId(table)} (${cols}) VALUES ? ON DUPLICATE KEY UPDATE ${setClause}`;
    }
  }

  const [result] = await getPool().query(sql, [rows]);
  return result.affectedRows || 0;
}

/**
 * Tulis batch dengan fallback per baris.
 *
 * Kalau satu batch gagal (misal satu baris kepanjangan atau melanggar FK),
 * batch itu diulang baris-per-baris supaya baris lain tetap masuk dan baris
 * yang bermasalah bisa dicatat spesifik di laporan — bukan menggagalkan
 * 500 baris sekaligus.
 *
 * `written` = baris yang diterima MariaDB (dipakai untuk laporan).
 * `affected` = angka mentah affectedRows; JANGAN dipakai sebagai jumlah baris:
 * pada ON DUPLICATE KEY UPDATE, MySQL/MariaDB menghitung baris yang berubah
 * sebagai 2, jadi angkanya bisa lebih besar dari jumlah baris sebenarnya.
 *
 * @returns {Promise<{ written: number, affected: number, failed: Array<{ row: any[], error: string }> }>}
 */
async function bulkWriteSafe(table, columns, rows, opts = {}) {
  if (!rows.length) return { written: 0, affected: 0, failed: [] };

  try {
    const affected = await bulkWrite(table, columns, rows, opts);
    return { written: rows.length, affected, failed: [] };
  } catch (e) {
    log.progressDone();
    log.warn(`Batch ${table} gagal (${e.code || e.message}). Mengulang baris per baris...`);

    let affected = 0;
    let written = 0;
    const failed = [];

    for (const row of rows) {
      try {
        affected += await bulkWrite(table, columns, [row], opts);
        written += 1;
      } catch (rowErr) {
        failed.push({ row, error: `${rowErr.code || 'ERR'}: ${rowErr.message}` });
      }
    }

    return { written, affected, failed };
  }
}

module.exports = {
  getPool,
  closePool,
  query,
  ping,
  describeTable,
  listTables,
  countRows,
  maxAllowedPacket,
  bulkWrite,
  bulkWriteSafe,
  escapeId,
};
