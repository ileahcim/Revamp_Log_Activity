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

Token sah tapi belum punya baris di `users` mendapat **403**, bukan 401. Itu
sinyal bagi frontend untuk menampilkan form "Lengkapi Profil" seperti alur di
`Login.tsx` sekarang.

Tiga route dikecualikan dan hanya dijaga `AuthMiddleware`: `POST /api/auth/sync`,
`POST /api/auth/register`, dan `GET /api/master/divisions`. User yang baru
pertama kali login memang belum punya baris di `users`, jadi kalau
`RoleMiddleware` ikut dipasang dia akan ditolak 403 dan tidak akan pernah bisa
mendaftar — termasuk saat form "Lengkapi Profil" mengambil pilihan divisinya.

### Alur login yang menggantikan Login.tsx

```ts
const hasil = await signInWithPopup(auth, googleProvider);
const token = await hasil.user.getIdToken();

const r = await post('/api/auth/sync', {}, token);

if (r.data.registered) {
  onLogin(r.data.user);                 // langsung masuk
} else {
  tampilkanFormProfil(r.data.prefill);  // { id, email, name } dari token
  // lalu: post('/api/auth/register', { name, nik, divisi }, token)
}
```

Yang dipercaya dari body hanya `name`, `nik`, dan `divisi`. `id`, `email`, dan
`role` diambil dari token — kalau ketiganya ikut dikirim, backend mengabaikannya.
Promosi super admin (`SUPER_ADMIN_EMAIL`) juga terjadi di server, bukan seperti
sekarang yang ditulis frontend ke Firestore.

---

## 7. Daftar endpoint

Sudah jadi:

| Metode | Endpoint | Akses | Keterangan |
|---|---|---|---|
| GET | `/api/health` | terbuka | memastikan backend hidup |
| POST | `/api/auth/sync` | token sah | cek profil setelah login Google |
| POST | `/api/auth/register` | token sah | buat profil pertama kali |
| GET | `/api/auth/me` | terdaftar | profil sendiri |
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
