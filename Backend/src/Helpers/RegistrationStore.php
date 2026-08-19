<?php

declare(strict_types=1);

namespace App\Helpers;

/**
 * Antrean pendaftaran yang menunggu persetujuan admin.
 *
 * Kenapa tidak disimpan sebagai baris users
 * -----------------------------------------
 * Ini keputusan yang paling menentukan di seluruh fitur ini, jadi ditulis
 * lengkap di sini.
 *
 * Pilihan yang jelas adalah membuat baris users lebih dulu lalu menandainya
 * "menunggu". Tapi users.role bertipe ENUM('admin','atasan','karyawan'), dan
 * menambah nilai 'pending' ke ENUM ADALAH ALTER TABLE -- schema V1.0 dikunci,
 * jadi jalan itu tertutup. Kolom lain di users semuanya sudah terpakai, dan
 * division_id terikat foreign key ke master_divisions.
 *
 * Yang tersisa adalah menandai lewat nilai khusus pada kolom yang ada, misalnya
 * division_id menunjuk ke divisi sentinel. Itu bisa jalan, tapi harganya dua:
 * divisi yang dipilih pelamar tidak punya tempat disimpan, dan RoleMiddleware
 * harus diajari menolak divisi itu di setiap endpoint. Yang kedua berbahaya --
 * satu endpoint yang lupa memasang pemeriksaannya berarti pelamar yang belum
 * disetujui dapat akses penuh.
 *
 * Karena itu pelamar TIDAK dibuatkan baris users sampai disetujui. Akibatnya:
 *
 *   - RoleMiddleware yang sudah ada menolak mereka di semua endpoint, karena
 *     atribut "user" bernilai null. Tidak ada aturan akses baru yang bisa salah
 *     ditulis, dan endpoint yang ditambahkan besok ikut terlindungi otomatis.
 *   - users.nik yang UNIQUE tidak terpakai oleh pelamar, jadi NIK tidak
 *     "terkunci" oleh orang yang belum tentu disetujui.
 *   - Nama, NIK, dan divisi pilihan pelamar tersimpan utuh di sini.
 *
 * Harga yang dibayar: antrean ini tidak ikut dalam dump database. Kalau folder
 * storage/ hilang, pendaftaran yang menunggu ikut hilang dan orangnya harus
 * mendaftar ulang. Tidak ada data permanen yang lenyap -- yang belum disetujui
 * memang belum jadi apa-apa.
 *
 * Bentuk berkasnya
 * ----------------
 *     {
 *       "pending":  { "<google-uid>": { ...permintaan... } },
 *       "rejected": { "<google-uid>": { ...permintaan, +alasan... } }
 *     }
 *
 * Yang ditolak sengaja disimpan, bukan dihapus. Kalau dihapus, orang yang sama
 * bisa mendaftar ulang berkali-kali dan antrean admin jadi tidak ada habisnya.
 * Admin bisa membuka kembali lewat forget() kalau penolakannya keliru.
 */
final class RegistrationStore
{
    private const PENDING  = 'pending';
    private const REJECTED = 'rejected';

    public function __construct(private JsonStore $store)
    {
    }

    // -----------------------------------------------------------------------
    // Membaca
    // -----------------------------------------------------------------------

    /** @return array<string, mixed>|null */
    public function findPending(string $uid): ?array
    {
        $baris = $this->store->section(self::PENDING)[$uid] ?? null;

        return is_array($baris) ? $baris : null;
    }

    /** @return array<string, mixed>|null */
    public function findRejected(string $uid): ?array
    {
        $baris = $this->store->section(self::REJECTED)[$uid] ?? null;

        return is_array($baris) ? $baris : null;
    }

    /**
     * Daftar yang menunggu, terbaru di atas.
     *
     * @return list<array<string, mixed>>
     */
    public function pending(): array
    {
        return $this->sorted(self::PENDING, 'requested_at');
    }

    /**
     * Daftar yang ditolak, terbaru di atas.
     *
     * @return list<array<string, mixed>>
     */
    public function rejected(): array
    {
        return $this->sorted(self::REJECTED, 'rejected_at');
    }

    public function countPending(): int
    {
        return count($this->store->section(self::PENDING));
    }

