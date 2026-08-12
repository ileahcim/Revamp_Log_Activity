'use strict';

/**
 * Koneksi Firestore untuk migrasi.
 *
 * DUA HAL PENTING:
 *
 * 1. Project ini memakai NAMED DATABASE, bukan "(default)".
 *    Lihat Frontend/firebase-applet-config.json -> firestoreDatabaseId.
 *    Kalau databaseId tidak diisi, firebase-admin akan konek ke "(default)"
 *    yang isinya kosong -> migrasi "sukses" tapi 0 dokumen.
 *
 * 2. Firestore di sini WAJIB READ ONLY.
 *    Instance yang diekspor dibungkus Proxy yang melempar error kalau ada
 *    kode yang memanggil set/update/delete/create/add/batch/runTransaction,
 *    atau kalau ada yang menulis/menghapus properti objek Firestore.
 *    Jadi kalaupun ada salah ketik di migrator, Firestore tidak akan tersentuh.
 *
 *    Yang dijaga adalah kode KITA. Memoisasi internal firebase-admin (getter
 *    yang menyimpan hasilnya sendiri) tidak ikut kena — penjelasannya ada di
 *    komentar readOnly() di bawah. Regresinya dijaga tests/firestore-readonly.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');

/** Semua operasi yang bisa mengubah data -> diblokir total. */
const BLOCKED_METHODS = new Set([
  'set',
  'update',
  'delete',
  'create',
  'add',
  'batch',
  'bulkWriter',
  'runTransaction',
  'recursiveDelete',
  'deleteAll',
]);

/** Objek Firestore yang perlu ikut dibungkus saat dikembalikan sebuah method. */
const WRAPPABLE = new Set([
  'Firestore',
  'CollectionReference',
  'DocumentReference',
  'Query',
  'CollectionGroup',
  'AggregateQuery',
  'QuerySnapshot',
  'QueryDocumentSnapshot',
  'DocumentSnapshot',
  'AggregateQuerySnapshot',
]);

function shouldWrap(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.constructor &&
    WRAPPABLE.has(value.constructor.name)
  );
}

/**
 * Satu proxy per objek asli, supaya `snap.docs === snap.docs` tetap benar dan
 * tidak lahir ribuan proxy baru setiap kali properti yang sama dibaca.
 */
const proxyCache = new WeakMap();

/**
 * Bungkus nilai balikan kalau memang objek Firestore.
 *
 * Array ikut ditelusuri: `QuerySnapshot.docs` mengembalikan array biasa, dan
 * setiap elemennya punya `.ref` yang bisa dipakai menulis. Kalau arraynya
 * dilewatkan apa adanya, `snap.docs[0].ref.delete()` lolos dari kuncian.
 */
function bungkus(value) {
  if (Array.isArray(value)) {
    if (!value.some(shouldWrap)) return value;

    const sudah = proxyCache.get(value);
    if (sudah) return sudah;

    const hasil = value.map((v) => (shouldWrap(v) ? readOnly(v) : v));
    proxyCache.set(value, hasil);
    return hasil;
  }

  return shouldWrap(value) ? readOnly(value) : value;
}

function tolak(prop, aksi) {
  return new Error(
    `[FIRESTORE READ-ONLY] ${aksi} properti "${String(prop)}" ditolak. ` +
      `Migration tool tidak boleh mengubah Firestore.`
  );
}

