<?php

declare(strict_types=1);

namespace App\Helpers;

use App\Config\Env;
use DateTimeImmutable;
use DateTimeZone;
use Throwable;

/**
 * Penerjemah baris database menjadi bentuk JSON yang dikenal frontend.
 *
 * Nama kolom di database (hasil migrasi) berbeda dengan nama field di
 * Frontend/src/types.ts. Perbedaan itu diselesaikan di sini, satu tempat,
 * supaya komponen React tidak perlu diubah:
 *
 *     users.name           -> name
 *     master_divisions.name-> divisi
 *     tech_logs.display_name -> nama_technician
 *     tech_logs.nik_snapshot -> nik
 *     *.created_at         -> timestamp (audit log & bug report)
 *     *.user_id            -> userId
 *     *.image_base64       -> imageBase64
 */
final class Transformer
{
    /**
     * Baris users + nama divisi hasil JOIN.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function user(array $row): array
    {
        return [
            'id'     => (string) $row['id'],
            'email'  => (string) $row['email'],
            'name'   => (string) $row['name'],
            'role'   => (string) $row['role'],
            'nik'    => (string) $row['nik'],
            'divisi' => (string) ($row['division_name'] ?? '-'),
        ];
    }

    /**
     * Baris tech_logs. Kolom snapshot dipakai apa adanya, tidak diambil dari
     * tabel users, supaya histori lama tidak ikut berubah saat profil user
     * diperbarui.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function techLog(array $row): array
    {
        return [
            'id'                  => (string) $row['id'],
            'created_at'          => self::isoDateTime($row['created_at'] ?? null),
            'tanggal'             => (string) $row['tanggal'],
            'nama_technician'     => (string) $row['display_name'],
            'nik'                 => (string) $row['nik_snapshot'],
            'supervisor'          => (string) $row['supervisor'],
            'shift'               => (string) $row['shift'],
            'wo_notif'            => self::nullableString($row['wo_notif'] ?? null),
            'asset_tag'           => self::nullableString($row['asset_tag'] ?? null),
            'party'               => self::nullableString($row['party'] ?? null),
            'sn'                  => self::nullableString($row['sn'] ?? null),
            'deskripsi_pekerjaan' => (string) $row['deskripsi_pekerjaan'],
            'kategori_code'       => (string) $row['kategori_code'],
            'start_time'          => self::hourMinute($row['start_time'] ?? null),
            'finish_time'         => self::hourMinute($row['finish_time'] ?? null),
            'duration_minutes'    => (int) $row['duration_minutes'],
            'status'              => (string) $row['status'],
            'delay_code'          => self::nullableString($row['delay_code'] ?? null),
            // DECIMAL dibaca PDO sebagai string "12.00"; frontend menunggu angka.
            'output_qty'          => isset($row['output_qty']) ? (float) $row['output_qty'] : null,
            'catatan'             => self::nullableString($row['catatan'] ?? null),
        ];
    }

    /**
     * Baris audit_logs. Tabelnya tidak punya kolom nama, jadi userName diambil
     * lewat JOIN ke users -- artinya yang tampil adalah nama user saat ini,
     * bukan nama saat aksi dulu dilakukan.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function auditLog(array $row): array
    {
        return [
            'id'        => (string) $row['id'],
            'timestamp' => self::isoDateTime($row['created_at'] ?? null),
            'userId'    => (string) $row['user_id'],
            'userName'  => (string) ($row['user_name'] ?? '-'),
            'action'    => (string) $row['action'],
            // Tidak ada di AuditLogItem pada auth.ts, tapi kolomnya ada di
            // database. Dikirim supaya keterangan panjang punya tempat sendiri
            // tanpa memaksa action melebihi VARCHAR(100).
            'description' => self::nullableString($row['description'] ?? null),
        ];
    }

    /**
     * Baris tech_bug_reports. userName dan role juga hasil JOIN karena tabelnya
     * tidak menyimpan keduanya.
     *
     * Gambar hanya disertakan kalau kolomnya memang ikut di-SELECT; endpoint
     * daftar sengaja tidak mengambilnya karena ukurannya bisa ratusan KB.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function bugReport(array $row, bool $withImage = false): array
    {
        $report = [
            'id'          => (string) $row['id'],
            'userId'      => (string) $row['user_id'],
            'userName'    => (string) ($row['user_name'] ?? '-'),
            'role'        => (string) ($row['user_role'] ?? 'karyawan'),
            'title'       => (string) $row['title'],
            'description' => (string) $row['description'],
            'status'      => (string) $row['status'],
            'timestamp'   => self::isoDateTime($row['created_at'] ?? null),
            // Penanda ada/tidaknya lampiran, supaya daftar bisa menampilkan ikon
            // klip tanpa ikut mengunduh gambarnya. MySQL mengembalikan 1/0.
            'has_image'   => (bool) ($row['has_image'] ?? false),
        ];

        if ($withImage) {
            $report['imageBase64'] = self::nullableString($row['image_base64'] ?? null);
        }

        return $report;
    }

    // -----------------------------------------------------------------------
    // Konversi nilai
    // -----------------------------------------------------------------------

    /**
     * DATETIME MySQL "2026-07-01 08:00:00" -> ISO "2026-07-01T08:00:00+07:00".
     *
     * Frontend memanggil new Date() pada nilai ini, jadi offset zona waktunya
     * harus ikut. Tanpa offset, browser menganggapnya waktu lokal browser.
     */
    public static function isoDateTime(mixed $value): ?string
    {
        if ($value === null || $value === '' || $value === '0000-00-00 00:00:00') {
            return null;
        }

        try {
            $zone = new DateTimeZone((string) Env::get('DB_TIME_ZONE', '+07:00'));

            return (new DateTimeImmutable((string) $value, $zone))->format('c');
        } catch (Throwable) {
            return null;
        }
    }

    /** TIME MySQL "08:00:00" -> "08:00", sesuai input type="time" di frontend. */
    public static function hourMinute(mixed $value): string
    {
        $value = (string) $value;

        return preg_match('/^(\d{2}:\d{2})/', $value, $m) === 1 ? $m[1] : $value;
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = (string) $value;

        return $value === '' ? null : $value;
    }
}
