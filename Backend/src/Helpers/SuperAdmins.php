<?php

declare(strict_types=1);

namespace App\Helpers;

use App\Config\Env;

/**
 * Siapa saja yang berstatus super admin.
 *
 * Masalah yang diselesaikan
 * -------------------------
 * Sebelumnya super admin adalah satu alamat email di .env. Artinya begitu
 * pemilik alamat itu pergi, tidak ada seorang pun yang bisa menjadi super admin
 * tanpa membuka file manager di Hostinger dan menyunting .env. Untuk sistem
 * yang ditinggalkan pembuatnya, itu bukan keadaan yang bisa dibiarkan.
 *
 * Sekarang statusnya berasal dari dua sumber yang digabung:
 *
 *   1. AKAR, dari .env (SUPER_ADMIN_EMAILS, dipisah koma). Tidak bisa
 *      diturunkan lewat aplikasi, apa pun yang terjadi. Ini jaring pengaman
 *      terakhir: kalau berkas super-admins.json rusak, terhapus, atau seseorang
 *      salah menurunkan semua orang, alamat di .env tetap bisa masuk.
 *
 *   2. DIANGKAT, dari storage/super-admins.json. Super admin bisa mengangkat
 *      dan menurunkan yang di sini lewat AdminPanel, tanpa akses server.
 *
 * Yang berlaku adalah gabungan keduanya.
 *
 * SUPER_ADMIN_EMAIL (bentuk tunggal, nama lama) tetap dibaca dan diperlakukan
 * sebagai akar juga. Jadi .env yang sudah terpasang di server tidak perlu
 * diubah apa pun supaya versi ini jalan.
 *
 * Hubungannya dengan users.role
 * -----------------------------
 * Status super admin TIDAK disimpan di users.role, dan itu disengaja. role
 * bertipe ENUM('admin','atasan','karyawan') yang dikunci schema V1.0, dan
 * seorang admin biasa bisa mengubah role orang lain. Kalau status super admin
 * ikut di sana, admin biasa bisa menurunkan super admin -- persis yang harus
 * dicegah.
 *
 * Karena statusnya melekat pada email, AuthController::sync() menaikkan role
 * super admin menjadi 'admin' setiap kali dia login. Jadi walaupun rolenya
 * sempat diturunkan orang lain, dia naik lagi begitu masuk.
 */
final class SuperAdmins
{
    private const SECTION = 'emails';

    public function __construct(private JsonStore $store)
    {
    }

    /**
     * Alamat dari .env. Tidak bisa diturunkan lewat aplikasi.
     *
     * @return list<string> huruf kecil semua, tanpa duplikat
     */
    public function rootEmails(): array
    {
        $daftar = Env::list('SUPER_ADMIN_EMAILS');

        // Nama lama, bentuk tunggal. Dibaca supaya .env yang sudah terpasang di
        // server tetap jalan tanpa disunting.
        $tunggal = (string) Env::get('SUPER_ADMIN_EMAIL', '');

        if (trim($tunggal) !== '') {
            $daftar[] = $tunggal;
        }

        return $this->rapikan($daftar);
    }

    /**
     * Alamat yang diangkat lewat AdminPanel.
     *
     * @return list<string>
     */
    public function promotedEmails(): array
    {
        return $this->rapikan(array_keys($this->store->section(self::SECTION)));
    }

    /**
     * Gabungan keduanya, terurut abjad.
     *
     * @return list<string>
     */
    public function all(): array
    {
        $gabungan = array_merge($this->rootEmails(), $this->promotedEmails());

        sort($gabungan);

        return $this->rapikan($gabungan);
    }

    /**
     * Daftar lengkap beserta asal-usulnya, untuk ditampilkan di AdminPanel.
     *
     * @return list<array<string, mixed>>
     */
    public function details(): array
    {
        $diangkat = $this->store->section(self::SECTION);
        $akar     = $this->rootEmails();
        $hasil    = [];

        foreach ($this->all() as $email) {
            $baris = $diangkat[$email] ?? [];
            $baris = is_array($baris) ? $baris : [];

            $isAkar = in_array($email, $akar, true);

            $hasil[] = [
                'email'      => $email,
                // Akar didahulukan: alamat yang ada di .env DAN pernah diangkat
                // lewat aplikasi tetap tidak bisa diturunkan.
                'source'     => $isAkar ? 'env' : 'app',
                'removable'  => !$isAkar,
                'promoted_by_email' => $isAkar ? null : ($baris['promoted_by_email'] ?? null),
                'promoted_at'       => $isAkar ? null : ($baris['promoted_at'] ?? null),
            ];
        }

        return $hasil;
    }

    public function isSuperAdmin(?string $email): bool
    {
        if ($email === null || trim($email) === '') {
            return false;
        }

        return in_array($this->kunci($email), $this->all(), true);
    }

    /** Berasal dari .env, jadi kebal terhadap penurunan lewat aplikasi. */
    public function isRoot(string $email): bool
    {
        return in_array($this->kunci($email), $this->rootEmails(), true);
    }

    public function count(): int
    {
        return count($this->all());
    }

    /**
     * Angkat satu alamat menjadi super admin.
     *
     * Pemeriksaan "siapa yang boleh mengangkat" ada di SuperAdminMiddleware,
     * bukan di sini.
     *
     * @param array<string, mixed> $pelaku baris users super admin yang mengangkat
     */
    public function promote(string $email, array $pelaku): void
    {
        $daftar = $this->store->section(self::SECTION);

        $daftar[$this->kunci($email)] = [
            'email'             => $this->kunci($email),
            'promoted_by'       => (string) ($pelaku['id'] ?? ''),
            'promoted_by_email' => (string) ($pelaku['email'] ?? ''),
            'promoted_at'       => JsonStore::now(),
        ];

        $this->store->putSection(self::SECTION, $daftar);
    }

    /**
     * Turunkan satu alamat.
     *
     * Hanya menyentuh daftar yang diangkat lewat aplikasi. Alamat dari .env
     * tidak akan pernah hilang dari sini karena memang tidak pernah ada di
     * sini -- pemanggil wajib memeriksa isRoot() lebih dulu dan menolaknya
     * dengan pesan yang jelas, supaya penurunan tidak terlihat berhasil padahal
     * orangnya tetap super admin.
     *
     * @return bool false kalau alamatnya memang tidak ada di daftar
     */
    public function demote(string $email): bool
    {
        $daftar = $this->store->section(self::SECTION);
        $kunci  = $this->kunci($email);

        if (!array_key_exists($kunci, $daftar)) {
            return false;
        }

        unset($daftar[$kunci]);

        $this->store->putSection(self::SECTION, $daftar);

        return true;
    }

    // -----------------------------------------------------------------------

    private function kunci(string $email): string
    {
        return strtolower(trim($email));
    }

    /**
     * @param list<string> $daftar
     * @return list<string>
     */
    private function rapikan(array $daftar): array
    {
        $bersih = [];

        foreach ($daftar as $email) {
            $email = $this->kunci((string) $email);

            if ($email !== '' && !in_array($email, $bersih, true)) {
                $bersih[] = $email;
            }
        }

        return $bersih;
    }
}
