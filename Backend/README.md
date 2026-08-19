# Log Activity — Backend API

REST API untuk aplikasi Log Activity PT Elnusa (Warehouse BSD). Menggantikan
akses langsung frontend React ke Firebase Firestore, dengan sumber data
MariaDB di Hostinger.

- **Framework:** Slim 4
- **PHP:** 8.1 atau lebih baru
- **Database:** MariaDB / MySQL (Database LOCK V1.0)
- **Login:** Google SSO lewat Firebase Authentication

---

## Daftar isi

1. [Kebutuhan](#1-kebutuhan)
2. [Pemasangan untuk development](#2-pemasangan-untuk-development)
3. [Urutan skrip SQL](#3-urutan-skrip-sql)
4. [Menjalankan di komputer sendiri](#4-menjalankan-di-komputer-sendiri)
5. [Bentuk response](#5-bentuk-response)
6. [Autentikasi](#6-autentikasi)
7. [Daftar endpoint](#7-daftar-endpoint)
8. [Deployment ke Hostinger](#8-deployment-ke-hostinger)
9. [Struktur folder](#9-struktur-folder)
10. [Keputusan yang perlu diketahui](#10-keputusan-yang-perlu-diketahui)
11. [Kalau ada masalah](#11-kalau-ada-masalah)
12. [Pembatasan pendaftaran](#12-pembatasan-pendaftaran)
13. [Super admin dan serah terima](#13-super-admin-dan-serah-terima)
14. [Yang masih perlu dikerjakan di frontend](#14-yang-masih-perlu-dikerjakan-di-frontend)

---

## 1. Kebutuhan

| Kebutuhan | Keterangan |
|---|---|
| PHP >= 8.1 | dengan ekstensi `pdo_mysql`, `json`, `openssl`, `mbstring` |
| Composer | hanya untuk memasang dependensi, tidak perlu ada di server |
| MariaDB / MySQL | skema V1.0 sudah dijalankan |
| Apache + `mod_rewrite` | Hostinger Cloud Hosting sudah menyediakannya |

Ekstensi `curl` sangat disarankan. Kalau tidak ada, pengunduhan kunci Google
otomatis memakai `file_get_contents` sebagai cadangan.

---

## 2. Pemasangan untuk development

```bash
cd Backend
composer install
cp .env.example .env
```

Lalu buka `.env` dan isi minimal bagian ini:

```dotenv
DB_HOST=localhost
DB_NAME=nama_database_anda
DB_USER=user_database_anda
DB_PASSWORD=password_database_anda

FIREBASE_PROJECT_ID=gen-lang-client-0722752672
```

`FIREBASE_PROJECT_ID` harus sama persis dengan `projectId` di
`Frontend/firebase-applet-config.json`. Kalau berbeda, **semua** token akan
ditolak dengan pesan "Token ini bukan untuk aplikasi ini".

Pastikan folder `storage/` bisa ditulis:

```bash
chmod -R 775 storage
```

Isinya tiga hal: catatan error (`storage/logs/`), cache public key Google
(`storage/cache/`), dan sakelar maintenance (`storage/settings.json`).
Ketiganya dibuat otomatis saat pertama kali dipakai.

---

## 3. Urutan skrip SQL

Jalankan berurutan. Nomor 1 dan 2 sudah pernah dijalankan di Hostinger, jadi
biasanya cukup nomor 3 sampai 5.

| Berkas | Isi | Wajib? |
|---|---|---|
| `01_schema.sql` | struktur 8 tabel | sudah dijalankan |
| `02_seed.sql` | isi tabel master | sudah dijalankan |
| `03_align_master_data.sql` | menyamakan nama master data dengan frontend | **ya** |
| `04_legacy_user.sql` | user penampung untuk log lama | **ya, sebelum migrasi** |
| `05_widen_sn.sql` | `tech_logs.sn` dari `VARCHAR(100)` jadi `TEXT` | **ya, sebelum migrasi** |

```bash
mysql -u USER -p NAMA_DATABASE < 03_align_master_data.sql
mysql -u USER -p NAMA_DATABASE < 04_legacy_user.sql
mysql -u USER -p NAMA_DATABASE < 05_widen_sn.sql
```

Ketiganya aman dijalankan berulang kali. Khusus nomor 5, kalau kolomnya sudah
`TEXT` skripnya tidak menjalankan `ALTER` sama sekali, jadi tabel `tech_logs`
tidak ikut di-*rebuild*.

**Kenapa nomor 5 perlu.** Satu aktivitas bisa memuat banyak serial number
sekaligus, dipisah baris baru — ada 7 log lama di Firestore dengan `sn` sampai
1199 karakter. Selama kolomnya masih `VARCHAR(100)`, migrasi berhenti di
ketujuh log itu dan input baru yang panjang ditolak 422. Rinciannya ada di
dalam berkasnya.

**Kenapa nomor 3 perlu.** Nama di `02_seed.sql` berbeda dengan yang selama ini
ditampilkan frontend. Tiga di antaranya berbeda arti, bukan sekadar penulisan:

| Kode | `02_seed.sql` | Frontend | Dipakai |
|---|---|---|---|
| PR | Procurement | **Permit** | Permit |
| AC | Accessories | **Access** | Access |
| OT | Overtime | **Other** | Other |

Skrip nomor 3 juga menambahkan 4 supervisor yang dipakai
`BatchUpdateModal.tsx` tapi belum ada di master: Muhammad Agus M,
Puji Slamet Susilo, Sujaryoto, dan Supono.

**Kenapa nomor 4 perlu.** Kolom `tech_logs.user_id` bertipe `NOT NULL` dengan
foreign key ke `users`, sementara Firestore tidak pernah menyimpan `userId` di
`tech_logs` — hanya `nik` dan `nama_technician`. Log lama yang tidak bisa
dicocokkan diarahkan ke user penampung `legacy-unknown` supaya tidak hilang.
Kolom snapshot (`display_name`, `nik_snapshot`, `supervisor`) tetap menyimpan
data aslinya, jadi tampilan histori tidak berubah.

Setelah migrasi, cek berapa yang mendarat di penampung:

```sql
SELECT COUNT(*) FROM tech_logs WHERE user_id = 'legacy-unknown';
```

---

## 4. Menjalankan di komputer sendiri

```bash
composer serve
```

atau

```bash
php -S localhost:8080 -t public public/index.php
```

> Bagian `public/index.php` di akhir perintah **wajib ada**. Tanpa itu, server
> bawaan PHP mencari file sungguhan untuk setiap URL dan semua endpoint jadi
> 404.

Uji cepat:

```bash
curl http://localhost:8080/api/health
# {"success":true,"data":{"status":"ok","time":"..."},"message":null}
```

Endpoint `/api/health` tidak menyentuh database, jadi tetap menjawab walaupun
database sedang bermasalah. Itu memang gunanya: memisahkan "backend mati" dari
"database mati".

Selama development, frontend Vite jalan di port lain, jadi CORS perlu menyala:

```dotenv
CORS_ENABLED=true
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

---

## 5. Bentuk response

Semua response memakai bentuk yang sama, termasuk error.

Berhasil:

```json
{ "success": true, "data": { }, "message": null }
```

Endpoint daftar menambahkan `meta`. Isi `data` tetap array, jadi frontend bisa
langsung memakainya:

```json
{
  "success": true,
  "data": [ { "id": "uid-budi", "name": "Budi Santoso" } ],
  "message": null,
  "meta": { "total": 42, "limit": 100, "offset": 0, "has_more": false }
}
```

`has_more` bernilai `true` kalau masih ada baris di belakang halaman ini.
Perhatikan ini untuk `/api/tech-logs`: Dashboard menghitung statistik dari
seluruh baris yang diterimanya, jadi kalau backend memotong di baris ke-500
tanpa frontend mengambil halaman berikutnya, angkanya salah tanpa ada yang
sadar. Pola ambil-sampai-habis:

```ts
const semua = [];
let offset = 0;

for (;;) {
  const r = await get(`/api/tech-logs?limit=500&offset=${offset}`);
  semua.push(...r.data);
  if (!r.meta.has_more) break;
  offset += r.meta.limit;
}
```

Gagal:

```json
{ "success": false, "data": null, "message": "Penjelasan dalam Bahasa Indonesia" }
```

Gagal validasi menambahkan `errors` per field:

```json
{
  "success": false,
  "data": null,
  "message": "Nama technician maksimal 150 karakter, saat ini 214 karakter.",
  "errors": { "nama_technician": "Nama technician maksimal 150 karakter, saat ini 214 karakter." }
}
```

Kode status yang dipakai:

| Kode | Arti |
|---|---|
| 200 | berhasil |
| 201 | data baru tersimpan |
| 401 | token tidak ada, kedaluwarsa, atau tidak sah |
| 403 | token sah tapi belum terdaftar, rolenya tidak berhak, atau barisnya bukan miliknya |
| 404 | data atau endpoint tidak ditemukan |
| 405 | metode HTTP salah |
| 409 | bentrok dengan keadaan akun: email sudah terdaftar, atau akunnya sudah punya profil |
| 422 | input tidak lolos validasi — termasuk **NIK yang sudah dipakai user lain** |
| 500 | kesalahan server |

**NIK kembar dijawab 422, bukan 409.** NIK adalah field yang diketik user di
form, jadi penolakannya diperlakukan sama seperti kegagalan validasi lain:
`errors.nik` selalu ikut, sehingga frontend bisa menempelkan pesannya di bawah
input tanpa cabang kode khusus. Email tetap 409 karena tidak diketik user —
nilainya datang dari Akun Google.

Detail teknis tidak pernah ikut ke response saat `APP_DEBUG=false`. Pesan
asli, jalur file, dan stack trace ditulis ke `storage/logs/error-YYYY-MM-DD.log`.

### Nama field mengikuti frontend, bukan database

Backend menerjemahkan nama kolom supaya `Frontend/src/types.ts` tidak perlu
diubah:

| Kolom database | Field JSON |
|---|---|
| `users.name` | `name` |
| `master_divisions.name` | `divisi` |
| `tech_logs.display_name` | `nama_technician` |
| `tech_logs.nik_snapshot` | `nik` |
| `audit_logs.created_at` | `timestamp` |
| `tech_bug_reports.image_base64` | `imageBase64` |
| `*.user_id` | `userId` |

Semua penerjemahan ada di satu berkas: `src/Helpers/Transformer.php`.

---

## 6. Autentikasi

Frontend tetap login lewat `signInWithPopup` Firebase seperti sekarang. Yang
berubah: setiap request ke backend harus membawa ID token hasil login.

```ts
const token = await auth.currentUser.getIdToken();

const res = await fetch(`${API_URL}/api/users`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

Backend **tidak** mempercayai isi token begitu saja. Yang diperiksa:

1. Tanda tangan RS256 cocok dengan public key milik Google
2. `iss` sama dengan `https://securetoken.google.com/<FIREBASE_PROJECT_ID>`
3. `aud` sama dengan `FIREBASE_PROJECT_ID` — token dari project lain ditolak
4. `sub` tidak kosong; nilai inilah yang dipakai sebagai `users.id`
5. `exp`, `iat`, dan `auth_time` masih masuk akal (toleransi selisih jam 60 detik)

Public key Google diunduh otomatis dan disimpan di
`storage/cache/firebase-keys.json`, diperbarui sendiri saat kedaluwarsa atau
saat Google merotasi kunci.

Karena `users.id` diisi UID Firebase, akun lama tetap terhubung ke datanya
setelah migrasi.

### Tingkatan hak akses

| Lapisan | Yang diperiksa |
|---|---|
| `AuthMiddleware` | token sah; menempelkan `uid` dan baris `users` ke request |
| `RoleMiddleware([])` | sudah punya baris di tabel `users` |
| `RoleMiddleware(['admin'])` | rolenya `admin` |
| `SuperAdminMiddleware` | emailnya termasuk super admin — lihat [bagian 13](#13-super-admin-dan-serah-terima) |

Token sah tapi belum punya baris di `users` mendapat **403**, bukan 401. Itu
sinyal bagi frontend untuk menampilkan form "Lengkapi Profil" seperti alur di
`Login.tsx` sekarang.

Empat route dikecualikan dan hanya dijaga `AuthMiddleware`: `POST /api/auth/sync`,
`POST /api/auth/register`, `GET /api/auth/status`, dan `GET /api/master/divisions`.
User yang baru pertama kali login memang belum punya baris di `users`, jadi kalau
`RoleMiddleware` ikut dipasang dia akan ditolak 403 dan tidak akan pernah bisa
mendaftar — termasuk saat form "Lengkapi Profil" mengambil pilihan divisinya.

**Pendaftar yang menunggu persetujuan juga belum punya baris `users`.** Itu
disengaja, dan itulah yang menahannya: `RoleMiddleware` menolaknya di setiap
endpoint tanpa aturan tambahan, dan endpoint yang ditambahkan besok ikut
terlindungi dengan sendirinya. Satu-satunya yang bisa dia buka adalah
`GET /api/auth/status`, yang hanya mengembalikan permintaannya sendiri.
Selengkapnya di [bagian 12](#12-pembatasan-pendaftaran).

`SuperAdminMiddleware` sengaja dipasang sendirian, tidak ditumpuk di atas
`RoleMiddleware(['admin'])`. Kalau ditumpuk, super admin yang `users.role`-nya
sempat diubah orang lain ikut tertolak — padahal justru dialah yang harus bisa
membetulkannya.

### Alur login yang menggantikan Login.tsx

```ts
const hasil = await signInWithPopup(auth, googleProvider);
const token = await hasil.user.getIdToken();

const r = await post('/api/auth/sync', {}, token);

switch (r.data.status) {
  case 'active':
    onLogin(r.data.user);                 // langsung masuk
    break;

  case 'unregistered':
    tampilkanFormProfil(r.data.prefill);  // { id, email, name } dari token
    // lalu: post('/api/auth/register', { name, nik, divisi }, token)
    break;

  case 'pending':
    tampilkanLayarMenunggu(r.data.registration);
    break;

  case 'rejected':
    tampilkanPenolakan(r.data.registration.reason);
    break;
}
```

Field `registered` yang lama tetap dikirim dan artinya tidak berubah, jadi
frontend yang belum diperbarui tetap jalan — `pending` dan `rejected` sama-sama
terbaca sebagai `registered: false`. Yang terjadi tanpa pembaruan frontend:
pendaftar yang sudah mengantre akan terus melihat form "Lengkapi Profil" dan
menerima **409** kalau menekan simpan lagi. Tidak berbahaya, tapi
membingungkan — lihat [bagian 14](#14-yang-masih-perlu-dikerjakan-di-frontend).

Yang dipercaya dari body hanya `name`, `nik`, dan `divisi`. `id`, `email`, dan
`role` diambil dari token — kalau ketiganya ikut dikirim, backend mengabaikannya.
Promosi super admin juga terjadi di server, bukan seperti sekarang yang ditulis
frontend ke Firestore.

`POST /api/auth/register` sekarang punya dua jawaban berhasil:

| Kode | Artinya |
|---|---|
| **201** | profil langsung aktif — super admin, atau Lapis 2 sedang dimatikan |
| **202** | permintaan masuk antrean, menunggu disetujui admin |

`GET /api/auth/status` mengembalikan isi yang sama persis dengan
`POST /api/auth/sync`, tapi tanpa efek samping dan tanpa body. Dipakai layar
"menunggu persetujuan" untuk memeriksa ulang tanpa harus login ulang.

---

## 7. Daftar endpoint

Sudah jadi:

| Metode | Endpoint | Akses | Keterangan |
|---|---|---|---|
| GET | `/api/health` | terbuka | memastikan backend hidup |
| POST | `/api/auth/sync` | token sah | cek profil setelah login Google |
| POST | `/api/auth/register` | token sah | daftar — 201 aktif, atau 202 masuk antrean |
| GET | `/api/auth/status` | token sah | status sendiri, termasuk saat menunggu |
| GET | `/api/auth/me` | terdaftar | profil sendiri |
| GET | `/api/registrations` | **admin** | antrean, `?status=pending\|rejected` |
| POST | `/api/registrations/{uid}/approve` | **admin** | setujui, body opsional `{ role }` |
| POST | `/api/registrations/{uid}/reject` | **admin** | tolak, body opsional `{ reason }` |
| DELETE | `/api/registrations/{uid}` | **admin** | hapus catatan tolakan, boleh daftar lagi |
| GET | `/api/allowed-niks` | **admin** | daftar izin NIK |
| POST | `/api/allowed-niks` | **admin** | izinkan NIK, body `{ nik, note? }` |
| DELETE | `/api/allowed-niks/{nik}` | **admin** | cabut izin |
| GET | `/api/super-admins` | **super admin** | siapa saja super admin |
| POST | `/api/super-admins` | **super admin** | angkat, body `{ email }` |
| DELETE | `/api/super-admins/{email}` | **super admin** | turunkan |
| GET | `/api/users` | terdaftar | daftar user |
| GET | `/api/tech-logs` | terdaftar | daftar aktivitas |
| POST | `/api/tech-logs` | terdaftar | simpan aktivitas |
| GET | `/api/tech-logs/{id}` | terdaftar | detail aktivitas |
| PUT | `/api/tech-logs/{id}` | terdaftar | ubah aktivitas |
| DELETE | `/api/tech-logs/{id}` | terdaftar | hapus aktivitas |
| GET | `/api/users/{id}` | terdaftar | detail user |
| PUT | `/api/users/{id}` | **admin** | ubah profil |
| DELETE | `/api/users/{id}` | **admin** | hapus user, `?mode=purge\|detach` wajib |
| GET | `/api/bug-reports` | terdaftar | daftar laporan, tanpa gambar |
| POST | `/api/bug-reports` | terdaftar | kirim laporan |
| GET | `/api/bug-reports/{id}` | terdaftar | detail, dengan gambar |
| PATCH | `/api/bug-reports/{id}` | **admin** | ubah status |
| GET | `/api/audit-logs` | **admin** | daftar catatan aksi |
| POST | `/api/audit-logs` | terdaftar | catat aksi |
| GET | `/api/master/divisions` | token sah | daftar divisi — dipakai form pendaftaran |
| GET | `/api/master/supervisors` | terdaftar | daftar supervisor |
| GET | `/api/master/categories` | terdaftar | daftar kategori |
| GET | `/api/master/delay-codes` | terdaftar | daftar kode delay |
| GET | `/api/settings/maintenance` | **terbuka** | status maintenance |
| PUT | `/api/settings/maintenance` | **admin** | nyalakan/matikan |

`GET /api/users` menerima query string:

| Parameter | Contoh | Keterangan |
|---|---|---|
| `search` | `?search=Budi` | cari di nama, email, atau NIK |
| `role` | `?role=admin` | `admin`, `atasan`, atau `karyawan` |
| `division` | `?division=Mekanik` | nama divisi |
| `limit` | `?limit=50` | default 100, maksimum 500 |
| `offset` | `?offset=100` | lompati sekian baris |

Daftar user bisa dibaca semua user terdaftar, bukan admin saja. Ini mengikuti
perilaku yang sudah berjalan: `App.tsx` memanggil `fetchUsersFirestore()` untuk
setiap user yang login lalu meneruskan hasilnya ke Dashboard, ActivityList, dan
komponen lain. Yang dibatasi khusus admin adalah ubah dan hapus.

### `/api/tech-logs`

Query string untuk `GET /api/tech-logs`:

| Parameter | Contoh | Keterangan |
|---|---|---|
| `start_date` | `?start_date=2026-08-01` | batas bawah kolom `tanggal` |
| `end_date` | `?end_date=2026-08-31` | batas atas kolom `tanggal` |
| `nik` | `?nik=TS-0001` | NIK yang tersimpan pada log |
| `user_id` | `?user_id=uid-budi` | pemilik baris |
| `status` | `?status=Done` | `Done`, `Ongoing`, `Hold`, `-` |
| `kategori_code` | `?kategori_code=P1` | kode kategori |
| `shift` | `?shift=Pagi` | `Pagi`, `Siang`, `Malam` |
| `supervisor` | `?supervisor=Kustono` | nama persis |
| `search` | `?search=bearing` | deskripsi, nama, WO, asset tag, SN, party |
| `limit`, `offset` | `?limit=500&offset=0` | lihat `meta.has_more` |

Tanggal atau status yang formatnya salah dijawab **422**, bukan diam-diam
diabaikan — supaya salah ketik parameter tidak terbaca sebagai "tidak ada data".

Body untuk `POST` dan `PUT` sama persis dengan `LogActivity` di `types.ts`,
dikurangi dua field yang selalu dibuat server dan diabaikan kalau dikirim:

- `id` — dibuat sebagai UUID; kolomnya `CHAR(36)`, sedangkan
  `Math.random().toString(36).substring(2, 9)` di `storage.ts` cuma 7 karakter
  dan bisa bentrok
- `duration_minutes` — dihitung ulang dari `start_time` dan `finish_time`,
  rumusnya disalin dari `saveLog()` termasuk penanganan shift malam yang
  melewati tengah malam

`kategori_code` dan `delay_code` dicocokkan dengan tabel master. Keduanya tidak
punya foreign key di schema V1.0, jadi tanpa pemeriksaan ini salah ketik satu
huruf akan tersimpan dan barisnya hilang dari semua laporan per kategori.

### Hak akses tech-logs

Aturannya menyalin `ActivityList.tsx`, tapi sekarang ditegakkan di server juga —
yang di browser hanya menyembunyikan tombol, dan itu tidak menghalangi siapa pun
memanggil endpoint langsung lewat curl.

| | karyawan | atasan & admin |
|---|---|---|
| melihat daftar | hanya miliknya | semua |
| menyimpan | hanya tanggal hari ini | tanggal bebas |
| mengubah & menghapus | miliknya, dan hanya yang bertanggal hari ini | semua, kapan saja |

"Miliknya" dicoba lewat tiga jalur berurutan: `user_id`, lalu `nik_snapshot`,
lalu nama. Data hasil migrasi tidak seragam — sebagian baris `user_id`-nya sudah
benar, sebagian jatuh ke user penampung `legacy-unknown` dan hanya bisa dikenali
lewat NIK, dan baris paling lama bahkan tidak menyimpan NIK sehingga tinggal
nama. Sama persis dengan cara `ActivityList.tsx:130` menyaring di browser.

### `/api/users/{id}`

`PUT` menerima **sebagian** field saja: `{ name?, nik?, divisi?, role? }`. Yang
tidak dikirim tidak disentuh. Bentuk ini mengikuti AdminPanel, yang memakai dua
tombol berbeda — satu menyimpan nama/NIK/divisi, satu lagi hanya mengganti role
— persis seperti `setDoc(..., { merge: true })`.

`id` dan `email` tidak bisa diubah. Keduanya berasal dari Akun Google dan jadi
penghubung ke seluruh data lama.

### NIK kembar

`users.nik` bertipe `NOT NULL UNIQUE`, jadi database memang sudah menolak NIK
kembar sendiri — tapi penolakannya berbentuk `SQLSTATE 23000` yang, kalau
dibiarkan, sampai ke user sebagai **500 "kesalahan server"**. Itu tidak memberi
tahu apa yang salah maupun apa yang harus diperbaiki.

Karena itu ada dua lapis, keduanya di `src/Helpers/NikGuard.php`:

1. **Diperiksa dulu sebelum menulis**, lalu dibalas **422** dengan pesan yang
   menyebut NIK-nya. Ini jalur yang hampir selalu terpakai.
2. **Pelanggaran `UNIQUE` tetap ditangkap** sebagai jaring pengaman. Dua
   permintaan yang datang hampir bersamaan bisa sama-sama lolos lapis pertama
   sebelum salah satunya sempat menulis; yang kalah tetap dapat 422 yang sama,
   bukan 500.

Berlaku di dua endpoint yang menulis kolom itu:

| Endpoint | Pemilik NIK disebut? | Contoh `message` |
|---|---|---|
| `POST /api/auth/register` | **tidak** | `NIK 52102001 sudah digunakan oleh user lain. Hubungi admin bila ini benar NIK Anda.` |
| `PUT /api/users/{id}` (admin) | ya | `NIK 52102001 sudah digunakan oleh Budi Santoso.` |

`errors.nik` **selalu** bernilai sama (`NIK sudah digunakan user lain.`) dan
tidak pernah memuat nama siapa pun, jadi frontend bisa menampilkannya di bawah
input tanpa peduli siapa yang memanggil.

Nama pemilik hanya disebut untuk admin, dan hanya di `message`. Alasannya: form
pendaftaran terbuka untuk siapa pun yang punya Akun Google, jadi kalau namanya
ikut dibalas, endpoint itu berubah jadi cara memetakan NIK ke nama karyawan satu
per satu.

**Saat admin mengubah NIK, NIK milik user itu sendiri tidak dihitung bentrok.**
Pengecualiannya ada di `UserModel::findByNik($nik, $exceptId)` — sengaja di
model, bukan di controller, supaya tidak ada pemanggil yang lupa memasangnya.
Tanpa itu, menyimpan form tanpa mengubah NIK pun akan ditolak.

Dua hal yang perlu diketahui tentang pencocokannya:

- Pemeriksaan memakai `=` dengan collation kolomnya (`utf8mb4_unicode_ci`), jadi
  hasilnya **persis sama** dengan yang diterima atau ditolak indeks `UNIQUE`.
  Huruf besar/kecil dan spasi di ujung diperlakukan sama oleh keduanya. Kalau
  keduanya tidak sepakat, lapis pertama akan meloloskan nilai yang kemudian
  ditolak database.
- Spasi **di tengah** tetap membedakan: `521 02001` dan `52102001` dianggap dua
  NIK berbeda. Migration tool lebih ketat (`nikKey()` di
  `Migration/lib/transform.js` membuang semua spasi), jadi keduanya bisa
  berbeda pendapat. Belum jadi masalah nyata; kalau mau diseragamkan, tempatnya
  satu normalisasi sebelum validasi.

`tech_logs.nik_snapshot` **tidak** ikut aturan ini. Kolom itu snapshot histori,
tidak `UNIQUE`, dan memang boleh berulang — satu teknisi punya banyak log.

### Menghapus user: `?mode=purge` atau `?mode=detach`

Ketiga tabel anak memakai `ON DELETE RESTRICT`, jadi user tidak bisa dihapus
selama masih punya satu baris pun. Admin memilih apa yang terjadi pada baris itu:

| mode | `tech_logs`, `audit_logs`, `tech_bug_reports` | bisa dibatalkan |
|---|---|---|
| `purge` | ikut dihapus | tidak |
| `detach` | dialihkan ke `legacy-unknown`, tetap tersimpan | ya, tinggal daftar ulang |

```
DELETE /api/users/uid-andi?mode=detach
```

Mode juga boleh dikirim lewat body (`{"mode":"detach"}`), tapi query string
didahulukan — sebagian proxy dan konfigurasi PHP di shared hosting membuang body
pada permintaan `DELETE`.

**Tidak ada nilai default.** Permintaan tanpa `mode`, atau dengan nilai selain
kedua itu, dijawab **422**. Menghapus data orang tidak boleh terjadi hanya karena
satu parameter lupa dikirim.

Response menyebut kunci yang berbeda untuk tiap mode supaya tidak salah dibaca —
`deleted` versus `detached`:

```json
{ "success": true,
  "data": { "id": "uid-andi", "mode": "purge",
            "deleted": { "tech_logs": 12, "audit_logs": 4, "bug_reports": 1 } },
  "message": "User Andi Setiawan dihapus beserta 12 aktivitas, 4 catatan audit, dan 1 laporan bug. Data itu tidak bisa dikembalikan." }
```

```json
{ "success": true,
  "data": { "id": "uid-andi", "mode": "detach",
            "detached": { "tech_logs": 12, "audit_logs": 4, "bug_reports": 1 } },
  "message": "Profil Andi Setiawan dihapus. 12 aktivitas, 4 catatan audit, dan 1 laporan bug miliknya dialihkan ke akun penampung dan tetap tersimpan -- nama teknisi pada histori tidak berubah." }
```

Pada `detach`, kolom snapshot (`display_name`, `nik_snapshot`, `supervisor`)
tidak disentuh sama sekali — justru itu yang membuat histori tetap terbaca atas
nama teknisi aslinya. `updated_at` pada `tech_logs` juga dipertahankan; tanpa itu
`ON UPDATE CURRENT_TIMESTAMP` akan menandai seluruh log lama seolah baru saja
diedit hari ini.

Ada satu perbedaan cakupan yang disengaja. `purge` menghapus `tech_logs` lewat
`user_id` **maupun** NIK, menyalin `deleteUserAndLogs()` yang memang menghapus
berdasarkan NIK. `detach` hanya memindahkan baris yang benar-benar terikat
foreign key ke user itu — memindahkan baris milik user lain hanya karena NIK-nya
sama justru merusak data yang sedang dijaga.

Kalau akun penampung belum ada di database, `detach` dijawab **409** dengan
perintah menjalankan `04_legacy_user.sql`, bukan 500 dari foreign key.

Empat hal ditolak untuk **kedua** mode: menghapus akun sendiri, menghapus super
admin, menghapus akun penampung `legacy-unknown`, dan mengubah super admin oleh
admin lain.

### `/api/bug-reports`

Di sini **hanya admin** yang melihat laporan orang lain — atasan tidak, berbeda
dengan tech-logs. Itu menyalin `BugReportModal.tsx:26`, yang mengambil seluruh
laporan hanya ketika rolenya admin.

`imageBase64` hanya ikut di endpoint detail dan saat baru dibuat. Endpoint
daftar sengaja tidak membawanya: isinya data URL hasil kompresi di browser,
ratusan KB per baris, dan satu halaman berisi puluhan laporan bisa jadi
belasan MB.

Sebagai gantinya setiap baris membawa **`has_image`** (boolean). Tabel bug
report di AdminPanel menandai laporan berlampiran dengan ikon klip; tanpa
penanda ini satu-satunya cara mengetahuinya adalah mengirim gambarnya juga.
Dihitung di SQL sebagai `image_base64 IS NOT NULL AND image_base64 <> ''` —
dibandingkan dengan string kosong juga, karena laporan tanpa gambar dari versi
Firestore bisa tersimpan sebagai `''`, bukan `NULL`.

Body `POST`: `{ title, description, imageBase64? }`. Field `userId`, `userName`,
dan `role` yang dikirim `BugReportModal` diabaikan — ketiganya diambil dari token
dan tabel `users`. `status` selalu mulai dari `Open`.

`PATCH` khusus admin dan hanya mengubah `status`.

### `/api/audit-logs`

Dibaca admin, **ditulis siapa saja** yang sudah terdaftar. Itu memang perlu:
yang dicatat justru aksi user biasa — login, logout, menambah dan menghapus log
aktivitas. Pelakunya selalu pemilik token, tidak pernah `userId` dari body.

Body `POST`: `{ action, description? }`. `action` masuk ke `VARCHAR(100)`, jadi
keterangan panjang sebaiknya ditaruh di `description` yang bertipe `TEXT`.

Query string `GET`: `user_id`, `start_date`, `end_date`, `search`, `limit`,
`offset`. AdminPanel memakai `?limit=50`.

### `/api/master/*`

Empat daftar yang sekarang masih ditulis tetap di frontend: `KATEGORI_CODES` dan
`DELAY_CODES` di `types.ts`, `OFFICIAL_SUPERVISORS` di `BatchUpdateModal.tsx`,
dan daftar divisi sebagai `<option>` di `Login.tsx`. Karena disalin di beberapa
tempat, isinya sempat berbeda-beda — itulah yang membuat
`03_align_master_data.sql` perlu ada.

Bentuknya array of object. Untuk menggantikan `Record<string, string>` yang
dipakai sekarang:

```ts
const KATEGORI_CODES = Object.fromEntries(data.map(k => [k.code, k.name]));
```

Hanya baris `is_active = TRUE` yang dikirim.

#### `divisions` tidak butuh baris di tabel `users`

Ketiga endpoint master lainnya dijaga `RoleMiddleware([])`, tapi `divisions`
**tidak** — cukup token yang sah. Yang membutuhkan daftar divisi justru user
yang belum terdaftar: form "Lengkapi Profil" harus menawarkan pilihan divisi
sebelum barisnya di `users` ada. Dengan penjaga itu terpasang, satu-satunya cara
mengisi form pendaftaran adalah menyalin daftarnya ke frontend sebagai `<option>`
tetap — persis kebiasaan yang endpoint master ini dimaksudkan untuk menghapus.

Yang dikirim hanya `id` dan `name`, tidak pernah seluruh kolom. Pembatasannya
ada di dua tempat sekaligus, jadi kolom baru di `master_divisions` tidak akan
ikut bocor hanya karena seseorang lupa:

```sql
SELECT id, name FROM master_divisions WHERE is_active = 1 ORDER BY name ASC
```

lalu `MasterController::divisions()` menyusun ulang tiap baris menjadi
`['id' => (int), 'name' => (string)]`. Kolom `is_active`, `created_at`, dan
`updated_at` tidak pernah meninggalkan server.

```json
{ "success": true,
  "data": [ { "id": 6, "name": "-" }, { "id": 2, "name": "Instrument" } ],
  "message": null }
```

### `/api/settings/maintenance`

`GET`-nya **tanpa autentikasi**, satu-satunya selain `/api/health`. `App.tsx`
memasang pembacanya di `useEffect` dengan dependency kosong — berjalan saat
aplikasi dimuat, sebelum ada yang login — dan layar "Under Maintenance" memang
harus tampil di halaman login juga. Yang bocor hanya satu boolean, sama seperti
aturan Firestore yang dipakai sekarang.

Nilainya disimpan di `storage/settings.json`, bukan tabel: schema V1.0 dikunci
dan tidak punya tabel `settings`. Body `PUT`: `{ "active": true }`.

---

## 8. Deployment ke Hostinger

### Susunan folder di server

```
public_html/
├── index.html          <- hasil build React
├── assets/             <- hasil build React
└── api/
    ├── index.php       <- dari Backend/public/index.php
    ├── .htaccess       <- dari Backend/public/.htaccess
    └── app/
        ├── src/
        ├── routes/
        ├── vendor/
        ├── storage/
        └── .env
```

`index.php` mengenali sendiri dua susunan folder: kalau ada subfolder bernama
`app`, isi aplikasi dicari di situ; kalau tidak, dicari satu tingkat di atas
seperti susunan repo. **Tidak ada baris kode yang perlu diubah saat deploy.**

Susunan ini dipakai karena Hostinger Cloud Hosting tidak mengizinkan file di
luar `public_html`. Folder `app/` tetap harus dilindungi, lihat langkah 4.

### Langkah

**1. Siapkan `vendor/` di komputer sendiri.**

Shared hosting sering tidak menyediakan Composer lewat SSH, jadi `vendor/`
dibangun lokal lalu diunggah:

```bash
cd Backend
composer install --no-dev --optimize-autoloader
```

`composer.json` sudah mengunci target `platform.php` ke `8.1.0`, jadi hasilnya
tetap cocok walaupun PHP di komputer Anda lebih baru daripada di server.

**2. Unggah berkas.**

| Dari | Ke |
|---|---|
| `Backend/public/index.php` | `public_html/api/index.php` |
| `Backend/public/.htaccess` | `public_html/api/.htaccess` |
| `Backend/src/` | `public_html/api/app/src/` |
| `Backend/routes/` | `public_html/api/app/routes/` |
| `Backend/vendor/` | `public_html/api/app/vendor/` |
| `Backend/storage/` | `public_html/api/app/storage/` |

Lewat File Manager, unggah `vendor/` dan `src/` sebagai satu berkas ZIP lalu
ekstrak di server. Mengunggah ribuan file satu per satu akan sangat lama.

**3. Buat `.env` di server.**

Salin isi `.env.example` ke `public_html/api/app/.env`, lalu ubah:

```dotenv
APP_ENV=production
APP_DEBUG=false
CORS_ENABLED=false

DB_HOST=localhost
DB_NAME=u123456789_logactivity
DB_USER=u123456789_admin
DB_PASSWORD=...
```

`APP_DEBUG=false` wajib di production. `CORS_ENABLED=false` karena frontend dan
backend sudah satu domain.

**4. Lindungi folder `app/`.**

Buat berkas `public_html/api/app/.htaccess` berisi:

```apache
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
```

**Jangan lewatkan langkah ini.** Tanpa berkas tersebut, `.env` Anda — lengkap
dengan password database — bisa diunduh siapa pun lewat
`https://domain-anda.com/api/app/.env`.

Setelah membuatnya, pastikan alamat itu menjawab **403**, bukan menampilkan isi
berkas.

**5. Beri izin tulis pada `storage/`.**

Lewat File Manager, set izin folder `app/storage`, `app/storage/logs`, dan
`app/storage/cache` ke `755` atau `775`. Folder `app/storage` sendiri harus bisa
ditulis, bukan hanya isinya — sakelar maintenance membuat berkas
`storage/settings.json` langsung di dalamnya.

**6. Uji.**

```bash
curl https://domain-anda.com/api/health
```

Harus menjawab `{"success":true,...}`. Kalau yang muncul halaman 404 Hostinger,
`.htaccess` belum terbaca atau `mod_rewrite` mati.

### Kalau nama foldernya bukan `api`

Isi `APP_BASE_PATH` di `.env`, contoh untuk folder `backend`:

```dotenv
APP_BASE_PATH=/backend
```

---

## 9. Struktur folder

```
Backend/
├── composer.json
├── .env.example              contoh konfigurasi (.env sendiri tidak di-commit)
├── .gitignore
├── 01_schema.sql             struktur tabel V1.0
├── 02_seed.sql               isi tabel master
├── 03_align_master_data.sql  penyelarasan master data dengan frontend
├── 04_legacy_user.sql        user penampung data lama
├── 05_widen_sn.sql           tech_logs.sn: VARCHAR(100) -> TEXT
├── public/
│   ├── index.php             satu-satunya pintu masuk
│   └── .htaccess             rewrite + penerusan header Authorization
├── src/
│   ├── Config/
│   │   ├── Env.php           pembaca .env
│   │   └── Database.php      koneksi PDO
│   ├── Middleware/
│   │   ├── CorsMiddleware.php
│   │   ├── AuthMiddleware.php    verifikasi token
│   │   ├── RoleMiddleware.php    penjaga hak akses
│   │   └── ApiErrorHandler.php   semua error jadi JSON
│   ├── Controllers/
│   │   ├── AuthController.php      login & pendaftaran profil
│   │   ├── UserController.php
│   │   ├── TechLogController.php   aturan hak akses per baris
│   │   ├── BugReportController.php
│   │   ├── AuditLogController.php
│   │   ├── MasterController.php
│   │   └── SettingController.php   sakelar maintenance
│   ├── Models/
│   │   ├── BaseModel.php     semua query lewat sini
│   │   ├── UserModel.php
│   │   ├── TechLogModel.php
│   │   ├── BugReportModel.php
│   │   ├── AuditLogModel.php
│   │   └── MasterModel.php   divisi, supervisor, kategori, kode delay
│   └── Helpers/
│       ├── ApiResponse.php   pembentuk JSON
│       ├── Validator.php     validasi input
│       ├── NikGuard.php      penjaga keunikan users.nik
│       ├── Transformer.php   penerjemah nama kolom
│       ├── Pagination.php    penjepit limit & offset
│       ├── Uuid.php          pembuat id CHAR(36)
│       ├── Settings.php      pengaturan dalam berkas JSON
│       ├── FirebaseToken.php verifikasi ID token
│       └── TokenException.php
├── routes/
│   └── api.php               semua route
└── storage/
    ├── logs/                 catatan error
    ├── cache/                public key Google
    └── settings.json         sakelar maintenance (dibuat sendiri saat dipakai)
```

---

## 10. Keputusan yang perlu diketahui

**Query selalu prepared statement.** Tidak ada nilai dari user yang pernah
disambung ke string SQL, termasuk angka `LIMIT` dan `OFFSET`. Semuanya lewat
`BaseModel::run()`, yang menentukan tipe tiap parameter otomatis.
`PDO::ATTR_EMULATE_PREPARES` dimatikan supaya yang dipakai benar-benar prepared
statement MySQL, bukan penyambungan string di sisi PHP.

> Konsekuensi yang perlu diingat saat menambah query: satu nama placeholder
> tidak boleh dipakai dua kali dalam satu statement. Pencarian di `UserModel`
> memakai `:search_name`, `:search_email`, dan `:search_nik` yang nilainya sama
> persis, justru karena alasan ini; `TechLogModel` melakukan hal yang sama untuk
> enam kolomnya.

**Tidak ada kolom yang dienkripsi.** Sudah dikonfirmasi ke atasan: enkripsi
ditangani di level hosting. Data disimpan apa adanya.

**Struktur database hampir tidak diubah.** Skema V1.0 dikunci.
`03_align_master_data.sql` dan `04_legacy_user.sql` hanya mengubah isi tabel,
bukan strukturnya. Satu-satunya pengecualian adalah `05_widen_sn.sql`
(`tech_logs.sn` → `TEXT`), yang diputuskan di luar tool dan sengaja ditaruh di
berkas terpisah supaya jejaknya jelas. Perubahan struktur lain tetap dilaporkan
dulu, bukan dibuatkan `ALTER` sendiri.

**Zona waktu.** `DB_TIME_ZONE` menyetel zona waktu sesi MySQL, dan `created_at`
dikembalikan sebagai ISO lengkap dengan offset (`2026-07-01T08:00:00+07:00`).
Tanpa ini, `new Date()` di browser akan menggeser jam. Pakai offset angka
(`+07:00`), bukan `Asia/Jakarta` — shared hosting jarang memuat tabel zona waktu
MySQL.

**Kolom snapshot dipakai apa adanya.** `tech_logs.display_name`,
`nik_snapshot`, dan `supervisor` tidak diambil lewat JOIN ke `users`. Itu
disengaja: histori lama tidak boleh berubah ketika profil user diperbarui.

**`audit_logs` dan `tech_bug_reports` tidak punya kolom nama.** Berbeda dengan
Firestore, kedua tabel hanya menyimpan `user_id`. Field `userName` dan `role`
diambil lewat JOIN ke `users` — artinya yang tampil adalah nama **sekarang**,
bukan nama saat aksi dulu dilakukan. Aman karena `ON DELETE RESTRICT` menjamin
usernya selalu ada.

**`tech_bug_reports.status` punya tiga nilai:** `Open`, `In Progress`,
`Resolved`. Frontend baru mengenal dua (`types.ts`). Backend menerima ketiganya;
`types.ts` perlu ditambah saat frontend disesuaikan.

**`tech_logs.sn` sudah `TEXT`, bukan lagi `VARCHAR(100)`.** Satu aktivitas boleh
memuat banyak serial number sekaligus, dipisah baris baru. Perubahannya dicatat
di `05_widen_sn.sql`. Validasinya sekarang 65535 karakter, sekelas dengan
`deskripsi_pekerjaan` dan `catatan`, dan tetap **menolak** yang kelewat panjang
dengan pesan jelas alih-alih memotong diam-diam.

Satu catatan kecil untuk V2: `TEXT` menampung 65.535 **byte**, sedangkan
`Validator::max()` menghitung **karakter** lewat `mb_strlen()`. Untuk teks
non-ASCII penuh, batas byte tercapai lebih dulu. Ini berlaku sama untuk
`deskripsi_pekerjaan` dan `catatan` sejak V1.0 dan belum pernah jadi masalah —
`sn` isinya alfanumerik dan yang terpanjang baru 1199 karakter — tapi kalau
mau dirapikan, tempatnya satu aturan baru `maxBytes()` di `Validator`.

**`users.nik` bertipe `NOT NULL UNIQUE`.** Setiap user, termasuk atasan dan
admin, wajib punya NIK. Form registrasi di `Login.tsx` sudah mewajibkannya.

#### Yang perlu ditambahkan di frontend untuk NIK kembar

Backend sudah menolak dengan pesan siap tampil; yang belum ada adalah tempat
menampilkannya. Empat hal, urut dari yang paling perlu:

1. **Tampilkan `errors.nik` di bawah input NIK**, bukan sebagai toast. Bentuk
   responsnya sudah tetap:

   ```ts
   // 422 dari POST /api/auth/register maupun PUT /api/users/{id}
   {
     success: false,
     data: null,
     message: "NIK 52102001 sudah digunakan oleh user lain. Hubungi admin bila ini benar NIK Anda.",
     errors: { nik: "NIK sudah digunakan user lain." }
   }
   ```

   `message` untuk toast/ringkasan, `errors.nik` untuk di bawah input. Toast
   saja membuat orang menekan "Daftar" berulang kali tanpa tahu field mana yang
   salah.

2. **Jangan perlakukan 422 sebagai kegagalan tak terduga.** Kalau `Login.tsx`
   dan `AdminPanel.tsx` sekarang menampilkan "Terjadi kesalahan" untuk semua
   respons non-2xx, penolakan NIK akan tersamar jadi error umum. Cabangnya:
   `422` + ada `errors` → tampilkan per field; selain itu → pesan umum.

3. **Di AdminPanel, jangan kosongkan form setelah 422.** NIK yang baru diketik
   harus tetap ada supaya admin bisa membetulkannya, bukan mengetik ulang
   seluruh form.

4. **Pertimbangkan pengecekan saat mengetik** (`onBlur` ke
   `GET /api/users?search=<nik>`) supaya bentroknya ketahuan sebelum tombol
   simpan ditekan. Opsional — penolakan saat submit sudah benar tanpa ini.

Yang **tidak** perlu dikerjakan frontend: memeriksa keunikan sendiri sebelum
mengirim. Pemeriksaan di klien selalu bisa basi, dan backend sudah punya dua
lapis. Anggap saja jawaban backend yang benar.

Satu perubahan perilaku yang perlu diketahui: **NIK kembar dulu dijawab 409,
sekarang 422.** Kalau ada kode frontend yang sudah menangani 409 untuk kasus
ini, cabang itu perlu dipindah. 409 sekarang hanya untuk email yang sudah
terdaftar dan akun yang sudah punya profil.

**Realtime hilang.** `onSnapshot` Firestore tidak punya padanan di PHP shared
hosting. `ActivityList.tsx`, `Dashboard.tsx`, dan `ResumeTab.tsx` perlu diubah
jadi polling atau refresh manual saat frontend disesuaikan.

**`POST /api/auth/register` tidak ada di daftar endpoint awal.** Endpoint ini
ditambahkan karena tanpa dia user baru tidak punya cara mendaftar: `POST
/api/users` dijaga `RoleMiddleware`, sedangkan user baru justru belum punya role.

**`tech_logs.user_id` diisi orang yang menekan tombol simpan**, bukan hasil
pencarian NIK di form. Itu satu-satunya identitas yang bisa dibuktikan server
lewat token. Konsekuensinya, log yang diinput admin untuk teknisi lain tercatat
`user_id` admin — tapi teknisi itu tetap melihatnya, karena penyaringan "log
saya" juga mencocokkan NIK dan nama. Kalau nanti diputuskan `user_id` harus
mengikuti NIK di form, tempat mengubahnya ada satu baris di
`TechLogController::store()`.

**Aturan "karyawan hanya boleh tanggal hari ini" ikut ditegakkan backend.**
`InputForm.tsx` sudah mengunci input tanggal lewat `min`/`max`, jadi bagi
pemakai biasa tidak ada bedanya. Yang berubah: aturan itu sekarang juga berlaku
untuk permintaan yang tidak lewat form.

**Bentrok jam antar aktivitas tidak diperiksa backend.** Pemeriksaan itu ada di
`InputForm.tsx`, dan di sana admin/atasan sengaja boleh menembusnya lewat dialog
konfirmasi. Kalau backend ikut menolak, jalur konfirmasi itu mati. Dibiarkan di
frontend sampai ada keputusan lain.

**`/api/auth/sync` tidak menulis audit log.** Di alur sekarang baris
`Login/Sync` ditulis frontend lewat `addAuditLog()`, jadi perilakunya dibiarkan
sama; frontend memanggil `POST /api/audit-logs` setelah sync.

**Nasib data user yang dihapus ditentukan admin, bukan backend.** `audit_logs`
memakai `ON DELETE RESTRICT`, jadi cuma ada tiga jalan: ikut menghapus,
memindahkan ke akun penampung, atau menolak penghapusan selama catatannya masih
ada. Jalan ketiga tidak dipakai — setiap login menulis satu baris audit, jadi
menolak berarti tidak ada user yang bisa dihapus sama sekali. Dua jalan sisanya
jadi `?mode=purge` dan `?mode=detach`, dan **wajib dipilih di setiap
permintaan**: tidak ada default yang bisa menghapus data karena admin lupa.

**Maintenance disimpan di berkas, bukan tabel.** Konsekuensinya berkas itu tidak
ikut ter-backup bersama database. Kalau `storage/settings.json` hilang, sakelar
kembali ke posisi mati — dan itu memang pilihan yang lebih aman daripada
aplikasi terkunci karena berkasnya rusak.

**Master data belum dipakai frontend.** Endpoint `/api/master/*` sudah jadi,
tapi `types.ts` dan `BatchUpdateModal.tsx` masih memakai daftar yang ditulis
tetap di kode. Selama keduanya belum disambungkan, perbaikan master data di
database tidak akan terlihat di layar.

### Hubungan dengan folder lain

Sebelum migrasi dijalankan, `Migration/config/mapping.js` **harus diperbaiki
dulu**. Berkas itu ditulis sebelum `01_schema.sql` tersedia dan menebak
beberapa nama kolom yang ternyata berbeda: `users.display_name` (sebenarnya
`name`), `users.division` (sebenarnya `division_id` bertipe INT),
`audit_logs.user_name` dan `tech_bug_reports.user_name`/`role` (ketiganya tidak
ada). Perintah `npm run check` di folder `Migration/` akan menampilkan
selisihnya dan menolak menulis apa pun sebelum diperbaiki.

---

## 11. Kalau ada masalah

**Selalu 401 padahal token benar.**
Header `Authorization` dibuang Apache sebelum sampai ke PHP. Pastikan
`public/.htaccess` ikut terunggah — di dalamnya ada aturan yang meneruskan
header tersebut. Berkas berawalan titik sering tersembunyi di File Manager;
nyalakan dulu opsi "show hidden files".

**"Token ini bukan untuk aplikasi ini".**
`FIREBASE_PROJECT_ID` di `.env` berbeda dengan `projectId` di
`Frontend/firebase-applet-config.json`.

**"Sesi login sudah berakhir" padahal baru login.**
Jam server meleset lebih dari 60 detik. Periksa `date` di server.

**500 dengan pesan umum.**
Buka `storage/logs/error-YYYY-MM-DD.log`, di situ pesan aslinya lengkap. Kalau
folder log kosong, kemungkinan besar `storage/` belum bisa ditulis.

**Semua endpoint 404 di komputer sendiri.**
Bagian `public/index.php` di akhir perintah `php -S` terlewat.

**Semua endpoint 404 di server.**
`mod_rewrite` mati atau `.htaccess` tidak terbaca. Hubungi dukungan Hostinger
untuk memastikan `AllowOverride All` menyala.

**Frontend kena "CORS error" saat development.**
Origin Vite belum terdaftar. Tambahkan ke `CORS_ALLOWED_ORIGINS`, pisahkan
dengan koma, dan tulis lengkap dengan skema serta port
(`http://localhost:5173`).

**Semua pendaftaran ditolak "NIK tersebut tidak bisa dipakai mendaftar".**
Tabel `tech_logs` kosong atau NIK-nya tidak cocok. Periksa dulu:

```sql
SELECT COUNT(*) FROM tech_logs WHERE nik_snapshot = 'NIK-YANG-DICOBA';
```

Kalau nol, tambahkan NIK-nya lewat `POST /api/allowed-niks`, atau matikan
sementara Lapis 1 dengan `REGISTRATION_REQUIRE_KNOWN_NIK=false`.

**Pendaftar melihat "Profil tersimpan, tapi server tidak mengembalikan
datanya".**
Frontend belum diperbarui untuk jawaban **202**. `registerProfile()` di
`utils/auth.ts` melempar error kalau `data.user` kosong, dan pendaftaran yang
masuk antrean memang mengembalikan `user: null`. Permintaannya **tetap masuk
antrean** — pesannya saja yang salah. Sampai frontend disesuaikan, jalankan
`REGISTRATION_REQUIRE_APPROVAL=false`; Lapis 1 tetap bekerja. Lihat
[bagian 14](#14-yang-masih-perlu-dikerjakan-di-frontend).

**Semua super admin hilang setelah deploy ulang.**
`storage/super-admins.json` ikut tertimpa. Yang di `.env` tidak terpengaruh —
itu memang gunanya. Jalur pemulihannya ada di
[bagian 13](#13-super-admin-dan-serah-terima).

**"Gagal menulis ke .../storage/registrations.json".**
Folder `storage/` tidak bisa ditulis PHP. Setel izinnya ke 755 (atau 775 kalau
PHP jalan sebagai user lain), sama seperti syarat `storage/logs`.

---

## 12. Pembatasan pendaftaran

Sebelumnya siapa pun yang punya link dan Akun Google bisa mendaftar, mengisi NIK
apa saja, dan langsung punya akses penuh. Sekarang ada dua lapis.

Login **tetap** Google SSO dan tidak berubah sedikit pun. Yang berubah hanya
siapa yang boleh masuk setelah identitasnya terbukti.

### Lapis 1 — NIK harus sudah dikenal sistem

NIK dianggap dikenal kalau ada di salah satu dari dua tempat:

| Sumber | Isinya |
|---|---|
| `tech_logs.nik_snapshot` | 6.713 baris hasil migrasi — seluruh teknisi lama |
| `storage/allowed-niks.json` | NIK yang ditambahkan admin lewat AdminPanel |

Sumbernya sengaja **bukan** tabel `users`. Teknisi lama yang belum pernah login
tidak punya baris di sana sama sekali — NIK mereka hanya ada di kolom snapshot,
terikat ke akun penampung `legacy-unknown`. Justru merekalah yang paling mungkin
mendaftar.

Yang selalu ditolak, apa pun keadaannya:

- NIK yang sudah dipakai user aktif (`users.nik` bertipe UNIQUE)
- NIK yang sedang dipakai permintaan lain di antrean
- `LEGACY-000`, NIK akun penampung

**Semua penolakan memakai satu kalimat yang sama persis.** "Tidak dikenal" dan
"sudah dipakai" tidak dibedakan, karena kalau dibedakan, formulir pendaftaran —
yang terbuka untuk siapa saja yang punya Akun Google — berubah jadi alat menebak
NIK karyawan satu per satu: coba sebuah angka, baca pesannya, simpulkan.

Yang tersisa dan diterima sebagai risiko: NIK yang lolos dijawab **202**
sedangkan yang gagal dijawab **422**, jadi keduanya masih bisa dibedakan.
Menutupnya berarti menerima semua pendaftaran ke antrean termasuk yang NIK-nya
asing — memindahkan pekerjaan menyaring ke admin. Hasil tebakannya pun tidak
berguna sendiri: tanpa persetujuan admin, NIK yang benar tidak membuka apa pun.

### Lapis 2 — admin harus menyetujui

Yang lolos Lapis 1 masuk ke `storage/registrations.json`, **bukan** ke tabel
`users`.

Ini keputusan yang paling menentukan di seluruh fitur ini. `users.role` bertipe
`ENUM('admin','atasan','karyawan')`, dan menambah nilai `'pending'` ke ENUM
adalah `ALTER TABLE` — schema V1.0 dikunci, jadi jalan itu tertutup. Menandai
lewat kolom lain (misalnya `division_id` ke divisi sentinel) bisa saja, tapi
harganya dua: divisi pilihan pendaftar tidak punya tempat disimpan, dan
`RoleMiddleware` harus diajari menolak divisi itu di setiap endpoint — satu
endpoint yang lupa memasang pemeriksaannya berarti pendaftar dapat akses penuh.

Dengan tidak membuat baris `users` sama sekali:

- `RoleMiddleware` yang sudah ada menolaknya di semua endpoint, karena atribut
  `user` bernilai `null`. Tidak ada aturan akses baru yang bisa salah ditulis.
- `users.nik` yang UNIQUE tidak terkunci oleh orang yang belum tentu disetujui.
- Nama, NIK, dan divisi pilihannya tersimpan utuh.

Yang dibayar: antrean tidak ikut dalam dump database. Kalau `storage/` hilang,
pendaftaran yang menunggu ikut hilang dan orangnya mendaftar ulang. Tidak ada
data permanen yang lenyap — yang belum disetujui memang belum jadi apa-apa.

### Yang ditolak disimpan, bukan dihapus

Kalau dihapus, orang yang sama bisa mendaftar berkali-kali dan antrean admin
tidak ada habisnya. `DELETE /api/registrations/{uid}` membuka kembali penolakan
yang keliru.

### Siapa yang lolos kedua lapis

Hanya **super admin**. Ini yang menjaga supaya aturan di atas tidak bisa
mengunci semua orang di luar: super admin baru yang diangkat pendahulunya belum
tentu punya NIK di `tech_logs` mana pun, dan kalau semua admin sudah pergi,
tidak ada siapa pun di dalam yang bisa menyetujuinya.

Pengecualiannya menyeluruh, bukan hanya kedua lapis itu: kalau permintaannya
sudah terlanjur mengantre, atau pernah ditolak, sebelum dia diangkat menjadi
super admin, keduanya tetap dilewati. `GET /api/auth/status` juga mengembalikan
`unregistered` untuknya, bukan `pending` atau `rejected`, supaya yang muncul
adalah formulir pendaftaran — bukan layar tunggu yang tidak ada seorang pun
tersisa untuk membukanya. Antrean dan catatan tolakannya dibersihkan sendiri
setelah profilnya jadi.

Satu-satunya yang **tidak** bisa dibuka dengan cara ini adalah akun penampung
`legacy-unknown`; pemeriksaannya berjalan lebih dulu, jadi mengangkat alamat
`.invalid` menjadi super admin pun tidak membukanya.

Akun penampung `legacy-unknown` ditolak di semua jalur: UID-nya bukan UID Google
dan emailnya memakai domain `.invalid` yang tidak bisa didaftarkan siapa pun.

### Dua sakelar darurat

```dotenv
REGISTRATION_REQUIRE_KNOWN_NIK=true   # Lapis 1
REGISTRATION_REQUIRE_APPROVAL=true    # Lapis 2
```

Keduanya menyala kalau barisnya dihapus atau dikosongkan — default-nya sengaja
yang paling ketat. Bisa dimatikan sendiri-sendiri, tanpa menyentuh kode atau
database. Mematikan Lapis 1 **tidak** mematikan pemeriksaan NIK kembar; yang
hilang hanya syarat "harus sudah dikenal".

### Alur untuk atasan dan admin baru

Mereka tidak punya jejak di `tech_logs`, jadi:

1. Admin menambahkan NIK-nya: `POST /api/allowed-niks` dengan `{ nik, note }`
2. Orangnya login Google dan mengisi form pendaftaran seperti biasa
3. Pendaftarannya **tetap** masuk antrean dan harus disetujui
4. Saat menyetujui, admin memilih rolenya: `{ "role": "atasan" }`

Daftar izin hanya menambah sumber NIK yang sah. Ia tidak melewati satu pun
pemeriksaan lain.

### Apa yang tercatat di `audit_logs`

| Aksi | Kapan |
|---|---|
| `Menyetujui pendaftaran` | admin menyetujui |
| `Menolak pendaftaran` | admin menolak, beserta alasannya |
| `Membuka kembali pendaftaran yang ditolak` | catatan tolakan dihapus |
| `Menambahkan NIK ke daftar izin` | NIK diizinkan |
| `Menghapus NIK dari daftar izin` | izin dicabut |
| `Mengangkat super admin` | lihat bagian 13 |
| `Menurunkan super admin` | lihat bagian 13 |

Yang tercatat sebagai pelaku selalu **adminnya**, tidak pernah pelamarnya.
Bukan pilihan gaya: `audit_logs.user_id` punya foreign key ke `users`,
sedangkan pelamar yang ditolak justru tidak punya baris di sana. Identitas
pelamar (email dan NIK) ikut ditulis di kolom `description`.

Kalau penulisan audit gagal, aksinya **tetap berhasil** dan pesan suksesnya
diberi imbuhan peringatan. Membatalkan persetujuan yang sudah tersimpan hanya
karena catatannya gagal ditulis justru membuat keadaan lebih kacau.

---

## 13. Super admin dan serah terima

### Dari mana statusnya berasal

Gabungan dua sumber:

| Sumber | Bisa diturunkan lewat aplikasi? |
|---|---|
| `SUPER_ADMIN_EMAILS` di `.env` (dipisah koma) | **tidak** |
| `storage/super-admins.json`, diangkat lewat AdminPanel | ya |

`SUPER_ADMIN_EMAIL` (bentuk tunggal, nama lama) masih dibaca dan diperlakukan
sama seperti yang di `.env`, jadi pemasangan lama tetap jalan tanpa disunting.

Status ini melekat pada **email**, bukan pada `users.role`. Alasannya: admin
biasa boleh mengubah role orang lain lewat `PUT /api/users/{id}`. Kalau status
super admin ikut disimpan di sana, admin biasa bisa menurunkan super admin —
persis yang harus dicegah. Karena melekat pada email, `AuthController::sync()`
menaikkan role super admin menjadi `admin` setiap kali dia login; walaupun
rolenya sempat diturunkan orang lain, dia naik lagi begitu masuk.

### Tiga pengaman

1. Alamat dari `.env` tidak bisa diturunkan lewat endpoint mana pun.
2. Super admin terakhir tidak bisa diturunkan, termasuk oleh dirinya sendiri.
3. Hanya super admin yang boleh mengangkat super admin — admin biasa tidak.

Mengangkat alamat yang **belum punya akun** diperbolehkan, dan itu memang
jalurnya: alamat yang sudah jadi super admin melewati kedua lapis pembatasan
saat mendaftar, jadi penerus bisa disiapkan sebelum dia pernah login sekalipun.

### Serah Terima

Yang harus dilakukan **sebelum** super admin lama meninggalkan sistem:

1. **Angkat penggantinya.** `POST /api/super-admins` dengan `{ "email": "..." }`,
   atau lewat AdminPanel. Boleh sebelum orangnya pernah login.
2. **Pastikan penggantinya benar-benar bisa masuk.** Minta dia login dan periksa
   `GET /api/auth/status` mengembalikan `is_super_admin: true`. Jangan hanya
   percaya daftarnya.
3. **Pindahkan minimal satu alamat penerus ke `.env`.** Sunting
   `SUPER_ADMIN_EMAILS` di server, pisahkan dengan koma. Ini yang membuat
   sistem tetap bisa dimasuki walaupun `storage/` suatu saat terhapus.
   ```dotenv
   SUPER_ADMIN_EMAILS=penerus@perusahaan.com,cadangan@perusahaan.com
   ```
4. **Baru turunkan diri sendiri**, kalau memang perlu:
   `DELETE /api/super-admins/{email}`. Alamat yang ada di `.env` tidak bisa
   diturunkan dari sini — hapus dulu dari `.env`.
5. **Serahkan akses server.** Login hPanel Hostinger, letak `.env`, dan letak
   `storage/`. Tanpa itu langkah 3 tidak bisa diulang oleh siapa pun.
6. **Ikutkan `storage/*.json` ke dalam rutinitas cadangan.** Isinya tidak ada di
   dump database: antrean pendaftaran, daftar izin NIK, dan daftar super admin.

### Kalau semua super admin sudah tidak ada

Urut dari yang paling tidak merusak:

**Punya akses `.env` (hPanel / FTP).** Tambahkan alamat mana pun ke
`SUPER_ADMIN_EMAILS`, simpan, selesai. Berlaku pada request berikutnya, tidak
perlu restart apa pun. Kalau alamat itu belum punya akun, dia bisa langsung
mendaftar tanpa melewati kedua lapis.

**Punya akses `storage/`.** Sunting `storage/super-admins.json`:

```json
{
  "emails": {
    "penerus@perusahaan.com": {
      "email": "penerus@perusahaan.com",
      "promoted_by": "pemulihan-manual",
      "promoted_by_email": "pemulihan-manual",
      "promoted_at": "2026-08-16T10:00:00+07:00"
    }
  }
}
```

**Hanya punya akses database (phpMyAdmin).** Ini pemulihan **sebagian** — jujur
saja soal ini: status super admin tidak ada di database, jadi tidak bisa
diberikan dari sana. Yang bisa dilakukan adalah mengangkat admin biasa:

```sql
UPDATE users SET role = 'admin' WHERE email = 'penerus@perusahaan.com';
```

Admin biasa cukup untuk menyetujui pendaftaran, mengelola daftar izin NIK, dan
mengurus user — jadi kantor tetap jalan. Yang tidak bisa dia lakukan hanya
mengangkat super admin. Untuk itu tetap perlu akses `.env` atau `storage/`.

**Tidak punya akses apa pun.** Hubungi dukungan Hostinger untuk memulihkan akses
hPanel. Tidak ada jalan lain, dan itu memang disengaja.

---

## 14. Yang masih perlu dikerjakan di frontend

Backend sudah siap; frontend **belum disentuh sama sekali**. Berikut yang perlu
diubah.

> **Sampai ini dikerjakan, jalankan `REGISTRATION_REQUIRE_APPROVAL=false`.**
> Lapis 1 tetap bekerja penuh — NIK asing sudah tertolak — sementara Lapis 2
> menunggu layarnya ada. Kalau dinyalakan sekarang, pendaftar yang masuk antrean
> akan melihat pesan yang salah (lihat butir pertama di bawah).

### `src/utils/auth.ts`

- **`SyncResult` perlu field `status`**: `'active' | 'unregistered' | 'pending' |
  'rejected'`, plus `registration` dan `is_super_admin`. Field `registered` yang
  lama tetap dikirim server, jadi tidak ada yang rusak selama masa transisi.
- **`registerProfile()` harus menangani 202.** Sekarang fungsi itu melempar
  `ApiError(500, 'Profil tersimpan, tapi server tidak mengembalikan datanya')`
  kalau `data.user` kosong — dan jawaban 202 memang mengembalikan `user: null`.
  Pendaftarannya sebenarnya berhasil masuk antrean; hanya pesannya yang salah.
  Return type-nya perlu berubah dari `Promise<User>` menjadi sesuatu yang bisa
  mewakili dua keadaan.
- **Fungsi baru** untuk endpoint admin: daftar antrean, setujui, tolak, buka
  kembali, daftar izin NIK (baca/tambah/hapus), dan super admin
  (baca/angkat/turunkan).
- **`getStatus()`** yang memanggil `GET /api/auth/status`, untuk layar tunggu.

### `src/components/Login.tsx`

Cabang `if (r.registered)` sekarang punya empat kemungkinan, bukan dua. Lihat
contoh `switch` di [bagian 6](#6-autentikasi).

### Layar baru: "Menunggu Persetujuan"

Muncul saat `status === 'pending'`. Isinya nama, NIK, dan divisi yang didaftarkan
(ada di `data.registration`), plus tombol "Periksa lagi" yang memanggil
`GET /api/auth/status`. Jangan polling otomatis rapat-rapat — persetujuan bisa
makan waktu berhari-hari.

Layar serupa untuk `status === 'rejected'`, menampilkan
`data.registration.reason`.

Selama menunggu, **tidak ada endpoint lain yang bisa dipanggil**. Semua menjawab
403 dengan pesan "Pendaftaran Anda sedang menunggu persetujuan admin", jadi
jangan biarkan aplikasi memuat dashboard lalu gagal sepotong-sepotong.

### `src/components/AdminPanel.tsx`

Tiga hal baru:

1. **Tab "Persetujuan"** — daftar dari `GET /api/registrations`, tiap baris
   dengan tombol Setujui (pilih role dulu: `karyawan` / `atasan` / `admin`) dan
   Tolak (dengan kolom alasan). Tambahkan penanda jumlah antrean di judul tab;
   tanpa itu tidak ada yang tahu ada orang menunggu.
2. **Daftar izin NIK** — di tab Pengaturan. Form satu baris (NIK + catatan) dan
   daftar yang bisa dihapus.
3. **Kelola super admin** — hanya ditampilkan kalau `is_super_admin` bernilai
   true. `GET /api/super-admins` mengembalikan `removable` per baris; pakai itu
   untuk menonaktifkan tombol hapus pada alamat yang berasal dari `.env`, jangan
   menawarkan tombol yang sudah pasti ditolak server.

### Penanganan response baru

| Kode | Dari | Artinya |
|---|---|---|
| 202 | `POST /api/auth/register` | masuk antrean, `user` sengaja `null` |
| 403 | endpoint mana pun | pesan sudah membedakan menunggu / ditolak / belum daftar |
| 403 | `/api/super-admins/*` | "Hanya super admin yang boleh…" |
| 422 | `POST /api/auth/register` | `errors.nik` — tampilkan di bawah input NIK |

Pesan 422 untuk NIK **selalu sama** apa pun sebabnya. Jangan menambahkan tebakan
di frontend seperti "mungkin NIK ini sudah dipakai" — itu mengembalikan kebocoran
yang baru saja ditutup di server.
