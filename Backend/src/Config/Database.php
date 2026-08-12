<?php

declare(strict_types=1);

namespace App\Config;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Koneksi PDO ke MariaDB.
 *
 * Satu koneksi dipakai bersama selama satu request. PHP menutupnya sendiri
 * saat request selesai, jadi tidak perlu disconnect manual.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $charset = (string) Env::get('DB_CHARSET', 'utf8mb4');

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            Env::required('DB_HOST'),
            Env::int('DB_PORT', 3306),
            Env::required('DB_NAME'),
            $charset
        );

        try {
            $pdo = new PDO(
                $dsn,
                Env::required('DB_USER'),
                (string) Env::get('DB_PASSWORD', ''),
                [
                    // Semua kegagalan query jadi exception, bukan return false
                    // yang gampang terlewat.
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    // Prepared statement asli di sisi MySQL, bukan emulasi
                    // string di sisi PHP.
                    PDO::ATTR_EMULATE_PREPARES   => false,
                    PDO::ATTR_STRINGIFY_FETCHES  => false,
                ]
            );
        } catch (PDOException $e) {
            // Pesan asli PDO memuat host dan user; jangan diteruskan ke atas.
            throw new RuntimeException(
                'Gagal terhubung ke database. Periksa DB_HOST, DB_NAME, DB_USER, dan DB_PASSWORD di .env.',
                0,
                $e
            );
        }

        self::applyTimeZone($pdo);

        return self::$pdo = $pdo;
    }

    /**
     * Samakan zona waktu sesi MySQL dengan zona waktu aplikasi.
     *
     * Tanpa ini, kolom TIMESTAMP dibaca memakai zona waktu server hosting yang
     * biasanya UTC, sehingga jam pada log bergeser 7 jam.
     */
    private static function applyTimeZone(PDO $pdo): void
    {
        $offset = (string) Env::get('DB_TIME_ZONE', '+07:00');

        try {
            $statement = $pdo->prepare('SET time_zone = ?');
            $statement->execute([$offset]);
        } catch (PDOException $e) {
            throw new RuntimeException(
                "Gagal menyetel zona waktu MySQL ke \"{$offset}\". " .
                'Isi DB_TIME_ZONE dengan offset angka seperti +07:00, bukan nama zona.',
                0,
                $e
            );
        }
    }

    /** Dipakai unit test untuk menyuntikkan koneksi lain. */
    public static function swap(?PDO $pdo): void
    {
        self::$pdo = $pdo;
    }
}
