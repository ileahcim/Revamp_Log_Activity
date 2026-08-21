<?php

declare(strict_types=1);

namespace App\Helpers;

use App\Config\Env;
use App\Models\TechLogModel;
use App\Models\UserModel;

/**
 * Aturan siapa yang boleh mendaftar (Lapis 1).
 *
 * Sebelum ini, siapa pun yang punya link dan Akun Google bisa mendaftar dengan
 * NIK apa saja. Sekarang NIK yang diisi harus sudah dikenal sistem.
 *
 * Dari mana NIK dianggap "dikenal"
 * --------------------------------
 *   1. tech_logs.nik_snapshot -- 6.713 baris hasil migrasi. Ini sumber
 *      utamanya, dan sengaja BUKAN tabel users: teknisi lama yang belum pernah
 *      login tidak punya baris di users sama sekali, padahal justru merekalah
 *      yang paling mungkin mendaftar.
 *   2. Daftar izin yang diisi admin (NikAllowlist) -- untuk atasan dan admin
 *      baru, yang memang tidak punya jejak di tech_logs mana pun.
 *
 * Satu pesan untuk semua penolakan
 * --------------------------------
 * NIK yang tidak dikenal dan NIK yang sudah dipakai dijawab dengan kalimat yang
 * sama persis. Kalau keduanya dibedakan, formulir pendaftaran -- yang terbuka
 * untuk siapa saja yang punya Akun Google -- berubah menjadi alat untuk menebak
 * NIK karyawan satu per satu: coba sebuah angka, lihat pesannya, simpulkan.
 *
 * Yang tersisa dan diterima sebagai risiko: NIK yang lolos dijawab "menunggu
 * persetujuan" sedangkan yang gagal dijawab 422, jadi keduanya masih bisa
 * dibedakan. Menutup celah itu berarti menerima semua pendaftaran ke antrean
 * termasuk yang NIK-nya asing, dan itu memindahkan pekerjaan menyaring ke
 * admin. Hasil tebakannya pun tidak berguna sendiri: tanpa persetujuan admin,
 * NIK yang benar tetap tidak membuka apa pun.
 *
 * Dua sakelar di .env
 * -------------------
 *   REGISTRATION_REQUIRE_KNOWN_NIK   Lapis 1, pemeriksaan di berkas ini
 *   REGISTRATION_REQUIRE_APPROVAL    Lapis 2, persetujuan admin
 *
 * Keduanya menyala secara default dan bisa dimatikan sendiri-sendiri. Ini jalan
 * keluar darurat: kalau suatu saat aturan ini mengunci orang yang seharusnya
 * masuk, ubah satu baris .env -- tidak perlu menyunting kode atau database.
 * Mematikan Lapis 1 TIDAK mematikan pemeriksaan NIK kembar; yang hilang hanya
 * syarat "harus sudah dikenal".
 */
final class RegistrationPolicy
{
    /**
     * Satu-satunya pesan penolakan NIK pada pendaftaran.
     *
     * Sengaja tidak menyebut NIK-nya sendiri. Menyebutkannya tidak menambah
     * informasi buat pendaftar yang jujur -- dia baru saja mengetiknya -- tapi
     * membuat balasan lebih mudah dipanen kalau ada yang mencoba menebak.
     */
    public const PESAN_NIK_DITOLAK = 'NIK tersebut tidak bisa dipakai mendaftar.'
        . ' Hubungi admin bila ini benar NIK Anda.';

    /** Bentuknya tetap supaya frontend cukup membaca errors.nik. */
    public const FIELD_ERRORS = ['nik' => 'NIK tidak bisa dipakai mendaftar.'];

    public function __construct(
        private UserModel $users,
        private TechLogModel $techLogs,
        private NikAllowlist $allowlist,
        private RegistrationStore $registrations
    ) {
    }

    /** Lapis 1 menyala? */
    public function butuhNikDikenal(): bool
    {
        return Env::bool('REGISTRATION_REQUIRE_KNOWN_NIK', true);
    }

