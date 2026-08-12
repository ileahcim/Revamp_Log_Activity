'use strict';

/**
 * Pengujian kuncian read-only Firestore — TIDAK menyentuh Firestore sungguhan
 * dan tidak butuh serviceAccountKey.json maupun koneksi internet.
 *
 * Latar belakang
 * --------------
 * `npm run dry` pernah mati di dokumen pertama collection users dengan pesan
 * "[FIRESTORE READ-ONLY] Objek Firestore tidak boleh dimodifikasi." padahal
 * tidak ada satu pun kode migrasi yang menulis ke Firestore.
 *
 * Biangnya: getter QuerySnapshot#docs milik firebase-admin menyimpan hasilnya
 * sendiri (`this._materializedDocs = ...`). Dulu proxy meneruskan dirinya
 * sebagai receiver, jadi `this` di dalam getter itu = proxy, dan cache internal
 * pustaka terbaca sebagai percobaan menulis.
 *
 * Supaya kejadian itu ketahuan lagi tanpa menghabiskan kuota Firestore, tes
 * pertama di bawah memakai kelas QuerySnapshot ASLI dari @google-cloud/firestore
 * (dependency firebase-admin), bukan tiruan. Kalau pustakanya diperbarui dan
 * pola memoisasinya berubah, tes ini yang lebih dulu berbunyi.
 */

const { QuerySnapshot } = require('@google-cloud/firestore');
const { readOnly, streamCollection, countCollection } = require('../firebase/firebase');

// ---------------------------------------------------------------------------
// Firestore tiruan
// ---------------------------------------------------------------------------

/**
 * Dipakai di semua method tulis. Kalau pesan ini sampai muncul, artinya proxy
 * membiarkan panggilannya lewat dan yang asli benar-benar dijalankan.
 */
function bocor(nama) {
  return new Error(`BOCOR: ${nama}() benar-benar dijalankan`);
}

class DocumentReference {
  constructor(id) {
    this._id = id;
  }
  get id() {
    return this._id;
  }
  set() {
    throw bocor('DocumentReference.set');
  }
  update() {
    throw bocor('DocumentReference.update');
  }
  delete() {
    throw bocor('DocumentReference.delete');
  }
  create() {
    throw bocor('DocumentReference.create');
  }
}

class QueryDocumentSnapshot {
  constructor(id, fields) {
    this._id = id;
    this._fields = fields;
    this._ref = new DocumentReference(id);
  }
  get id() {
    return this._id;
  }
  get ref() {
    return this._ref;
  }
  data() {
    return { ...this._fields };
  }
}

class AggregateQuerySnapshot {
  constructor(jumlah) {
    this._jumlah = jumlah;
  }
  data() {
    return { count: this._jumlah };
  }
}

class AggregateQuery {
  constructor(query) {
    this._query = query;
  }
  async get() {
    const semua = this._query._ambil({ abaikanLimit: true });
    return new AggregateQuerySnapshot(semua.length);
  }
}

class Query {
  constructor(store, nama, opsi = {}) {
    this._store = store;
    this._nama = nama;
    this._opsi = opsi;
  }

  _turun(tambahan) {
    const Kelas = Query;
    return new Kelas(this._store, this._nama, { ...this._opsi, ...tambahan });
  }

  orderBy() {
    return this._turun({});
  }
  limit(n) {
    return this._turun({ limit: n });
  }
  startAfter(cursor) {
    return this._turun({ startAfter: cursor });
  }
  count() {
    return new AggregateQuery(this);
  }

  _ambil({ abaikanLimit = false } = {}) {
    let sisa = this._store[this._nama] || [];
    if (this._opsi.startAfter) sisa = sisa.filter((d) => d.id > this._opsi.startAfter);
    if (!abaikanLimit && this._opsi.limit) sisa = sisa.slice(0, this._opsi.limit);
    return sisa;
  }

  async get() {
    const docs = this._ambil().map((d) => new QueryDocumentSnapshot(d.id, d.data));
    // QuerySnapshot ASLI — inilah yang dulu memicu trap set().
    return new QuerySnapshot(
      this,
      null,
      docs.length,
      () => docs,
      () => []
    );
  }
}

