<?php

declare(strict_types=1);

namespace App\Helpers;

use RuntimeException;

/**
 * Penyimpan pengaturan aplikasi dalam satu berkas JSON.
 *
 * Kenapa bukan tabel: schema V1.0 dikunci dan tidak punya tabel settings, dan
 * satu-satunya pengaturan yang dipakai sekarang hanyalah sakelar maintenance --
 * satu baris boolean tidak sepadan dengan menambah tabel.
 *
 * Berkasnya ditulis lewat berkas sementara lalu di-rename. rename() bersifat
 * atomik di filesystem yang sama, jadi pembaca tidak pernah menemukan berkas
 * setengah tertulis walaupun dua admin menekan sakelar bersamaan.
 */
final class Settings
{
    private const DEFAULTS = [
        'maintenance' => false,
    ];

    public function __construct(private string $path)
    {
    }

    /** @return array<string, mixed> */
    public function all(): array
    {
        if (!is_file($this->path)) {
            return self::DEFAULTS;
        }

        $isi = @file_get_contents($this->path);

        if ($isi === false) {
            return self::DEFAULTS;
        }

        $data = json_decode($isi, true);

        // Berkas rusak diperlakukan sebagai "belum diatur", bukan sebagai error.
        // Aplikasi yang terkunci maintenance gara-gara JSON cacat jauh lebih
        // merepotkan daripada satu sakelar yang perlu dinyalakan ulang.
        return is_array($data) ? array_merge(self::DEFAULTS, $data) : self::DEFAULTS;
    }

    public function maintenance(): bool
    {
        return (bool) ($this->all()['maintenance'] ?? false);
    }

    public function setMaintenance(bool $active): void
    {
        $this->write(array_merge($this->all(), ['maintenance' => $active]));
    }

    /** @param array<string, mixed> $data */
    private function write(array $data): void
    {
        $folder = dirname($this->path);

        if (!is_dir($folder) && !@mkdir($folder, 0775, true) && !is_dir($folder)) {
            throw new RuntimeException('Folder penyimpanan pengaturan tidak bisa dibuat.');
        }

        $sementara = $this->path . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $json      = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        if ($json === false || @file_put_contents($sementara, $json) === false) {
            @unlink($sementara);

            throw new RuntimeException('Pengaturan gagal disimpan.');
        }

        if (!@rename($sementara, $this->path)) {
            @unlink($sementara);

            throw new RuntimeException('Pengaturan gagal disimpan.');
        }
    }
}
