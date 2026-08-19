<?php

declare(strict_types=1);

namespace App\Helpers;

/**
 * NIK yang diizinkan mendaftar walaupun tidak punya jejak di tech_logs.
 *
 * Masalah yang diselesaikan
 * -------------------------
 * Lapis 1 mensyaratkan NIK sudah dikenal sistem, dan sumber utamanya adalah
 * tech_logs.nik_snapshot -- 6.713 baris hasil migrasi, berisi NIK seluruh
 * teknisi lama. Itu tepat untuk teknisi, tapi menutup pintu untuk orang yang
 * memang tidak pernah punya baris di sana: atasan baru, admin baru, staf yang
 * baru masuk setelah migrasi.
 *
 * Tanpa jalan keluar, satu-satunya cara menambahkan mereka adalah membuka
 * phpMyAdmin di Hostinger -- persis ketergantungan pada akses server yang
 * fitur ini justru dimaksudkan untuk mengurangi.
 *
 * Jadi admin bisa memasukkan NIK ke daftar ini lebih dulu. Yang diberikan hanya
 * izin untuk MENDAFTAR: orangnya tetap mengisi formulir sendiri dengan Akun
 * Google-nya, dan pendaftarannya tetap harus disetujui admin (Lapis 2). Daftar
 * ini tidak melewati satu pun pemeriksaan, hanya menambah sumber NIK yang sah.
 *
 * Bentuk berkasnya
 * ----------------
 *     { "niks": { "<nik huruf kecil>": { nik, note, added_by, added_at } } }
 *
 * Kuncinya NIK yang sudah dikecilkan hurufnya, supaya pencocokannya sepadan
 * dengan collation utf8mb4_unicode_ci pada users.nik dan tech_logs.nik_snapshot
 * -- di sana "AB-01" dan "ab-01" adalah nilai yang sama. Kalau di sini
 * dibedakan, admin bisa mengizinkan "AB-01" lalu heran kenapa pendaftar dengan
 * "ab-01" ditolak.
 *
 * Nilai aslinya tetap disimpan di dalam baris supaya yang tampil di AdminPanel
 * adalah NIK seperti yang admin ketikkan.
 */
final class NikAllowlist
{
    private const SECTION = 'niks';

    public function __construct(private JsonStore $store)
    {
    }

    public function contains(string $nik): bool
    {
        return array_key_exists($this->key($nik), $this->store->section(self::SECTION));
    }

    /**
     * Seluruh daftar, yang terbaru di atas.
     *
     * @return list<array<string, mixed>>
     */
    public function all(): array
    {
        $baris = array_values(array_filter(
            $this->store->section(self::SECTION),
            static fn (mixed $b): bool => is_array($b)
        ));

        usort(
            $baris,
            static fn (array $a, array $b): int
                => strcmp((string) ($b['added_at'] ?? ''), (string) ($a['added_at'] ?? ''))
        );

        return $baris;
    }

    public function count(): int
    {
        return count($this->store->section(self::SECTION));
    }

    /**
     * Tambahkan satu NIK.
     *
     * @param array<string, mixed> $pelaku baris users admin yang menambahkan
     * @return array<string, mixed>        baris yang tersimpan
     */
    public function add(string $nik, ?string $catatan, array $pelaku): array
    {
        $nik = trim($nik);

        $baris = [
            'nik'            => $nik,
            'note'           => $catatan,
            'added_by'       => (string) ($pelaku['id'] ?? ''),
            'added_by_email' => (string) ($pelaku['email'] ?? ''),
            'added_at'       => JsonStore::now(),
        ];

        $daftar = $this->store->section(self::SECTION);

        $daftar[$this->key($nik)] = $baris;

        $this->store->putSection(self::SECTION, $daftar);

        return $baris;
    }

    /**
     * Keluarkan satu NIK dari daftar.
     *
     * Tidak menyentuh user yang terlanjur mendaftar dengan NIK ini dan sudah
     * disetujui. Yang dicabut hanya izin mendaftar untuk yang belum.
     *
     * @return array<string, mixed>|null baris yang dihapus, null kalau tidak ada
     */
    public function remove(string $nik): ?array
    {
        $daftar = $this->store->section(self::SECTION);
        $kunci  = $this->key($nik);

        if (!array_key_exists($kunci, $daftar)) {
            return null;
        }

        $baris = $daftar[$kunci];

        unset($daftar[$kunci]);

        $this->store->putSection(self::SECTION, $daftar);

        return is_array($baris) ? $baris : null;
    }

    private function key(string $nik): string
    {
        return mb_strtolower(trim($nik));
    }
}