class CollectionReference extends Query {
  add() {
    throw bocor('CollectionReference.add');
  }
  doc(id) {
    return new DocumentReference(id);
  }
}

class Firestore {
  constructor(store) {
    this._store = store;
  }
  collection(nama) {
    return new CollectionReference(this._store, nama);
  }
  batch() {
    throw bocor('Firestore.batch');
  }
  bulkWriter() {
    throw bocor('Firestore.bulkWriter');
  }
  runTransaction() {
    throw bocor('Firestore.runTransaction');
  }
  recursiveDelete() {
    throw bocor('Firestore.recursiveDelete');
  }
}

/** Dokumen contoh; id sengaja urut supaya cursor documentId() bisa diuji. */
const STORE = {
  users: [
    { id: 'uid-01', data: { email: 'budi@example.com', nik: 'TS-0001' } },
    { id: 'uid-02', data: { email: 'andi@example.com', nik: 'TS-0002' } },
    { id: 'uid-03', data: { email: 'siti@example.com', nik: 'TS-0003' } },
    { id: 'uid-04', data: { email: 'rudi@example.com', nik: 'TS-0004' } },
    { id: 'uid-05', data: { email: 'agus@example.com', nik: 'TS-0005' } },
  ],
};

const buatDb = () => readOnly(new Firestore(STORE));

async function kumpulkan(iterator) {
  const hasil = [];
  for await (const item of iterator) hasil.push(item);
  return hasil;
}

// ---------------------------------------------------------------------------

