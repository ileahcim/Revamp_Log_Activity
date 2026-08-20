# Deploy ke Hostinger

Aplikasi: **arpgrs.com/log_activity** — backend: **arpgrs.com/log_activity/api**
Hosting: Hostinger Cloud Hosting (shared), akses lewat FTP/FileZilla, tanpa SSH.

Baca sekali sampai habis sebelum membuka FileZilla. Yang paling sering
menggagalkan deploy bukan langkah unggahnya, melainkan tiga hal kecil:
`APP_BASE_PATH` di backend, `VITE_BASE_PATH` saat build frontend, dan satu
berkas `.htaccess` penjaga folder `app/`. Ketiganya sudah disiapkan di repo
ini; yang perlu Anda lakukan hanya mengikuti urutannya.

---

## 0. Peta

Susunan di server setelah selesai:

```
public_html/
└── log_activity/
    ├── .htaccess           <- ikut sendiri di dalam dist/
    ├── index.html          <- hasil build React
    ├── assets/             <- hasil build React
    └── api/
        ├── index.php       <- Backend/public/index.php
        ├── .htaccess       <- Backend/public/.htaccess
        └── app/
            ├── .htaccess   <- Backend/deploy/app/.htaccess   (penjaga)
            ├── .env        <- Backend/deploy/app/.env         (Anda yang isi)
            ├── src/
            ├── routes/
            ├── vendor/
            └── storage/
```

`index.php` mengenali sendiri susunan ini: kalau ada subfolder bernama `app`,
isi aplikasi dicari di situ. Tidak ada satu baris kode pun yang perlu diubah
saat deploy.

Kenapa isi aplikasi ditaruh di dalam `app/`, bukan di luar `public_html`
seperti lazimnya: di shared hosting tidak ada tempat di luar `public_html`.
Karena itu folder `app/` harus dijaga dengan `.htaccess` — bagian ini tidak
boleh dilewati, dan sengaja diulang tiga kali di panduan ini.

Peta berkas, dari komputer ke server:

| Dari (repo) | Ke (server) |
|---|---|
| `Frontend/dist/` (seluruh isinya, termasuk `.htaccess`) | `public_html/log_activity/` |
| `Backend/public/index.php` | `public_html/log_activity/api/index.php` |
| `Backend/public/.htaccess` | `public_html/log_activity/api/.htaccess` |
| `Backend/deploy/app/.htaccess` | `public_html/log_activity/api/app/.htaccess` |
| `Backend/deploy/app/.env` | `public_html/log_activity/api/app/.env` |
| `Backend/src/` | `public_html/log_activity/api/app/src/` |
| `Backend/routes/` | `public_html/log_activity/api/app/routes/` |
| `Backend/vendor/` | `public_html/log_activity/api/app/vendor/` |
| `Backend/storage/` | `public_html/log_activity/api/app/storage/` |

Yang **tidak** ikut diunggah: `node_modules/`, `Frontend/src/`, `Migration/`,
`.git/`, berkas `*.sql`, `README.md`, dan `Backend/.env` (itu punya
development — isinya `APP_DEBUG=true` dan CORS menyala).

---

## 1. Sebelum mulai

- [ ] **Database sudah terisi.** Migrasi selesai 16 Agustus 2026, 6.713 baris
      `tech_logs`. **Jangan** menjalankan ulang `01_schema.sql` sampai
      `05_widen_sn.sql` — berkas itu membangun tabel dari nol dan akan
      berbenturan dengan data yang sudah ada.
- [ ] **Kredensial database di tangan.** hPanel → Databases → Management.
      Nilainya sama dengan yang ada di `Backend/.env` lokal Anda, kecuali
      `DB_HOST` (lihat langkah 3).
- [ ] **PHP 8.1 atau lebih baru.** hPanel → PHP Configuration. `vendor/`
      dibangun untuk 8.1; di PHP 8.0 ke bawah, `vendor/composer/platform_check.php`
      menolak jalan dan semua endpoint menjawab 500.
