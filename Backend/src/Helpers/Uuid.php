<?php

declare(strict_types=1);

namespace App\Helpers;

/**
 * Pembuat UUID v4.
 *
 * Kolom id di tech_logs, audit_logs, dan tech_bug_reports bertipe CHAR(36),
 * jadi id dibuat di sini, bukan diambil dari body request. Frontend lama
 * membuat id sendiri dengan Math.random().toString(36) yang panjangnya cuma 7
 * karakter dan bisa bentrok; id kiriman client sengaja diabaikan.
 *
 * random_bytes() memakai sumber acak sistem operasi dan melempar exception
 * kalau sumber itu tidak tersedia -- lebih baik gagal daripada diam-diam
 * memakai angka acak yang mudah ditebak.
 */
final class Uuid
{
    public static function v4(): string
    {
        $bytes = random_bytes(16);

        // Versi 4 (acak) dan varian RFC 4122.
        $bytes[6] = chr((ord($bytes[6]) & 0x0F) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3F) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
