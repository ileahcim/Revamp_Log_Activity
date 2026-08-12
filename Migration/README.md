# Migration Tool — Log Activity

Memindahkan data **Firebase Firestore → MariaDB (Hostinger)**.

Tool sekali pakai. Setelah data pindah dan Backend PHP jalan, folder ini tidak
dipakai lagi (jangan dihapus dulu — laporan di `reports/` masih berguna kalau
ada data yang perlu dicek ulang).

**Firestore tidak pernah ditulis.** Semua operasi tulis (`set`, `update`,
`delete`, `add`, `batch`, `runTransaction`) diblokir di level koneksi
(`firebase/firebase.js`), jadi salah ketik di migrator pun tidak bisa merusak
data Firebase.

---

## 1. Persiapan

### a. Install

```bash
cd Migration
npm install
```

> `uuid` tidak dipakai. Semua data sudah punya id sendiri dari Firestore
> (Firebase UID untuk users, document id untuk sisanya) dan id itu dipertahankan
> apa adanya di MariaDB — supaya login Google tetap nyambung dan data lama masih
> bisa dilacak balik ke Firestore kalau perlu.

### b. Service account Firebase

Firebase Console → **Project Settings → Service accounts → Generate new private key**

Simpan hasilnya sebagai:

```
Migration/firebase/serviceAccountKey.json
```

File ini sudah masuk `.gitignore`. **Jangan pernah di-commit.**

Kalau service account-nya baru, pastikan punya role **Cloud Datastore User**
(atau Viewer) di project `gen-lang-client-0722752672`.

### c. File `.env`

```bash
cp .env.example .env
```

Lalu isi kredensial database dari hPanel Hostinger.

Dua hal yang paling sering bikin gagal:

1. **Remote MySQL belum dibuka.** hPanel → *Databases → Remote MySQL* → daftarkan
   IP publik kamu. Tanpa ini koneksi akan `ETIMEDOUT`.
2. **`FIRESTORE_DATABASE_ID`.** Project ini **tidak memakai database
   `(default)`**. Nilainya sudah diisi di `.env.example`, diambil dari
   `Frontend/firebase-applet-config.json`. Kalau dikosongkan, Firestore terbaca
   0 dokumen dan migrasi akan "berhasil" tanpa memindahkan apa pun.

---

## 2. Urutan menjalankan

Jalankan berurutan, jangan langsung ke nomor 4.

```bash
npm test                    # 0. uji kuncian read-only (offline, tanpa kuota)
npm run inspect:schema      # 1. lihat struktur tabel asli di MariaDB
npm run inspect:firestore   # 2. lihat isi & field asli di Firestore
npm run check               # 3. cek koneksi + kecocokan mapping (tidak menulis)
npm run dry                 # 4. simulasi penuh (tidak menulis)
npm run migrate             # 5. migrasi sungguhan
npm run verify              # 6. bandingkan jumlah data
```

`npm test` tidak menyentuh Firestore maupun MariaDB sama sekali, jadi boleh
dijalankan kapan saja. Isinya menjaga kuncian read-only di `firebase/firebase.js`
— lihat bagian 9.

Langkah 1 dan 2 wajib untuk migrasi pertama kali: keduanya menampilkan struktur
yang sebenarnya, sehingga ketahuan kalau `config/mapping.js` perlu disesuaikan.

**Kelima skrip SQL di `Backend/` harus sudah dijalankan lebih dulu**, berurutan:

```
01_schema.sql  ->  02_seed.sql  ->  03_align_master_data.sql  ->  04_legacy_user.sql
               ->  05_widen_sn.sql
```

Tanpa nomor 5, migrasi berhenti di tujuh log lama yang `sn`-nya lebih panjang
dari `VARCHAR(100)`.

`npm run check` memeriksa dua hal sekaligus dan menolak jalan kalau salah
satunya belum siap:

