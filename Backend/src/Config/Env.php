<?php

declare(strict_types=1);

namespace App\Config;

use Dotenv\Dotenv;
use RuntimeException;

/**
 * Pembaca konfigurasi .env.
 *
 * Semua nilai konfigurasi diambil lewat kelas ini, tidak pernah di-hardcode
 * di controller atau model.
 */
final class Env
{
    private static bool $loaded = false;

    /** @var array<string, string> */
    private static array $values = [];

    /**
     * Baca file .env dari direktori yang diberikan.
     *
     * File .env sengaja dibuat opsional supaya hosting yang menyetel variabel
     * lewat panel (bukan file) tetap bisa jalan.
     */
    public static function load(string $directory): void
    {
        if (self::$loaded) {
            return;
        }

        if (is_file($directory . '/.env')) {
            Dotenv::createImmutable($directory)->safeLoad();
        }

        // $_SERVER memuat nilai non-skalar seperti "argv" saat dijalankan dari
        // CLI; strval() atas nilai itu memicu warning, jadi disaring dulu.
        // $_ENV didahulukan karena di situlah phpdotenv menaruh hasil bacaan.
        self::$values = array_map('strval', array_merge(
            array_filter($_SERVER, 'is_scalar'),
            array_filter($_ENV, 'is_scalar')
        ));

        self::$loaded = true;
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $value = self::$values[$key] ?? getenv($key);

        if ($value === false || $value === null || $value === '') {
            return $default;
        }

        return trim((string) $value);
    }

    /** Nilai yang wajib ada. Melempar error jelas kalau lupa diisi. */
    public static function required(string $key): string
    {
        $value = self::get($key);

        if ($value === null) {
            throw new RuntimeException(
                "Konfigurasi \"{$key}\" belum diisi di file .env. " .
                'Salin .env.example jadi .env lalu lengkapi nilainya.'
            );
        }

        return $value;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);

        if ($value === null) {
            return $default;
        }

        return in_array(strtolower($value), ['true', '1', 'yes', 'on'], true);
    }

    public static function int(string $key, int $default = 0): int
    {
        $value = self::get($key);

        return $value === null || !is_numeric($value) ? $default : (int) $value;
    }

    /**
     * Nilai yang dipisah koma, contoh CORS_ALLOWED_ORIGINS.
     *
     * @return list<string>
     */
    public static function list(string $key, array $default = []): array
    {
        $value = self::get($key);

        if ($value === null) {
            return $default;
        }

        $parts = array_map('trim', explode(',', $value));

        return array_values(array_filter($parts, static fn (string $p): bool => $p !== ''));
    }

    public static function isProduction(): bool
    {
        return strtolower((string) self::get('APP_ENV', 'production')) === 'production';
    }

    public static function isDebug(): bool
    {
        return self::bool('APP_DEBUG', false);
    }
}