- [ ] **Force HTTPS menyala.** hPanel → SSL. Pemindai barcode meminta kamera
      lewat `getUserMedia`, dan browser menolak permintaan itu di halaman
      `http://` biasa — gejalanya kamera tidak pernah menyala, tanpa pesan.
- [ ] **`arpgrs.com` terdaftar di Firebase.** Firebase Console →
      Authentication → Settings → Authorized domains → Add domain. Tanpa ini
      tombol login menjawab `auth/unauthorized-domain` dan tidak ada yang bisa
      masuk sama sekali. Ini satu-satunya setelan Firebase yang perlu disentuh.
- [ ] **FileZilla menampilkan berkas tersembunyi.** Menu Server → Force
      showing hidden files. Empat berkas terpenting di panduan ini namanya
      diawali titik, dan tidak akan terlihat tanpa opsi ini.
- [ ] **FileZilla mode Binary.** Transfer → Transfer type → Binary.

---

## 2. Langkah 1 — siapkan `vendor/`

```bash
cd Backend
composer install --no-dev --optimize-autoloader
```

Composer tidak tersedia di shared hosting, jadi `vendor/` dibangun di komputer
sendiri lalu ikut diunggah. `composer.json` sudah mengunci `platform.php` ke
`8.1.0`, jadi hasilnya tetap cocok walaupun PHP di komputer Anda lebih baru
daripada di server.

Ukurannya sekitar 2 MB, kurang lebih 1.000 berkas kecil.

---

## 3. Langkah 2 — siapkan `.env` production

```bash
cd Backend
cp .env.production.example deploy/app/.env
```

Lalu buka `Backend/deploy/app/.env` dan isi tiga baris ini saja:

```dotenv
DB_NAME=u123456789_...
DB_USER=u123456789_...
DB_PASSWORD=...
```

Sisanya sudah benar untuk pemasangan ini. Dua baris yang paling menentukan dan
sebaiknya Anda periksa sendiri:

```dotenv
APP_BASE_PATH=/log_activity   # bagian alamat di depan "/api"
APP_DEBUG=false               # wajib, kalau tidak pesan error PHP ikut terkirim ke browser
```

`DB_HOST` sengaja `localhost`, bukan `153.92.15.7` seperti di `.env` lokal
Anda. Alamat IP itu hanya diperlukan saat menghubungi database dari luar
(Remote MySQL, dipakai waktu migrasi); dari dalam server, database ada di
mesin yang sama dan `localhost` lebih cepat serta tidak bergantung pada daftar
IP yang diizinkan.

Berkas ini ditaruh di `deploy/app/` bukan tanpa alasan: namanya sudah `.env`,
jadi nanti tinggal diseret dari FileZilla tanpa perlu diganti nama di server.
`.gitignore` menahannya agar tidak pernah ikut ter-commit — sudah diuji.

---

## 4. Langkah 3 — build frontend

```bash
cd Frontend
npm run build
```

`npm run build` otomatis memakai `.env.production`, yang isinya:

```dotenv
VITE_BASE_PATH=/log_activity
VITE_API_URL=/log_activity
```

Setelah selesai, **periksa dua hal** sebelum mengunggah apa pun:

```bash
ls -a dist                     # harus ada .htaccess di situ
grep assets dist/index.html    # alamatnya harus /log_activity/assets/...
```

Kalau alamat di `index.html` masih `/assets/index-xxxx.js` tanpa
`/log_activity` di depannya, `.env.production` tidak terbaca. Hasil build itu
akan menampilkan **layar putih** di server, tanpa pesan error apa pun di
halaman — satu-satunya petunjuknya 404 di tab Network. Ulangi build-nya.

Kalau `.htaccess` tidak ada di `dist/`, berarti `Frontend/public/.htaccess`
terhapus. Vite menyalin seluruh isi `Frontend/public/` ke `dist/` di setiap
build; pulihkan berkas itu dari git lalu build ulang.

---

## 5. Langkah 4 — unggah

Urutannya penting. Penjaga dulu, isi belakangan — jangan sampai ada jeda
beberapa menit ketika `.env` sudah ada di server tapi `.htaccess`-nya belum.