    /**
     * Apakah NIK ini sedang dipakai permintaan lain yang masih menunggu?
     *
     * users.nik yang UNIQUE tidak menjaga antrean ini, karena barisnya memang
     * belum ada di tabel users. Tanpa pemeriksaan ini, dua orang bisa sama-sama
     * mengantre dengan NIK yang sama; yang kedua baru ditolak saat admin
     * menyetujuinya, dan admin tidak punya cara tahu itu akan terjadi.
     *
     * Perbandingannya case-insensitive supaya sepadan dengan collation
     * utf8mb4_unicode_ci di kolom users.nik.
     */
    public function nikSedangMengantre(string $nik, ?string $kecualiUid = null): bool
    {
        $nik = $this->normalkanNik($nik);

        foreach ($this->store->section(self::PENDING) as $uid => $baris) {
            if ($kecualiUid !== null && (string) $uid === $kecualiUid) {
                continue;
            }

            if (is_array($baris) && $this->normalkanNik((string) ($baris['nik'] ?? '')) === $nik) {
                return true;
            }
        }

        return false;
    }

    // -----------------------------------------------------------------------
    // Menulis
    // -----------------------------------------------------------------------

    /**
     * Masukkan permintaan baru ke antrean.
     *
     * @param array{uid: string, email: string, name: string, nik: string, divisi: string} $permintaan
     * @return array<string, mixed> baris yang tersimpan
     */
    public function queue(array $permintaan): array
    {
        $baris = [
            'uid'          => $permintaan['uid'],
            'email'        => $permintaan['email'],
            'name'         => $permintaan['name'],
            'nik'          => $permintaan['nik'],
            'divisi'       => $permintaan['divisi'],
            'requested_at' => JsonStore::now(),
        ];

        $antrean = $this->store->section(self::PENDING);

        $antrean[$permintaan['uid']] = $baris;

        $this->store->putSection(self::PENDING, $antrean);

        return $baris;
    }

    /**
     * Keluarkan dari antrean tanpa mencatat penolakan.
     *
     * Dipakai setelah pendaftaran disetujui dan baris users-nya sudah dibuat.
     */
    public function remove(string $uid): void
    {
        $antrean = $this->store->section(self::PENDING);

        if (!array_key_exists($uid, $antrean)) {
            return;
        }

        unset($antrean[$uid]);

        $this->store->putSection(self::PENDING, $antrean);
    }

    /**
     * Pindahkan dari antrean ke daftar tolakan.
     *
     * @param array<string, mixed> $pelaku baris users admin yang menolak
     * @return array<string, mixed>|null   baris tolakan, null kalau tidak ada di antrean
     */
    public function reject(string $uid, array $pelaku, ?string $alasan): ?array
    {
        $permintaan = $this->findPending($uid);

        if ($permintaan === null) {
            return null;
        }

        $tolakan = array_merge($permintaan, [
            'rejected_at'       => JsonStore::now(),
            'rejected_by'       => (string) ($pelaku['id'] ?? ''),
            'rejected_by_email' => (string) ($pelaku['email'] ?? ''),
            'reason'            => $alasan,
        ]);

        $ditolak = $this->store->section(self::REJECTED);

        $ditolak[$uid] = $tolakan;

        // Satu kali tulis untuk dua perubahan: kalau ditulis dua kali dan yang
        // kedua gagal, permintaannya bisa hilang dari antrean tanpa pernah
        // tercatat sebagai ditolak.
        $antrean = $this->store->section(self::PENDING);

        unset($antrean[$uid]);

        $this->store->write(array_merge($this->store->read(), [
            self::PENDING  => $antrean,
            self::REJECTED => $ditolak,
        ]));

        return $tolakan;
    }

    /**
     * Hapus catatan penolakan supaya orangnya boleh mendaftar lagi.
     *
     * @return array<string, mixed>|null baris yang dihapus, null kalau tidak ada
     */
    public function forget(string $uid): ?array
    {
        $tolakan = $this->findRejected($uid);

        if ($tolakan === null) {
            return null;
        }

        $ditolak = $this->store->section(self::REJECTED);

        unset($ditolak[$uid]);

        $this->store->putSection(self::REJECTED, $ditolak);

        return $tolakan;
    }

    // -----------------------------------------------------------------------

    /**
     * @return list<array<string, mixed>>
     */
    private function sorted(string $section, string $kolomWaktu): array
    {
        $baris = array_values(array_filter(
            $this->store->section($section),
            static fn (mixed $b): bool => is_array($b)
        ));

        usort(
            $baris,
            static fn (array $a, array $b): int
                => strcmp((string) ($b[$kolomWaktu] ?? ''), (string) ($a[$kolomWaktu] ?? ''))
        );

        return $baris;
    }

    private function normalkanNik(string $nik): string
    {
        return mb_strtolower(trim($nik));
    }
}
