'use strict';

/**
 * Intip isi Firestore: jumlah dokumen, semua nama field yang benar-benar
 * dipakai, dan satu contoh dokumen per collection.
 *
 * Berguna untuk menemukan field yang tidak ada di types.ts (data lama yang
 * ditulis versi frontend sebelumnya) sebelum migrasi dijalankan.
 *
 *   npm run inspect:firestore
 */

require('dotenv').config();

const { connectFirestore, streamCollection, countCollection } = require('../firebase/firebase');
const { COLLECTIONS } = require('../config/mapping');
const log = require('../lib/logger');

const SAMPLE_SIZE = 200;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value && typeof value.toDate === 'function') return 'timestamp';
  return typeof value;
}

async function main() {
  log.title('ISI FIRESTORE');

  const { db, projectId, databaseId } = connectFirestore();
  log.detail(`project : ${projectId}`);
  log.detail(`database: ${databaseId}`);

  for (const [key, collection] of Object.entries(COLLECTIONS)) {
    log.blank();

    const total = await countCollection(db, collection);
    console.log(`${log.color.bold(collection)}  ${log.color.dim(`(${total} dokumen)`)}`);

    if (total === 0) {
      log.detail('kosong');
      continue;
    }

    // Kumpulkan nama field dari sebagian dokumen.
    const fieldStats = new Map();
    let sampled = 0;
    let firstDoc = null;

    for await (const doc of streamCollection(db, collection, { pageSize: 100, limit: SAMPLE_SIZE })) {
      if (!firstDoc) firstDoc = doc;
      sampled += 1;

      for (const [field, value] of Object.entries(doc.data || {})) {
        if (!fieldStats.has(field)) fieldStats.set(field, { count: 0, types: new Set() });
        const stat = fieldStats.get(field);
        stat.count += 1;
        stat.types.add(typeOf(value));
      }
    }

    console.log(`  ${'-'.repeat(74)}`);
    console.log(`  ${log.color.dim(`field (dari ${sampled} dokumen contoh)`)}`);

    const sorted = [...fieldStats.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [field, stat] of sorted) {
      const pct = Math.round((stat.count / sampled) * 100);
      const coverage = pct === 100 ? 'selalu ada' : `${pct}% dokumen`;
      console.log(
        `    ${field.padEnd(24)} ${[...stat.types].join('|').padEnd(14)} ${log.color.dim(coverage)}`
      );
    }

    if (firstDoc) {
      const preview = JSON.stringify(
        firstDoc.data,
        (k, v) => {
          if (typeof v === 'string' && v.length > 80) return v.slice(0, 80) + `... (${v.length} karakter)`;
          return v;
        },
        2
      );
      console.log(`  ${log.color.dim('contoh dokumen: ' + firstDoc.id)}`);
      console.log(
        preview
          .split('\n')
          .map((l) => '    ' + log.color.dim(l))
          .join('\n')
      );
    }
  }

  log.blank();
  log.info('Bandingkan daftar field di atas dengan config/mapping.js.');
  log.detail('Field yang tidak ada di mapping TIDAK akan ikut dimigrasi.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error(err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