**4a. Buat folder** `public_html/log_activity/` dan `public_html/log_activity/api/`,
lalu `public_html/log_activity/api/app/`.

**4b. Unggah penjaganya lebih dulu:**

1. `Backend/public/.htaccess` → `api/.htaccess`
2. `Backend/deploy/app/.htaccess` → `api/app/.htaccess`

**4c. Baru `.env`:** `Backend/deploy/app/.env` → `api/app/.env`

Langsung buka `https://arpgrs.com/log_activity/api/app/.env` di browser.
Harus dijawab **403 atau 404**. Kalau yang muncul isi berkasnya, hentikan
semuanya, hapus berkas itu dari server, dan perbaiki `.htaccess` dulu.

**4d. Sisanya:**

| Dari | Ke |
|---|---|
| `Backend/public/index.php` | `api/index.php` |
| `Backend/src/` | `api/app/src/` |
| `Backend/routes/` | `api/app/routes/` |
| `Backend/vendor/` | `api/app/vendor/` |
| `Backend/storage/` | `api/app/storage/` |
| `Frontend/dist/` (seluruh isinya) | `log_activity/` |

`Backend/src/`, `routes/`, dan `storage/` masing-masing sudah membawa
`.htaccess` penolak sendiri di dalamnya — ikut terunggah otomatis selama
FileZilla menampilkan berkas tersembunyi. Itu lapis kedua, kalau-kalau
`app/.htaccess` terlewat.

**Jangan unggah berkas `.json` dari `Backend/storage/` komputer Anda.**
Isinya data percobaan lokal. Yang perlu ada di server hanya foldernya beserta
`logs/` dan `cache/`; aplikasi membuat sendiri `settings.json`,
`registrations.json`, `allowed-niks.json`, dan `super-admins.json` saat
pertama dibutuhkan — berkas yang belum ada dibaca sebagai kosong, bukan error.

### Berapa besarnya

| Bagian | Berkas | Ukuran |
|---|---:|---:|
| `vendor/` | 316 | 2,2 MB |
| `src/` | 38 | 312 KB |
| `routes/` | 2 | 24 KB |
| `storage/` (tanpa `.json`) | 3 | 12 KB |
| `public/` → `api/` | 2 | 12 KB |
| `dist/` | 4 | 2,1 MB |
| **Total** | **±365** | **±4,6 MB** |

Ukurannya kecil; **jumlah berkasnya** yang jadi masalah. `vendor/` berisi 316
berkas dengan rata-rata 7 KB. Lewat FTP, setiap berkas butuh perintah dan
jawaban tersendiri, jadi yang memakan waktu bukan 2,2 MB-nya melainkan 316
kali putar-balik ke server — dan setiap putaran itu satu kesempatan untuk
putus di tengah.

### Cara yang tidak putus di tengah: satu berkas ZIP

Kumpulkan dulu persis seperti susunan di server, lalu kompres:

```bash
cd Backend

rm -rf deploy/build
mkdir -p deploy/build/api/app/storage/logs deploy/build/api/app/storage/cache

cp public/index.php public/.htaccess       deploy/build/api/
cp deploy/app/.htaccess deploy/app/.env    deploy/build/api/app/
cp -r src routes vendor                    deploy/build/api/app/
cp storage/.htaccess                       deploy/build/api/app/storage/
touch deploy/build/api/app/storage/logs/.gitkeep \
      deploy/build/api/app/storage/cache/.gitkeep

cd deploy/build && python3 -m zipfile -c ../../../api.zip api
```

`python3 -m zipfile`, bukan perintah `zip`, karena `zip` sering tidak
terpasang di WSL — dan modul bawaan Python ini ikut menyertakan berkas
berawalan titik, yang justru paling penting di sini. Hasilnya `api.zip` di
akar repo, kira-kira 900 KB.

Frontend menyusul dengan cara yang sama:

```bash
cd Frontend/dist && python3 -m zipfile -c ../../log_activity.zip .
```

Lalu di server, lewat **hPanel → File Manager** (bukan FileZilla):

1. Masuk ke `public_html/log_activity/`, unggah `log_activity.zip`, klik
   kanan → **Extract**, lalu hapus ZIP-nya.