1. struktur tabel cocok dengan `config/mapping.js`
2. tabel master sudah terisi dan akun penampung `legacy-unknown` sudah ada

Yang kedua sering terlewat. Tanpa isi `master_divisions`, setiap user gagal
karena `division_id` NOT NULL; tanpa akun penampung, setiap log yang tidak
ketemu pemiliknya ditolak foreign key.

Untuk uji coba kecil dulu:

```bash
node migrate.js --only=users --limit=5 --dry-run
```

---

## 3. Urutan migrasi & alasannya

| # | Collection         | Tabel              | Kenapa urutannya begini |
|---|--------------------|--------------------|-------------------------|
| 1 | `users`            | `users`            | Jadi tujuan FK tiga tabel lain |
| 2 | `tech_bug_reports` | `tech_bug_reports` | Paling sedikit, sekaligus uji coba koneksi |
| 3 | `audit_logs`       | `audit_logs`       | — |
| 4 | `tech_logs`        | `tech_logs`        | Paling besar, dijalankan terakhir |

---

## 4. Yang perlu diketahui soal datanya

### `tech_logs` tidak punya `userId`

Dokumen `tech_logs` di Firestore hanya menyimpan `nik` dan `nama_technician`,
tidak ada `userId` sama sekali (lihat `Frontend/src/types.ts`). Padahal
`tech_logs` di MariaDB punya FK `user_id`.

`lib/user-resolver.js` merekonstruksinya:

1. cocokkan **NIK** (paling akurat)
2. kalau gagal, cocokkan **nama yang sudah dinormalisasi**
3. kalau tetap gagal → `user_id = 'legacy-unknown'`, **baris tetap dimigrasi**

Langkah 3 **bukan** `NULL`. `tech_logs.user_id` di `Backend/01_schema.sql`
bertipe `VARCHAR(128) NOT NULL` dengan FK ke `users`, jadi setiap baris wajib
menunjuk ke satu user yang benar-benar ada. Akun penampungnya dibuat oleh
`Backend/04_legacy_user.sql` dan namanya bisa diganti lewat `LEGACY_USER_ID`
di `.env` (harus sama dengan yang di `Backend/.env`).

Kolom snapshot (`display_name`, `nik_snapshot`, `supervisor`) selalu diisi dari
dokumen Firestore, jadi walaupun barisnya bersandar ke akun penampung, nama
teknisi aslinya tetap terbaca. Backend pun masih bisa menemukannya: penyaringan
"log saya" mencocokkan `user_id` **atau** `nik_snapshot` **atau** nama. Artinya
begitu teknisi itu mendaftar ulang dengan NIK yang sama, seluruh riwayatnya
langsung muncul lagi tanpa perlu memperbaiki `user_id`.

Jumlah yang tidak ketemu dilaporkan di akhir dan detailnya ada di `reports/`.

### `users.nik` wajib diisi dan unik

Di Firestore `nik` opsional — `DEFAULT_USERS` di `Frontend/src/utils/auth.ts`
memang punya dua akun (atasan & admin) tanpa NIK. Di MariaDB kolomnya
`VARCHAR(50) NOT NULL UNIQUE`.

`lib/nik-allocator.js` menanganinya:

- punya NIK → dipakai apa adanya (dirapikan huruf besar & spasi)
- tidak punya → diberi penanda sementara `NOREG-001`, `NOREG-002`, ...
- NIK dipakai dua user berbeda → **migrasi berhenti**, lihat bagian berikutnya

Penanda dicocokkan dengan NIK yang sudah ada di tabel `users`, jadi tidak
mungkin menabrak `LEGACY-000` milik akun penampung maupun hasil migrasi
sebelumnya. Menjalankan ulang tidak menggeser nomor: user yang sama dapat
`NOREG-` yang sama.

Ganti dengan NIK asli lewat AdminPanel setelah migrasi selesai.

### Yang menghentikan migrasi

