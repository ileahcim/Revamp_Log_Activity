-- ==========================================================
-- LOG ACTIVITY SYSTEM
-- SEED DATA V1.0
-- ==========================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ==========================================================
-- MASTER DIVISIONS
-- ==========================================================

INSERT INTO master_divisions (name) VALUES
('Mekanik'),
('Instrument'),
('Survey'),
('TPQ'),
('IT & Communications'),
('-');



-- ==========================================================
-- MASTER SUPERVISORS
-- ==========================================================

INSERT INTO master_supervisors (name) VALUES
('Kustono'),
('M. Endin Herdiana'),
('Belum Ditentukan');



-- ==========================================================
-- MASTER CATEGORIES
-- ==========================================================

INSERT INTO master_categories (code, name, type) VALUES

-- PRODUCTIVE
('P1', 'Productive 1', 'Productive'),
('P2', 'Productive 2', 'Productive'),
('P3', 'Productive 3', 'Productive'),
('P4', 'Productive 4', 'Productive'),

-- DELAY
('D1', 'Delay 1', 'Delay'),
('D2', 'Delay 2', 'Delay'),
('D3', 'Delay 3', 'Delay'),
('D4', 'Delay 4', 'Delay'),
('D5', 'Delay 5', 'Delay'),

-- BREAK
('B', 'Break', 'Break');



-- ==========================================================
-- MASTER DELAY CODES
-- ==========================================================

INSERT INTO master_delay_codes
(category_code, code, name)
VALUES

-- D1
('D1', 'SP', 'Sparepart'),
('D1', 'TL', 'Tools'),

-- D2
('D2', 'PR', 'Procurement'),
('D2', 'AC', 'Accessories'),

-- D3
('D3', 'OP', 'Operation'),

-- D4
('D4', 'AP', 'Approval'),

-- D5
('D5', 'WX', 'Weather'),
('D5', 'OT', 'Overtime');

SET FOREIGN_KEY_CHECKS = 1;