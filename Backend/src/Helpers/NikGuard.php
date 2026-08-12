<?php

declare(strict_types=1);

namespace App\Helpers;

use App\Models\UserModel;
use PDOException;

/**
 * Penjaga keunikan users.nik.
 *
 * `users.nik` bertipe NOT NULL UNIQUE, jadi database sebenarnya sudah menolak
 * NIK kembar sendiri. Masalahnya penolakan itu berbentuk SQLSTATE 23000 yang,
 * kalau dibiarkan naik ke error handler global, sampai ke user sebagai 500
 * "Terjadi kesalahan pada server" — tidak memberi tahu apa yang salah, dan
 * tidak memberi tahu apa yang harus diperbaiki.
 *
 * Karena itu urutannya dua lapis:
 *
 *   1. PERIKSA DULU sebelum insert/update, lalu balas 422 dengan pesan yang
 *      menyebut NIK-nya. Ini jalur yang hampir selalu terpakai.
 *   2. TETAP TANGKAP pelanggaran UNIQUE dari database sebagai jaring pengaman.
 *      Dua permintaan yang datang hampir bersamaan bisa sama-sama lolos
 *      pemeriksaan nomor 1 sebelum salah satunya sempat menulis; yang kalah
 *      harus tetap mendapat pesan yang sama, bukan 500.
 *
 * Siapa yang boleh tahu pemilik NIK-nya
 * -------------------------------------
 * Nama pemilik hanya disebut untuk admin, dan hanya di field `message`.
 * Untuk pendaftaran, pesannya berhenti di "sudah digunakan oleh user lain".
 * Alasannya: form pendaftaran terbuka untuk siapa pun yang punya Akun Google,
 * jadi kalau nama pemiliknya ikut dibalas, endpoint itu berubah menjadi cara
 * memetakan NIK ke nama karyawan satu per satu.
 *
 * FIELD_ERRORS sengaja tidak pernah memuat nama siapa pun, supaya frontend
 * bisa menampilkannya di bawah input tanpa perlu tahu siapa yang memanggil.
 */
final class NikGuard
{
    /**
     * Error per field. Bentuknya tetap supaya frontend cukup membaca
     * `errors.nik` tanpa memeriksa siapa pemanggilnya.
     */
    public const FIELD_ERRORS = ['nik' => 'NIK sudah digunakan user lain.'];

    /** Kode driver MySQL untuk pelanggaran indeks UNIQUE. */
    private const DUPLICATE_ENTRY = 1062;

    /**
     * Apakah NIK ini sudah dipakai orang lain?
     *
     * @param string|null $exceptId    id user yang sedang diubah; NIK miliknya
     *                                 sendiri tidak dihitung bentrok
     * @param bool        $revealOwner true hanya untuk admin — lihat catatan
     *                                 kelas di atas
     * @return string|null             pesan siap pakai, atau null kalau aman
     */
    public static function conflict(
        UserModel $users,
        string $nik,
        ?string $exceptId = null,
        bool $revealOwner = false
    ): ?string {
        return self::fromOwner($users->findByNik($nik, $exceptId), $nik, $revealOwner);
    }

    /**
     * Bagian yang menentukan APA yang boleh diberitahukan, dipisah dari
     * pencariannya supaya bisa diuji tanpa database.
     *
     * @param array<string, mixed>|null $owner baris pemilik NIK, null = aman
     */
    public static function fromOwner(?array $owner, string $nik, bool $revealOwner = false): ?string
    {
        if ($owner === null) {
            return null;
        }

        return self::message($nik, $revealOwner ? (string) ($owner['name'] ?? '') : null);
    }

    /**
     * Susun pesan penolakan.
     *
     * @param string|null $ownerName null berarti pemiliknya tidak disebut
     */
    public static function message(?string $nik, ?string $ownerName = null): string
    {
        $nik = $nik === null ? '' : trim($nik);

        // Jaring pengaman dari database tidak selalu tahu nilai NIK-nya.
        $subjek = $nik === '' ? 'NIK tersebut' : sprintf('NIK %s', $nik);

        if ($ownerName !== null && trim($ownerName) !== '') {
            return sprintf('%s sudah digunakan oleh %s.', $subjek, trim($ownerName));
        }

        return sprintf(
            '%s sudah digunakan oleh user lain. Hubungi admin bila ini benar NIK Anda.',
            $subjek
        );
    }

    /**
     * Benarkah error ini pelanggaran indeks UNIQUE?
     *
     * SQLSTATE 23000 saja tidak cukup. Kode itu juga dipakai pelanggaran
     * FOREIGN KEY (1452) — misalnya division_id yang divisinya baru saja
     * dihapus. Kalau keduanya disamakan, kegagalan divisi akan dilaporkan
     * sebagai "NIK sudah dipakai", dan orangnya akan mengganti NIK yang
     * sebenarnya tidak bermasalah.
     */
    public static function isDuplicateEntry(PDOException $e): bool
    {
        if ((string) $e->getCode() !== '23000') {
            return false;
        }

        $driverCode = $e->errorInfo[1] ?? null;

        if ($driverCode !== null) {
            return (int) $driverCode === self::DUPLICATE_ENTRY;
        }

        return str_contains($e->getMessage(), 'Duplicate entry');
    }

    /**
     * Kolom mana yang bentrok: 'nik', 'email', atau null kalau bukan keduanya
     * (indeks lain, atau error yang sama sekali bukan duplikat).
     *
     * Nama indeksnya ikut nama kolom karena keduanya dideklarasikan inline
     * sebagai UNIQUE di 01_schema.sql. Penulisannya berbeda antar server:
     * MySQL 8 menyebut "users.nik", MariaDB dan MySQL 5.7 cukup "nik" — jadi
     * keduanya sama-sama dicocokkan.
     */
    public static function duplicateColumn(PDOException $e): ?string
    {
        if (!self::isDuplicateEntry($e)) {
            return null;
        }

        $pesan = strtolower($e->getMessage());

        foreach (['nik', 'email'] as $kolom) {
            if (str_contains($pesan, "key '" . $kolom . "'") || str_contains($pesan, '.' . $kolom . "'")) {
                return $kolom;
            }
        }

        return null;
    }
}