module.exports = {
  nama: 'Kuncian read-only Firestore (firebase/firebase.js)',

  tests: {
    'QuerySnapshot#docs asli bisa dibaca lewat proxy (regresi npm run dry)': (assert) => {
      const docs = [new QueryDocumentSnapshot('uid-01', { email: 'a@b.c' })];
      const snap = new QuerySnapshot({}, null, docs.length, () => docs, () => []);
      const p = readOnly(snap);

      assert.sama(p.empty, false, 'snap.empty');
      assert.sama(p.size, 1, 'snap.size');

      const dibaca = assert.tidakMelempar(
        () => p.docs,
        'membaca snap.docs seharusnya operasi baca biasa'
      );
      assert.sama(dibaca.length, 1, 'jumlah dokumen');
      assert.sama(dibaca[0].id, 'uid-01', 'id dokumen pertama');
    },

    'memoisasi internal pustaka mendarat di objek asli, bukan lewat proxy': (assert) => {
      const docs = [new QueryDocumentSnapshot('uid-01', {})];
      const snap = new QuerySnapshot({}, null, 1, () => docs, () => []);

      assert.sama(snap._materializedDocs, null, 'sebelum dibaca cache masih kosong');
      readOnly(snap).docs;
      assert.ok(snap._materializedDocs !== null, 'cache tersimpan di objek asli');
    },

    'docs dibaca berkali-kali tetap array yang sama': (assert) => {
      const docs = [new QueryDocumentSnapshot('uid-01', {})];
      const p = readOnly(new QuerySnapshot({}, null, 1, () => docs, () => []));
      assert.ok(p.docs === p.docs, 'snap.docs seharusnya stabil, bukan array baru tiap akses');
    },

    'isi array docs ikut terkunci (doc.ref tidak bisa dipakai menulis)': (assert) => {
      const docs = [new QueryDocumentSnapshot('uid-01', {})];
      const p = readOnly(new QuerySnapshot({}, null, 1, () => docs, () => []));
      const doc = p.docs[0];

      for (const operasi of ['set', 'update', 'delete', 'create']) {
        const e = assert.melempar(() => doc.ref[operasi]({}), 'READ-ONLY', `doc.ref.${operasi}()`);
        assert.ok(!e.message.includes('BOCOR'), `doc.ref.${operasi}() tidak boleh benar-benar jalan`);
      }
    },

    'streamCollection membaca seluruh collection tanpa memicu kuncian': async (assert) => {
      // pageSize 2 memaksa tiga kali putaran + pemakaian cursor startAfter.
      const hasil = await kumpulkan(streamCollection(buatDb(), 'users', { pageSize: 2 }));

      assert.sama(hasil.length, 5, 'jumlah dokumen terbaca');
      assert.samaDalam(
        hasil.map((d) => d.id),
        ['uid-01', 'uid-02', 'uid-03', 'uid-04', 'uid-05'],
        'urutan id'
      );
      assert.samaDalam(hasil[0].data, { email: 'budi@example.com', nik: 'TS-0001' }, 'isi dokumen');
    },

    'streamCollection menghormati limit dan startAfter': async (assert) => {
      const dibatasi = await kumpulkan(streamCollection(buatDb(), 'users', { pageSize: 2, limit: 3 }));
      assert.samaDalam(dibatasi.map((d) => d.id), ['uid-01', 'uid-02', 'uid-03'], 'limit=3');

      const lanjutan = await kumpulkan(
        streamCollection(buatDb(), 'users', { pageSize: 2, startAfter: 'uid-03' })
      );
      assert.samaDalam(lanjutan.map((d) => d.id), ['uid-04', 'uid-05'], 'startAfter=uid-03');
    },

    'countCollection memakai aggregate count tanpa memicu kuncian': async (assert) => {
      const jumlah = await countCollection(buatDb(), 'users');
      assert.sama(jumlah, 5, 'jumlah dokumen');
    },

    'data() menghasilkan objek biasa yang boleh diubah migrator': async (assert) => {
      const [pertama] = await kumpulkan(streamCollection(buatDb(), 'users', { limit: 1 }));

      assert.tidakMelempar(() => {
        pertama.data.nik = 'DIUBAH';
      }, 'migrator boleh mengubah salinan hasil data()');

      assert.sama(STORE.users[0].data.nik, 'TS-0001', 'dokumen sumber tidak ikut berubah');
    },

    'semua operasi tulis tetap diblokir': (assert) => {
      const db = buatDb();

      for (const operasi of ['batch', 'bulkWriter', 'runTransaction', 'recursiveDelete']) {
        const e = assert.melempar(() => db[operasi](), 'READ-ONLY', `db.${operasi}()`);
        assert.ok(!e.message.includes('BOCOR'), `db.${operasi}() tidak boleh benar-benar jalan`);
      }

      const col = db.collection('users');
      const e = assert.melempar(() => col.add({}), 'READ-ONLY', 'collection.add()');
      assert.ok(!e.message.includes('BOCOR'), 'collection.add() tidak boleh benar-benar jalan');

      const ref = col.doc('uid-01');
      for (const operasi of ['set', 'update', 'delete', 'create']) {
        const g = assert.melempar(() => ref[operasi]({}), 'READ-ONLY', `doc.${operasi}()`);
        assert.ok(!g.message.includes('BOCOR'), `doc.${operasi}() tidak boleh benar-benar jalan`);
      }
    },

    'objek turunan hasil chaining ikut terkunci': (assert) => {
      const db = buatDb();
      const q = db.collection('users').orderBy('id').limit(2).startAfter('uid-01');
      assert.melempar(() => q.delete(), 'READ-ONLY', 'query hasil chaining');
    },

    'objek dari method async ikut terkunci': async (assert) => {
      const snap = await buatDb().collection('users').orderBy('id').limit(1).get();
      assert.melempar(() => snap.delete(), 'READ-ONLY', 'QuerySnapshot hasil await');
    },

    'menulis, menghapus, dan mendefinisikan ulang properti ditolak': (assert) => {
      const db = buatDb();

      assert.melempar(() => {
        db._store = {};
      }, 'READ-ONLY', 'assignment lewat proxy');

      assert.melempar(() => {
        delete db._store;
      }, 'READ-ONLY', 'delete lewat proxy');

      assert.melempar(
        () => Object.defineProperty(db, '_store', { value: {} }),
        'READ-ONLY',
        'defineProperty lewat proxy'
      );

      assert.samaDalam(Object.keys(STORE), ['users'], 'data sumber tidak berubah');
    },

    'pesan penolakan menyebut properti yang bersangkutan': (assert) => {
      const e = assert.melempar(() => {
        buatDb().dataPenting = 1;
      }, 'READ-ONLY');
      assert.ok(
        e.message.includes('dataPenting'),
        `pesan error harus menyebut nama properti supaya mudah dilacak, dapat: ${e.message}`
      );
    },
  },
};