    /** Lapis 2 menyala? */
    public function butuhPersetujuan(): bool
    {
        return Env::bool('REGISTRATION_REQUIRE_APPROVAL', true);
    }

    /**
     * Boleh dipakai mendaftar?
     *
     * Semua alasan penolakan dilebur jadi satu jawaban false, dan pemanggil
     * hanya punya satu pesan untuk dibalas. Itu bukan kemalasan -- itu memang
     * intinya. Lihat catatan kelas di atas.
     *
     * @param string|null $kecualiUid permintaan milik UID ini tidak dihitung
     *                                bentrok. Dipakai saat Lapis 2 dimatikan
     *                                dan orang yang sudah mengantre mendaftar
     *                                ulang -- tanpa ini, NIK-nya sendiri yang
     *                                menghalanginya.
     */
    public function nikBolehDipakai(string $nik, ?string $kecualiUid = null): bool
    {
        $nik = trim($nik);

        if ($nik === '') {
            return false;
        }

        // Akun penampung data lama. NIK-nya memang sudah terpakai di tabel
        // users sehingga tertolak oleh pemeriksaan berikutnya juga, tapi
        // ditolak di sini lebih dulu supaya tidak bergantung pada baris itu
        // tetap ada.
        if ($this->samaDengan($nik, $this->legacyNik())) {
            return false;
        }

        // Sudah dipakai user aktif. users.nik bertipe UNIQUE, jadi ini memang
        // akan ditolak database juga -- tapi ditangkap di sini supaya
        // balasannya tidak membedakan diri dari penolakan lainnya.
        if ($this->users->findByNik($nik) !== null) {
            return false;
        }

        // Sedang dipakai permintaan lain yang masih mengantre. Tabel users
        // belum menjaganya, karena barisnya memang belum dibuat.
        if ($this->registrations->nikSedangMengantre($nik, $kecualiUid)) {
            return false;
        }

        if (!$this->butuhNikDikenal()) {
            return true;
        }

        return $this->nikDikenal($nik);
    }

    /**
     * NIK ini punya jejak di sistem?
     *
     * Syarat Lapis 1, dipisah jadi method sendiri supaya bisa ditanya tanpa
     * ikut menjalankan pemeriksaan lain. Dipakai dua kali dengan maksud yang
     * berbeda: di nikBolehDipakai() untuk MENOLAK pendaftaran, dan di
     * RegistrationController::index() hanya untuk MENANDAI baris antrean.
     *
     * Yang kedua itu justru paling berguna ketika Lapis 1 dimatikan -- saat itu
     * jawaban false tidak lagi menghalangi siapa pun, dan satu-satunya yang
     * bisa menindaklanjutinya adalah admin yang melihat antrean.
     */
    public function nikDikenal(string $nik): bool
    {
        $nik = trim($nik);

        if ($nik === '') {
            return false;
        }

        return $this->allowlist->contains($nik) || $this->techLogs->nikPernahDipakai($nik);
    }

    /**
     * NIK akun penampung data lama.
     *
     * Nilainya cocok dengan 04_legacy_user.sql. Dibaca dari .env supaya tetap
     * benar kalau id penampungnya suatu saat diganti.
     */
    public function legacyNik(): string
    {
        return (string) Env::get('LEGACY_NIK', 'LEGACY-000');
    }

    /** Akun penampung tidak boleh dipakai login oleh siapa pun. */
    public function akunPenampung(string $uid, string $email): bool
    {
        $legacyId = strtolower(trim((string) Env::get('LEGACY_USER_ID', 'legacy-unknown')));

        return strtolower(trim($uid)) === $legacyId
            || str_ends_with(strtolower(trim($email)), '@invalid.local');
    }

    /** Sepadan dengan collation utf8mb4_unicode_ci di database. */
    private function samaDengan(string $a, string $b): bool
    {
        return mb_strtolower(trim($a)) === mb_strtolower(trim($b));
    }
}
