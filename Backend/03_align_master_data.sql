-- ==========================================================
-- LOG ACTIVITY SYSTEM
-- PENYELARASAN MASTER DATA DENGAN FRONTEND
-- ==========================================================
--
-- Jalankan SETELAH 01_schema.sql dan 02_seed.sql.
--
-- Skrip ini hanya mengubah ISI tabel master, tidak menyentuh struktur,
-- jadi Database LOCK V1.0 tetap utuh.
--
-- Alasannya: nama di 02_seed.sql berbeda dengan nama yang selama ini
-- ditampilkan frontend (Frontend/src/types.ts dan BatchUpdateModal.tsx).
-- Tiga di antaranya berbeda ARTI, bukan sekadar gaya penulisan:
--
--     PR  seed: "Procurement"   frontend: "Permit"
--     AC  seed: "Accessories"   frontend: "Access"
--     OT  seed: "Overtime"      frontend: "Other"
--
-- Aman dijalankan berulang kali.
-- ==========================================================


-- ==========================================================
-- MASTER CATEGORIES
-- Kodenya sudah benar, hanya namanya yang diganti agar sama
-- dengan KATEGORI_CODES di Frontend/src/types.ts
-- ==========================================================

UPDATE master_categories SET name = 'Wrench Time (Hands-on)'                      WHERE code = 'P1';
UPDATE master_categories SET name = 'Preparation (Toolbox/JSA/Permit/LOTO/Setup)' WHERE code = 'P2';
UPDATE master_categories SET name = 'Travel/Move'                                 WHERE code = 'P3';
UPDATE master_categories SET name = 'Admin/Reporting'                             WHERE code = 'P4';

UPDATE master_categories SET name = 'Waiting Sparepart/Tools'              WHERE code = 'D1';
UPDATE master_categories SET name = 'Waiting Permit/LOTO/Access'           WHERE code = 'D2';
UPDATE master_categories SET name = 'Waiting Operation/Unit Release'       WHERE code = 'D3';
UPDATE master_categories SET name = 'Waiting Instruction/Approval'         WHERE code = 'D4';
UPDATE master_categories SET name = 'Waiting Coordination/Communication'   WHERE code = 'D5';

UPDATE master_categories SET name = 'Break/Personal' WHERE code = 'B';


-- ==========================================================
-- MASTER DELAY CODES
-- Disamakan dengan DELAY_CODES di Frontend/src/types.ts
-- ==========================================================

UPDATE master_delay_codes SET name = 'Sparepart'         WHERE code = 'SP';
UPDATE master_delay_codes SET name = 'Tools'             WHERE code = 'TL';
UPDATE master_delay_codes SET name = 'Permit'            WHERE code = 'PR';
UPDATE master_delay_codes SET name = 'Operation release' WHERE code = 'OP';
UPDATE master_delay_codes SET name = 'Access'            WHERE code = 'AC';
UPDATE master_delay_codes SET name = 'Approval'          WHERE code = 'AP';
UPDATE master_delay_codes SET name = 'Weather'           WHERE code = 'WX';
UPDATE master_delay_codes SET name = 'Other'             WHERE code = 'OT';

-- Catatan: kolom category_code TIDAK diubah. Pengelompokan kode delay ke
-- kategori D1..D5 di 02_seed.sql tidak punya pembanding di frontend, jadi
-- tidak ada dasar untuk mengubahnya. Bahas dengan atasan kalau perlu.


-- ==========================================================
-- MASTER SUPERVISORS
-- 02_seed.sql baru memuat 3 nama, sedangkan
-- Frontend/src/components/BatchUpdateModal.tsx memakai 6 nama resmi.
-- Empat nama di bawah ini yang belum ada.
-- ==========================================================

INSERT INTO master_supervisors (name) VALUES
('Muhammad Agus M'),
('Puji Slamet Susilo'),
('Sujaryoto'),
('Supono')
ON DUPLICATE KEY UPDATE is_active = TRUE;


-- ==========================================================
-- PEMERIKSAAN HASIL
-- Jalankan untuk memastikan isinya sudah sesuai harapan.
-- ==========================================================

-- SELECT code, name, type FROM master_categories ORDER BY code;
-- SELECT code, category_code, name FROM master_delay_codes ORDER BY code;
-- SELECT id, name, is_active FROM master_supervisors ORDER BY name;