Ada dua jenis koreksi. Yang biasa cuma dicatat sebagai *warning* dan migrasi
jalan terus. Yang di daftar ini **menghentikan** migrasi, karena tool tidak
punya dasar untuk memutuskan dan menebak berarti merusak data:

| Temuan | Kenapa tidak bisa diputuskan tool |
|---|---|
| satu NIK dipakai dua user | tidak ada cara tahu siapa pemilik aslinya, dan salah tebak berarti menempelkan pekerjaan orang ke akun lain — `npm run check:nik` membantu mengumpulkan buktinya |
| `id`, `email`, `nik`, `sn`, `deskripsi_pekerjaan`, `catatan`, `description`, `image_base64` kepanjangan | memotongnya merusak data tanpa bisa dikembalikan |

Daftar lengkapnya ada di `NO_TRUNCATE` pada `config/mapping.js`. Batas
panjangnya dibaca dari `information_schema` saat `npm run check`, jadi selalu
ikut kolom yang sebenarnya ada di MariaDB; `MAX_LENGTHS` di berkas yang sama
cuma jaring pengaman, dan yang lebih kecil di antara keduanya yang dipakai.

**`sn` dulu ada di daftar ini dengan batas 100 karakter** dan menghentikan
migrasi di tujuh log lama divisi Instrument (terpanjang 1199 karakter, banyak
nomor seri dalam satu aktivitas). Yang diperbaiki adalah kolomnya, bukan
daftarnya: `Backend/05_widen_sn.sql` mengubahnya jadi `TEXT`. `sn` tetap di
`NO_TRUNCATE` sebagai jaring pengaman di batas `TEXT` yang baru.

Itu juga pola yang dipakai kalau muncul temuan serupa di kolom lain: laporkan,
putuskan bersama, lalu perlebar kolomnya lewat berkas SQL tersendiri di
`Backend/`. Jangan mengeluarkan kolom dari `NO_TRUNCATE` supaya migrasi lewat —
yang terjadi kalau begitu adalah data terpotong diam-diam.

Perilakunya beda per mode:

- `npm run dry` — dikumpulkan semua dulu lalu ditampilkan sekaligus, keluar
  dengan kode 2. Tidak ada yang ditulis, jadi aman untuk terus berjalan.
- `npm run migrate` — berhenti pada temuan pertama. Menulis separuh data lalu
  berhenti jauh lebih merepotkan. Mode `upsert` (default) aman diulang setelah
  datanya dibetulkan.

**Selalu jalankan `npm run dry` lebih dulu** supaya semua temuan terlihat
sekaligus, bukan satu per satu.

### Kolom NOT NULL yang datanya kosong

Sebelas kolom di `tech_logs` bertipe NOT NULL tanpa DEFAULT. Dokumen lama yang
fieldnya kosong akan ditolak MariaDB, jadi masing-masing punya nilai pengganti.
Semuanya tercatat per baris di `reports/`, tidak ada yang diganti diam-diam:

| Kolom | Pengganti |
|---|---|
| `display_name` | `-` |
| `nik_snapshot` | `""` (backend memperlakukannya sebagai "tidak punya NIK") |
| `supervisor` | `Belum Ditentukan` (ada di `master_supervisors`) |
| `shift` | ditebak dari `start_time`; kalau jamnya juga kosong → `Pagi` |
| `kategori_code` | `-` kalau kosong; kode asing dibiarkan apa adanya |
| `start_time`, `finish_time` | `00:00:00` |
| `duration_minutes` | `0` |
| `status` | `-` (nilai sah di ENUM-nya) |
| `deskripsi_pekerjaan` | `-` |

Hal yang sama berlaku di tabel lain: `audit_logs.user_id`,
`tech_bug_reports.user_id`, dan `tech_bug_reports.description` juga NOT NULL.

### Normalisasi nama

