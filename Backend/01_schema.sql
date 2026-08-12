-- DROP TABLE IF EXISTS tech_bug_reports;
-- DROP TABLE IF EXISTS audit_logs;
-- DROP TABLE IF EXISTS tech_logs;
-- DROP TABLE IF EXISTS users;
-- DROP TABLE IF EXISTS master_delay_codes;
-- DROP TABLE IF EXISTS master_categories;
-- DROP TABLE IF EXISTS master_supervisors;
-- DROP TABLE IF EXISTS master_divisions;


-- ==========================================================
-- LOG ACTIVITY SYSTEM
-- DATABASE SCHEMA V1.0
-- MariaDB / MySQL
-- ==========================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ==========================================================
-- MASTER DIVISIONS
-- ==========================================================

CREATE TABLE master_divisions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
        COMMENT 'Nama divisi',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
        COMMENT 'Status aktif',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- MASTER SUPERVISORS
-- ==========================================================

CREATE TABLE master_supervisors (
    id INT AUTO_INCREMENT PRIMARY KEY,

    name VARCHAR(150) NOT NULL UNIQUE
        COMMENT 'Nama supervisor',

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- MASTER CATEGORIES
-- ==========================================================

CREATE TABLE master_categories (

    id INT AUTO_INCREMENT PRIMARY KEY,

    code VARCHAR(5) NOT NULL UNIQUE
        COMMENT 'P1,D1,B,dll',

    name VARCHAR(150) NOT NULL
        COMMENT 'Nama kategori',

    type ENUM(
        'Productive',
        'Delay',
        'Break'
    ) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- MASTER DELAY CODES
-- ==========================================================

CREATE TABLE master_delay_codes (

    id INT AUTO_INCREMENT PRIMARY KEY,

    category_code VARCHAR(5) NOT NULL
        COMMENT 'D1,D2,D3...',

    code VARCHAR(5) NOT NULL UNIQUE
        COMMENT 'SP,TL,PR...',

    name VARCHAR(150) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- USERS
-- ==========================================================

CREATE TABLE users (

    id VARCHAR(128) PRIMARY KEY
        COMMENT 'Google UID',

    email VARCHAR(255) NOT NULL UNIQUE,

    nik VARCHAR(50) NOT NULL UNIQUE,

    name VARCHAR(150) NOT NULL,

    division_id INT NOT NULL,

    role ENUM(
        'admin',
        'atasan',
        'karyawan'
    ) NOT NULL DEFAULT 'karyawan',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_division
        FOREIGN KEY (division_id)
        REFERENCES master_divisions(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT

) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- INDEX USERS
-- ==========================================================

CREATE INDEX idx_users_email
ON users(email);

CREATE INDEX idx_users_nik
ON users(nik);


-- ==========================================================
-- TECH LOGS
-- ==========================================================

CREATE TABLE tech_logs (

    id CHAR(36) PRIMARY KEY
        COMMENT 'UUID',

    user_id VARCHAR(128) NOT NULL
        COMMENT 'Google UID',

    tanggal DATE NOT NULL,

    display_name VARCHAR(150) NOT NULL
        COMMENT 'Snapshot nama saat log dibuat',

    nik_snapshot VARCHAR(50) NOT NULL
        COMMENT 'Snapshot NIK saat log dibuat',

    supervisor VARCHAR(150) NOT NULL
        COMMENT 'Snapshot supervisor',

    shift ENUM(
        'Pagi',
        'Siang',
        'Malam'
    ) NOT NULL,

    wo_notif VARCHAR(100),

    asset_tag VARCHAR(100),

    party VARCHAR(100),

    -- DIPERLEBAR jadi TEXT oleh 05_widen_sn.sql (log lama memuat banyak
    -- serial number sekaligus, terpanjang 1199 karakter). Baris di bawah
    -- sengaja dibiarkan apa adanya supaya berkas ini tetap menjadi catatan
    -- schema V1.0 yang asli.
    sn VARCHAR(100),

    deskripsi_pekerjaan TEXT NOT NULL,

    kategori_code VARCHAR(5) NOT NULL
        COMMENT 'P1,P2,D1,B,dll',

    start_time TIME NOT NULL,

    finish_time TIME NOT NULL,

    duration_minutes INT NOT NULL,

    status ENUM(
        'Done',
        'Ongoing',
        'Hold',
        '-'
    ) NOT NULL,

    delay_code VARCHAR(5)
        COMMENT 'SP,TL,PR,dll',

    output_qty DECIMAL(10,2),

    catatan TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_logs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT

) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- AUDIT LOGS
-- ==========================================================

CREATE TABLE audit_logs (

    id CHAR(36) PRIMARY KEY,

    user_id VARCHAR(128) NOT NULL,

    action VARCHAR(100) NOT NULL,

    description TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_audit_user
        FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT

) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- BUG REPORTS
-- ==========================================================

CREATE TABLE tech_bug_reports (

    id CHAR(36) PRIMARY KEY,

    user_id VARCHAR(128) NOT NULL,

    title VARCHAR(255) NOT NULL,

    description TEXT NOT NULL,

    image_base64 LONGTEXT,

    status ENUM(
        'Open',
        'In Progress',
        'Resolved'
    ) DEFAULT 'Open',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_bug_user
        FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT

) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;



-- ==========================================================
-- INDEX
-- ==========================================================

CREATE INDEX idx_logs_user
ON tech_logs(user_id);

CREATE INDEX idx_logs_tanggal
ON tech_logs(tanggal);

CREATE INDEX idx_logs_user_tanggal
ON tech_logs(user_id,tanggal);

CREATE INDEX idx_logs_kategori
ON tech_logs(kategori_code);

CREATE INDEX idx_logs_supervisor
ON tech_logs(supervisor);

CREATE INDEX idx_logs_status
ON tech_logs(status);

CREATE INDEX idx_audit_user
ON audit_logs(user_id);

CREATE INDEX idx_bug_user
ON tech_bug_reports(user_id);



SET FOREIGN_KEY_CHECKS = 1;