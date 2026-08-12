-- ==========================================================
-- LOG ACTIVITY SYSTEM
-- USER PENAMPUNG UNTUK DATA LAMA
-- ==========================================================
--
-- Jalankan SETELAH 01_schema.sql dan 02_seed.sql, SEBELUM migrasi data.
--
-- Kenapa perlu:
--   tech_logs.user_id, audit_logs.user_id, dan tech_bug_reports.user_id
--   semuanya NOT NULL dengan FOREIGN KEY ke users(id). Sementara itu,
--   collection tech_logs di Firestore tidak pernah menyimpan userId --
--   hanya nik dan nama_technician.
--
--   Tool migrasi mencocokkan NIK lalu nama untuk menemukan user aslinya.
--   Sebagian log lama tidak akan ketemu (NIK salah ketik, teknisi sudah
--   keluar, nama ditulis berbeda). Baris-baris itu diarahkan ke user
--   penampung ini agar tidak hilang.
--
--   Nama dan NIK asli tetap tersimpan di kolom snapshot tech_logs
--   (display_name, nik_snapshot, supervisor), jadi tampilan histori di
--   frontend sama sekali tidak berubah.
--
-- Aman dijalankan berulang kali.
-- ==========================================================

-- Divisi '-' sudah ada di 02_seed.sql. Baris ini hanya jaga-jaga kalau
-- seed belum sempat dijalankan.
INSERT INTO master_divisions (name) VALUES ('-')
ON DUPLICATE KEY UPDATE is_active = TRUE;

SET @division_id = (SELECT id FROM master_divisions WHERE name = '-' LIMIT 1);

INSERT INTO users (id, email, nik, name, division_id, role) VALUES (
    'legacy-unknown',
    'legacy-unknown@invalid.local',
    'LEGACY-000',
    'Data Lama (Tidak Teridentifikasi)',
    @division_id,
    'karyawan'
)
ON DUPLICATE KEY UPDATE name = 'Data Lama (Tidak Teridentifikasi)';

-- Nilai id di atas harus sama dengan LEGACY_USER_ID di Backend/.env.
--
-- Email sengaja memakai domain .invalid (dicadangkan oleh RFC 2606 dan tidak
-- bisa didaftarkan siapa pun), supaya tidak mungkin bertabrakan dengan email
-- Google asli dan tidak ada yang bisa login sebagai user ini.


-- ==========================================================
-- PEMERIKSAAN HASIL
-- ==========================================================

-- SELECT u.id, u.name, u.nik, d.name AS divisi
--   FROM users u
--   JOIN master_divisions d ON d.id = u.division_id
--  WHERE u.id = 'legacy-unknown';

-- Setelah migrasi, hitung berapa log yang mendarat di penampung:
-- SELECT COUNT(*) AS log_belum_teridentifikasi
--   FROM tech_logs
--  WHERE user_id = 'legacy-unknown';