Frontend merapikan nama hanya **saat menampilkan** (`normalizeName()` di
`Frontend/src/utils/storage.ts`), bukan saat menyimpan. Jadi data mentah di
Firestore masih berantakan: `"  pak  BUDI  santoso "`.

Migrasi merapikannya dengan fungsi yang **persis sama**, supaya satu technician
tidak terpecah jadi beberapa nama berbeda di MariaDB. Matikan dengan
`NORMALIZE_NAMES=false` di `.env` kalau mau data mentah apa adanya.

### Timezone

`created_at` dan `timestamp` di Firestore disimpan sebagai ISO string UTC,
sementara `tanggal` diisi user dalam waktu lokal. Supaya jam di MariaDB sama
dengan yang selama ini dilihat user, default `TZ_OFFSET_MINUTES=420` (WIB).
Set `0` kalau mau menyimpan UTC.

Field `tanggal` yang sudah berformat `YYYY-MM-DD` tidak digeser — kalau digeser,
shift malam bisa pindah ke tanggal sebelumnya.

### `duration_minutes`

Nilai yang tersimpan di Firestore yang dipakai. Kalau kosong/negatif, dihitung
ulang dari `start_time`–`finish_time` (termasuk penanganan shift malam yang
melewati tengah malam, sama seperti `saveLog()` di frontend). Kalau nilai
tersimpan dan hasil hitungan berbeda, nilai tersimpan tetap dipakai dan
selisihnya dicatat sebagai warning.

### Kode kategori & delay

Keduanya **tidak** punya foreign key di `Backend/01_schema.sql` — anggapan lama
bahwa ada FK-nya keliru. Daftar kode yang sah dibaca langsung dari
`master_categories` dan `master_delay_codes` di database, bukan dari daftar yang
ditulis tetap di kode migrator.

Itu disengaja: arti tiga kode sempat salah di `02_seed.sql` dan baru dibetulkan
oleh `Backend/03_align_master_data.sql` (PR: Procurement → **Permit**, AC:
Accessories → **Access**, OT: Overtime → **Other**). Selama daftarnya disalin di
dua tempat, keduanya bisa berbeda lagi tanpa ada yang sadar. Karena itu
`npm run check` sekarang juga menolak jalan kalau tabel master masih kosong.

Perlakuan kode yang tidak ada di master:

- `kategori_code` → **disimpan apa adanya** dan dicatat. Kolomnya NOT NULL tanpa
  FK, dan nilai aslinya lebih berguna daripada tanda tanya.
- `delay_code` → `NULL` dan dicatat. Kolomnya boleh kosong.

### `output_qty` itu DECIMAL, bukan INT

Kolomnya `DECIMAL(10,2)`. Versi lama memakai konversi bilangan bulat dan
diam-diam membuang angka di belakang koma — `2.5` jadi `2`. Sekarang dua angka
di belakang koma dipertahankan. Nilai yang melebihi `99999999.99` disimpan
`NULL` dan dicatat, karena angka sebesar itu pasti salah input.

### Kolom yang tidak ada di MariaDB

Tiga field Firestore tidak punya kolom di schema V1.0:

| Firestore | Nasibnya |
|---|---|
| `audit_logs.userName` | disimpan ke kolom `description` supaya jejaknya tidak hilang |
| `tech_bug_reports.userName` | tidak dimigrasi; diambil lewat JOIN ke `users` saat dibaca |
| `tech_bug_reports.role` | sama, lewat JOIN |

Konsekuensinya nama yang tampil di layar adalah nama **sekarang**, bukan nama
saat kejadian. Aman karena FK-nya `ON DELETE RESTRICT`, jadi usernya pasti ada.

### `tech_bug_reports.status` punya tiga nilai

`Open`, `In Progress`, `Resolved`. `types.ts` di frontend baru mengenal dua,
tapi database menerima ketiganya dan backend sudah memakainya — jadi nilai
`In Progress` dari data lama tidak dipaksa jadi `Open`.

### `audit_logs` bisa lebih sedikit dari yang diharapkan

