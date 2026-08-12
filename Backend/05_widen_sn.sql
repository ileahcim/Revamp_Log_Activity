-- ==========================================================
-- LOG ACTIVITY SYSTEM
-- PERLEBAR tech_logs.sn  ->  VARCHAR(100) menjadi TEXT
-- ==========================================================
--
-- Jalankan SETELAH 01_schema.sql. Urutannya terhadap 02/03/04 bebas, dan
-- boleh dijalankan kapan saja -- termasuk setelah data masuk, karena
-- VARCHAR(100) -> TEXT hanya memperlebar dan tidak memotong nilai yang ada.
--
-- Kenapa perlu:
--   Schema V1.0 memberi sn VARCHAR(100) dengan anggapan satu log = satu
--   serial number. Kenyataannya divisi Instrument menginput banyak nomor
--   seri sekaligus dalam satu aktivitas, dipisah baris baru. Ada 7 log lama
--   di Firestore dengan sn sampai 1199 karakter.
--
--   Akibatnya sebelum perubahan ini:
--     - Migration tool MENGHENTIKAN migrasi di ketujuh log itu. sn masuk
--       daftar NO_TRUNCATE (Migration/config/mapping.js), jadi tool menolak
--       memotong diam-diam dan melapor supaya diputuskan manusia.
--     - Backend menolak input baru yang lebih dari 100 karakter dengan 422.
--
--   Pilihan lain -- memotong sn, atau memecah satu log jadi beberapa baris --
--   sama-sama merusak data histori. Memperlebar kolom adalah satu-satunya
--   jalan yang tidak menghilangkan apa pun.
--
-- Catatan schema:
--   Ini SATU-SATUNYA perubahan struktur di luar 01_schema.sql. Perubahan
--   lain tetap harus dilaporkan dulu, jangan bikin ALTER sendiri.
--
-- Dampak:
--   TEXT menampung 65.535 byte (~54x dari nilai terpanjang yang ada), tidak
--   ikut terhitung dalam batas panjang baris InnoDB, dan tetap NULL-able
--   seperti sebelumnya. Kolom ini tidak punya index, jadi tidak ada index
--   yang perlu dipikirkan ulang. Pencarian `?search=` memakai LIKE '%...%'
--   yang memang sudah tidak memakai index sejak V1.0.
--
-- Aman dijalankan berulang kali: kalau kolomnya sudah cukup lebar, tidak ada
-- ALTER yang dijalankan sama sekali (tabel tidak ikut di-rebuild).
-- ==========================================================

-- Patokannya kapasitas kolom, bukan nama tipenya. Kalau dicocokkan dengan
-- DATA_TYPE = 'text', kolom yang kebetulan sudah MEDIUMTEXT akan dianggap
-- "belum diubah" dan ALTER di bawah justru MENYEMPITKANNYA jadi TEXT --
-- artinya skrip pemulihan ini malah memotong data.
SET @panjang_sekarang := (
    SELECT COALESCE(MAX(CHARACTER_MAXIMUM_LENGTH), 0)
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'tech_logs'
       AND COLUMN_NAME  = 'sn'
);

SET @sql := IF(
    @panjang_sekarang >= 65535,
    'SELECT ''tech_logs.sn sudah cukup lebar, tidak ada yang diubah.'' AS info',
    'ALTER TABLE tech_logs MODIFY sn TEXT NULL'
);

PREPARE pernyataan FROM @sql;
EXECUTE pernyataan;
DEALLOCATE PREPARE pernyataan;


-- ==========================================================
-- PEMERIKSAAN HASIL
-- ==========================================================

-- Tipe kolom sekarang (harus 'text', CHARACTER_MAXIMUM_LENGTH 65535):
-- SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
--   FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME   = 'tech_logs'
--    AND COLUMN_NAME  = 'sn';

-- Setelah migrasi, lihat log dengan sn terpanjang:
-- SELECT id, tanggal, display_name, CHAR_LENGTH(sn) AS panjang_sn
--   FROM tech_logs
--  WHERE sn IS NOT NULL
--  ORDER BY panjang_sn DESC
--  LIMIT 10;

-- Berapa log yang tidak akan muat kalau kolomnya dikembalikan ke VARCHAR(100):
-- SELECT COUNT(*) AS log_sn_panjang
--   FROM tech_logs
--  WHERE CHAR_LENGTH(sn) > 100;