2. Di folder yang sama, unggah `api.zip`, Extract — dia sudah membawa
   foldernya sendiri bernama `api/`. Hapus ZIP-nya.

Dua berkas, bukan 365. Kalau salah satunya putus di tengah, yang perlu
diulang hanya satu unggahan, dan tidak ada keadaan setengah jadi yang
membingungkan — ZIP yang tidak utuh gagal diekstrak dengan jelas, sementara
FTP yang putus meninggalkan folder yang tampak lengkap padahal bolong.

Isi `deploy/build/` adalah cerminan persis apa yang ada di server. Berkas itu
tidak ikut ke git, dan boleh dihapus setelah selesai.

### Kalau tetap ingin lewat FileZilla

Bisa, hanya perlu sabar dan tiga setelan:

- **Edit → Settings → Transfers → Maximum simultaneous transfers: 2.**
  Menaikkannya justru memperlambat: Hostinger membatasi jumlah koneksi per
  akun dan menjawab `421 Too many connections` begitu batasnya lewat.
- **Edit → Settings → Connection → Timeout: 120 detik.** Bawaannya 20 detik,
  terlalu pendek untuk antrean panjang.
- Kalau ada yang gagal, jangan mulai dari nol: klik kanan pada antrean →
  **Reset and requeue failed transfers**, lalu jalankan lagi. FileZilla hanya
  mengulang yang gagal.

Setelah selesai, cocokkan jumlah berkasnya lewat File Manager: `api/app/vendor`
harus berisi 316 berkas. Kalau kurang, ada yang putus — dan gejalanya nanti
bukan pesan yang jelas, melainkan 500 dengan "Class not found" di
`storage/logs/`.

---

## 6. Langkah 5 — izin tulis

Lewat File Manager, set izin folder berikut ke **755** (atau **775** kalau PHP
di server berjalan sebagai user lain):

- `api/app/storage`
- `api/app/storage/logs`
- `api/app/storage/cache`

Folder `storage` sendiri harus bisa ditulis, bukan hanya isinya — antrean
pendaftaran dan sakelar maintenance membuat berkas langsung di dalamnya.

---

## 7. Langkah 6 — uji

Buka satu per satu. Semuanya harus sesuai kolom kanan sebelum aplikasi
diserahkan ke pengguna.

| Alamat | Harus |
|---|---|
| `/log_activity/api/health` | JSON `{"success":true,...}` |
| `/log_activity/` | aplikasi tampil, bukan layar putih |
| `/log_activity/halaman-yang-tidak-ada` | aplikasi tampil juga, bukan 404 Hostinger |
| `/log_activity/api/app/.env` | **403 atau 404** |
| `/log_activity/api/app/storage/registrations.json` | **403 atau 404** |
| `/log_activity/api/app/src/Config/Database.php` | **403 atau 404** |
| `/log_activity/api/app/vendor/autoload.php` | **403 atau 404** |
| `/log_activity/api/app/routes/api.php` | **403 atau 404** |
| `/log_activity/api/` | JSON 404 dari Slim, bukan daftar isi folder |

Lalu uji alurnya sebagai manusia: login dengan Google (super admin dulu),
buka Dashboard, buat satu log percobaan, hapus lagi, dan buka AdminPanel →
tab Audit Log untuk memastikan aksinya tercatat.

Yang tersisa setelah itu hanya satu: pastikan satu orang non-admin bisa
login, karena jalur pendaftaran melewati antrean persetujuan.

---

## 8. Deploy ulang berikutnya

**Kalau yang berubah hanya frontend:**

```bash
cd Frontend && npm run build
```

Hapus isi `log_activity/assets/` yang lama di server, lalu unggah `index.html`
dan `assets/` yang baru. Nama berkas hasil build memuat sidik jari isinya,
jadi yang lama tidak akan pernah tersaji sebagai yang baru — dihapus supaya
tidak menumpuk saja. `.htaccess` boleh ikut tertimpa, isinya sama.

**Kalau yang berubah kode backend:** timpa `api/app/src/` dan
`api/app/routes/`. `vendor/` hanya perlu diunggah ulang kalau
`composer.lock` berubah.