Id-nya dibuat dari `Date.now().toString()` (`addAuditLog()` di
`Frontend/src/utils/auth.ts`). Dua aksi pada milidetik yang sama saling menimpa
**di Firestore sejak awal**. Jadi kalau `npm run verify` menunjukkan selisih di
`audit_logs`, itu bawaan data lama, bukan kesalahan migrasi.

### Gambar bug report

`imageBase64` bisa ratusan KB per baris. Karena itu batch-nya kecil
(`BUG_REPORT_BATCH_SIZE`, default 10) dan dibatasi 2 MB per `INSERT` supaya
tidak menabrak `max_allowed_packet` di shared hosting. Kalau tetap gagal,
turunkan ke `3`.

Gambar tetap base64 di V1 — pindah ke file upload sudah masuk backlog V2.

---

## 5. Kalau gagal di tengah jalan

Setiap batch yang berhasil dicatat di `.migration-state.json`. Lanjutkan tanpa
mengulang dari nol:

```bash
node migrate.js --resume
```

Mode tulis default adalah `upsert` (`ON DUPLICATE KEY UPDATE`), jadi menjalankan
ulang dari awal juga aman — tidak akan ada data dobel.

Kalau satu batch ditolak MariaDB, batch itu otomatis diulang **baris per baris**
sehingga baris yang sehat tetap masuk dan baris bermasalah tercatat spesifik di
`reports/`.

---

## 6. Mengulang dari nol

```sql
-- urutannya dibalik dari urutan migrasi, karena FK
DELETE FROM tech_logs;
DELETE FROM audit_logs;
DELETE FROM tech_bug_reports;
DELETE FROM users;
```

Lalu hapus `.migration-state.json` dan jalankan `npm run migrate` lagi.
Data master (`master_divisions`, `master_supervisors`, `master_categories`,
`master_delay_codes`) berasal dari `seed.sql` — **jangan** ikut dihapus.

---

## 7. Kalau nama kolom tidak cocok

`npm run check` akan berhenti dan menampilkan nama kolom asli dari database
sebelum satu baris pun ditulis.

Perbaikannya cukup di **satu file**: `config/mapping.js`.

```js
users: {
  display_name: 'name',         // <- ganti kanannya kalau di schema.sql beda
  division_id: 'division_id',
},
audit_logs: {
  user_name: null,              // <- null = kolom tidak ada, lewati saja
}
```

Sisi kiri jangan diubah (dipakai kode migrator), sisi kanan adalah nama kolom
fisik di MariaDB.

Isinya sudah dicocokkan baris per baris dengan `Backend/01_schema.sql` pada
4 Agustus 2026. Yang sempat salah dan sudah dibetulkan:

| Ditulis sebelumnya | Yang benar |
|---|---|
| `users.display_name` | `users.name` |
| `users.division` (teks) | `users.division_id` (INT, FK ke `master_divisions`) |
| `audit_logs.user_name` | kolomnya tidak ada |
| `tech_bug_reports.user_name`, `.role` | kolomnya tidak ada |
| `tech_logs.output_qty` dianggap INT | `DECIMAL(10,2)` |
| `id` dianggap 64 karakter | `CHAR(36)` |

`tech_logs.sn` sempat masuk daftar ini juga — tool mengiranya `TEXT`, padahal
V1.0 memberinya `VARCHAR(100)`. Sejak 8 Agustus 2026 kolomnya benar-benar
`TEXT` lewat `Backend/05_widen_sn.sql`, jadi anggapan awal itu justru yang
sekarang berlaku. Batas panjangnya tidak lagi ditulis di `MAX_LENGTHS`;
dibaca langsung dari `information_schema`.

---

## 8. Struktur folder