function readOnly(target) {
  const sudah = proxyCache.get(target);
  if (sudah) return sudah;

  const proxy = new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'string' && BLOCKED_METHODS.has(prop)) {
        return () => {
          throw new Error(
            `[FIRESTORE READ-ONLY] Operasi tulis "${prop}()" diblokir. ` +
              `Migration tool tidak boleh mengubah Firestore.`
          );
        };
      }

      // PENTING: receiver sengaja diisi `obj`, BUKAN proxy-nya.
      //
      // Kalau proxy yang dipakai sebagai receiver, getter milik firebase-admin
      // dijalankan dengan `this` = proxy. Beberapa getter menyimpan hasilnya
      // sendiri (memoisasi), contohnya QuerySnapshot#docs:
      //
      //     get docs() {
      //       if (this._materializedDocs) return this._materializedDocs;
      //       this._materializedDocs = this._docs();   // <-- kena trap set()
      //       ...
      //     }
      //
      // Assignment itu murni cache di memori, tidak menyentuh Firestore, tapi
      // lewat proxy ia terbaca sebagai "ada yang mau menulis" dan migrasi mati
      // di dokumen pertama. Dengan receiver = obj, getter bekerja di objek
      // aslinya; trap set() di bawah tetap menjaga kode kita sendiri.
      const value = Reflect.get(obj, prop, obj);

      if (typeof value === 'function') {
        return function (...args) {
          const result = value.apply(obj, args);
          if (result && typeof result.then === 'function') {
            return result.then(bungkus);
          }
          return bungkus(result);
        };
      }

      // `snapshot.ref` bisa dipakai untuk menulis -> ikut dikunci.
      return bungkus(value);
    },

    set(_obj, prop) {
      throw tolak(prop, 'Menulis');
    },

    deleteProperty(_obj, prop) {
      throw tolak(prop, 'Menghapus');
    },

    defineProperty(_obj, prop) {
      throw tolak(prop, 'Mendefinisikan ulang');
    },
  });

  proxyCache.set(target, proxy);
  return proxy;
}

let cached = null;

function connectFirestore() {
  if (cached) return cached;

  const keyPath = path.resolve(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase/serviceAccountKey.json'
  );

  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `serviceAccountKey.json tidak ditemukan di: ${keyPath}\n` +
        `   Ambil dari Firebase Console > Project Settings > Service accounts > ` +
        `Generate new private key, lalu simpan di Migration/firebase/serviceAccountKey.json`
    );
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  const databaseId = (process.env.FIRESTORE_DATABASE_ID || '').trim();
  const raw = databaseId ? getFirestore(admin.app(), databaseId) : getFirestore(admin.app());

  cached = {
    db: readOnly(raw),
    projectId: serviceAccount.project_id,
    databaseId: databaseId || '(default)',
    clientEmail: serviceAccount.client_email,
  };

  return cached;
}

/**
 * Baca seluruh collection secara bertahap memakai cursor documentId().
 *
 * Sengaja TIDAK memakai offset/limit biasa: pada collection besar seperti
 * tech_logs, offset membuat Firestore membaca (dan menagih) semua dokumen
 * sebelumnya di setiap halaman. Cursor documentId() juga tidak butuh composite
 * index tambahan.
 *
 * @param {object} db          instance firestore (read-only)
 * @param {string} collection  nama collection
 * @param {object} opts        { pageSize, startAfter, limit }
 * @yields {{ id: string, data: object }}
 */
async function* streamCollection(db, collection, opts = {}) {
  const pageSize = opts.pageSize || 500;
  const hardLimit = opts.limit || Infinity;

  let cursor = opts.startAfter || null;
  let emitted = 0;

  for (;;) {
    let q = db.collection(collection).orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      yield { id: doc.id, data: doc.data() };
      emitted += 1;
      if (emitted >= hardLimit) return;
    }

    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < pageSize) return;
  }
}

/** Hitung jumlah dokumen tanpa mengunduh isinya (aggregate count). */
async function countCollection(db, collection) {
  try {
    const snap = await db.collection(collection).count().get();
    return snap.data().count;
  } catch (e) {
    // Fallback kalau aggregate count tidak tersedia: hitung id saja.
    let total = 0;
    for await (const _ of streamCollection(db, collection, { pageSize: 1000 })) total += 1;
    return total;
  }
}

module.exports = {
  connectFirestore,
  streamCollection,
  countCollection,
  FieldPath,
  // Diekspor supaya bisa diuji tanpa menyentuh Firestore sungguhan.
  readOnly,
  BLOCKED_METHODS,
};
