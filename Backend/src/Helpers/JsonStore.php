<?php

declare(strict_types=1);

namespace App\Helpers;

use RuntimeException;

/**
 * Penyimpan data kecil dalam satu berkas JSON.
 *
 * Kenapa bukan tabel: schema V1.0 dikunci, dan tiga hal yang memakai kelas ini
 * -- antrean pendaftaran, daftar izin NIK, dan daftar super admin -- semuanya
 * membutuhkan kolom yang tidak ada di schema itu. Alasan yang sama sudah
 * ditulis di Helpers/Settings.php untuk sakelar maintenance; kelas ini adalah
 * bentuk umumnya, dipakai bersama oleh penyimpan yang lebih dari satu kunci.
 *
 * Settings sengaja TIDAK diubah untuk memakai kelas ini. Sakelar maintenance
 * adalah satu-satunya jalan mematikan aplikasi saat ada masalah; menyentuhnya
 * demi menghemat dua puluh baris bukan pertukaran yang sepadan.
 *
 * Cara menulisnya
 * ---------------
 * Isi ditulis ke berkas sementara di folder yang sama, lalu di-rename. rename()
 * bersifat atomik di dalam satu filesystem, jadi pembaca tidak akan pernah
 * menemukan berkas setengah tertulis -- pembaca melihat isi lama atau isi baru,
 * tidak ada keadaan di antaranya.
 *
 * Yang TIDAK dijamin: dua penulis yang datang bersamaan. Yang terakhir menang,
 * dan perubahan penulis pertama hilang. Untuk pemakaian di sini -- admin
 * menyetujui pendaftaran, admin menambah NIK -- kejadiannya beberapa kali
 * sehari oleh satu-dua orang, jadi jendela bentroknya praktis nol. Kalau suatu
 * saat lalu lintasnya naik, ganti dengan tabel; jangan tambal dengan flock(),
 * karena sebagian shared hosting memasang filesystem yang tidak menghormatinya.
 */
class JsonStore
{
    public function __construct(private string $path)
    {
    }

    /**
     * Seluruh isi berkas.
     *
     * Berkas yang belum ada, tidak terbaca, atau JSON-nya rusak sama-sama
     * dianggap kosong, bukan error. Untuk antrean pendaftaran artinya
     * pendaftaran yang menunggu tidak terlihat lagi -- merepotkan, tapi jauh
     * lebih ringan daripada seluruh API balas 500 gara-gara satu berkas cacat.
     *
     * @return array<string, mixed>
     */
    public function read(): array
    {
        if (!is_file($this->path)) {
            return [];
        }

        $isi = @file_get_contents($this->path);

        if ($isi === false || trim($isi) === '') {
            return [];
        }

        $data = json_decode($isi, true);

        return is_array($data) ? $data : [];
    }

    /**
     * Ambil satu bagian sebagai array bernama kunci.
     *
     * @return array<string, mixed>
     */
    public function section(string $key): array
    {
        $bagian = $this->read()[$key] ?? [];

        return is_array($bagian) ? $bagian : [];
    }

    /**
     * Ganti satu bagian, sisanya dibiarkan.
     *
     * @param array<string, mixed> $value
     */
    public function putSection(string $key, array $value): void
    {
        $this->write(array_merge($this->read(), [$key => $value]));
    }

    /** @param array<string, mixed> $data */
    public function write(array $data): void
    {
        $folder = dirname($this->path);

        if (!is_dir($folder) && !@mkdir($folder, 0775, true) && !is_dir($folder)) {
            throw new RuntimeException('Folder penyimpanan tidak bisa dibuat: ' . $folder);
        }

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($json === false) {
            throw new RuntimeException('Data tidak bisa diubah menjadi JSON.');
        }

        $sementara = $this->path . '.' . bin2hex(random_bytes(4)) . '.tmp';

        if (@file_put_contents($sementara, $json) === false) {
            @unlink($sementara);

            throw new RuntimeException('Gagal menulis ke ' . $this->path . '. Periksa izin folder storage/.');
        }

        if (!@rename($sementara, $this->path)) {
            @unlink($sementara);

            throw new RuntimeException('Gagal menyimpan ' . $this->path . '. Periksa izin folder storage/.');
        }
    }

    /** Waktu sekarang dalam bentuk ISO 8601, memakai zona waktu aplikasi. */
    public static function now(): string
    {
        return date('c');
    }
}