```
Migration/
├── migrate.js              orchestrator + CLI
├── config/
│   └── mapping.js          SATU-SATUNYA tempat nama kolom  <-- edit di sini
├── firebase/
│   ├── firebase.js         koneksi Firestore (dikunci read-only) + paging
│   └── serviceAccountKey.json   (kamu yang taruh, tidak di-commit)
├── database/
│   └── mysql.js            pool MariaDB, bulk insert, retry per baris
├── lib/
│   ├── runner.js           mesin batching, checkpoint, laporan
│   ├── transform.js        konversi tanggal/jam/nama/angka
│   ├── user-resolver.js    rekonstruksi user_id untuk tech_logs
│   ├── master-resolver.js  isi tabel master, dibaca dari MariaDB
│   ├── nik-allocator.js    NIK unik + penanda NOREG- untuk yang kosong
│   ├── blockers.js         temuan yang harus diputuskan manusia
│   ├── schema-check.js     preflight kecocokan mapping vs tabel asli
│   ├── report.js           laporan skip/warning/gagal
│   ├── state.js            checkpoint untuk --resume
│   └── logger.js
├── migrators/
│   ├── users.js
│   ├── bug_reports.js
│   ├── audit_logs.js
│   └── tech_logs.js
├── tools/
│   ├── inspect-schema.js       struktur tabel MariaDB
│   ├── inspect-firestore.js    isi & field Firestore
│   └── check-duplicate-nik.js  bandingkan pemakaian dua akun ber-NIK sama
├── tests/
│   ├── run.js                  runner sederhana, tanpa dependency  (npm test)
│   ├── firestore-readonly.test.js
│   └── column-lengths.test.js  batas panjang kolom & NO_TRUNCATE
└── reports/                    hasil migrasi (JSON + CSV), dibuat otomatis
```

---

## 9. Kuncian read-only Firestore

Instance Firestore yang dipakai tool ini dibungkus `Proxy` di
`firebase/firebase.js`. Yang ditolak:

| Yang dicoba | Hasil |
|---|---|
| `set` `update` `delete` `create` `add` | error, tidak pernah sampai ke Firestore |
| `batch` `bulkWriter` `runTransaction` `recursiveDelete` `deleteAll` | error |
| `obj.properti = ...` lewat objek Firestore | error |
| `delete obj.properti` / `Object.defineProperty(obj, ...)` | error |

Kuncian ini menurun ke objek turunannya: hasil `.collection()`, `.orderBy()`,
`QuerySnapshot`, sampai isi `snap.docs` — jadi `snap.docs[0].ref.delete()` juga
ditolak.

### Kalau muncul "[FIRESTORE READ-ONLY] ..." saat `npm run dry`

Pesannya menyebut nama properti atau method yang ditolak. Cek dulu properti yang
disebut:

* nama method tulis (`set()`, `delete()`, ...) → memang ada kode migrasi yang
  salah. Perbaiki migratornya, **jangan** longgarkan kuncian.
* nama properti internal pustaka (diawali `_`, misalnya `_materializedDocs`) →
  bukan kode kita. Itu cache internal `firebase-admin` yang salah alamat.

Kasus kedua pernah terjadi dan sudah diperbaiki: getter `QuerySnapshot#docs`
menyimpan hasilnya sendiri (`this._materializedDocs = ...`), dan dulu proxy
meneruskan dirinya sebagai `receiver` sehingga `this` di dalam getter itu = proxy.
Sekarang getter pustaka dijalankan dengan `this` = objek aslinya, jadi cache
internalnya mendarat di tempat yang benar. Daftar method tulis yang diblokir
tidak berubah sedikit pun.

`npm test` menjaga keduanya sekaligus: bahwa pembacaan wajar tidak lagi tertahan,
dan bahwa semua operasi tulis tetap ditolak. Tesnya memakai kelas `QuerySnapshot`
asli dari `@google-cloud/firestore`, jadi kalau pustakanya diperbarui dan pola
memoisasinya berubah lagi, `npm test` yang lebih dulu berbunyi — bukan
`npm run dry` yang sudah memakai kuota.