**Yang tidak boleh tertimpa, dalam keadaan apa pun:**

- `api/app/.env`
- `api/app/storage/*.json` — di dalamnya ada antrean pendaftaran, daftar NIK
  yang diizinkan, sakelar maintenance, dan daftar super admin. Menimpanya
  dengan berkas dari komputer adalah penyebab keluhan "semua super admin
  hilang setelah deploy ulang". Super admin di `.env` tidak terpengaruh — itu
  memang gunanya.

Cara paling aman: unggah ke folder, jangan pernah menghapus `api/app/`
seluruhnya lalu membuat ulang.

---

## 9. Kalau ada masalah

| Gejala | Sebab yang paling mungkin | Obat |
|---|---|---|
| Layar putih, tab Network penuh 404 `index-xxxx.js` | `index.html` menunjuk `/assets/...`, bukan `/log_activity/assets/...` | build ulang; periksa `VITE_BASE_PATH` di `Frontend/.env.production` |
| Semua endpoint dijawab 404 **berbentuk JSON** | `APP_BASE_PATH` salah atau kosong | isi `/log_activity` di `api/app/.env` |
| `/log_activity/api/health` menampilkan halaman 404 Hostinger | `api/.htaccess` tidak terunggah, atau `mod_rewrite` mati | unggah ulang (berkas tersembunyi!); minta dukungan Hostinger memastikan `AllowOverride All` |
| Frontend melapor "server menjawab bukan JSON" | permintaan API tersasar ke `index.html` | pastikan baris `RewriteRule ^api/ - [L]` ada di `log_activity/.htaccess` |
| Selalu 401 padahal baru login | header `Authorization` dibuang Apache | `api/.htaccess` belum terunggah — di dalamnya ada aturan yang meneruskannya |
| "Token ini bukan untuk aplikasi ini" | `FIREBASE_PROJECT_ID` berbeda dengan `Frontend/firebase-applet-config.json` | samakan |
| "Sesi login sudah berakhir" padahal baru login | jam server meleset lebih dari 60 detik | laporkan ke dukungan Hostinger |
| Tombol login menjawab `auth/unauthorized-domain` | `arpgrs.com` belum terdaftar di Firebase | Firebase Console → Authentication → Settings → Authorized domains |
| Kamera pemindai tidak pernah menyala | halaman dibuka lewat `http://` | nyalakan Force HTTPS di hPanel |
| "CORS error" di konsol browser | halaman dibuka di `www.arpgrs.com` sementara API dipanggil di alamat lain | pastikan `VITE_API_URL=/log_activity` (jalur, bukan alamat lengkap) |
| 500 dengan pesan umum | lihat `api/app/storage/logs/error-YYYY-MM-DD.log` | kalau folder log kosong, `storage/` belum bisa ditulis |
| "Gagal menulis ke .../registrations.json" | izin folder | set `storage/` ke 755 atau 775 |
| Semua endpoint 500 sejak awal | PHP di server lebih tua dari 8.1 | naikkan versinya di hPanel → PHP Configuration |

Rincian tiap pesan error backend ada di `Backend/README.md` bagian 11.

---

## 10. Berkas yang menopang semua ini

Semuanya sudah ada di repo, tidak perlu dibuat manual:

| Berkas | Gunanya |
|---|---|
| `Frontend/vite.config.ts` | menggeser alamat aset build ke `/log_activity/` |
| `Frontend/.env.production` | dipakai otomatis oleh `npm run build` |
| `Frontend/public/.htaccess` | SPA fallback, kompresi, cache, ikut sendiri ke `dist/` |
| `Backend/.env.production.example` | contoh konfigurasi production, tinggal diisi kredensial |
| `Backend/public/.htaccess` | routing ke `index.php`, penerusan header `Authorization`, penjaga lapis luar |
| `Backend/deploy/app/.htaccess` | penjaga utama folder `app/` |
| `Backend/src/.htaccess`, `routes/.htaccess`, `storage/.htaccess` | penjaga lapis kedua, ikut terunggah bersama foldernya |
