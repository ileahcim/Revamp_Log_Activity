<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Env;
use App\Helpers\ApiResponse;
use App\Helpers\NikGuard;
use App\Helpers\Pagination;
use App\Helpers\SuperAdmins;
use App\Helpers\Transformer;
use App\Helpers\Validator;
use App\Models\MasterModel;
use App\Models\UserModel;
use PDOException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Endpoint untuk tabel users.
 *
 * Catatan hak akses: daftar dan detail user boleh dibaca semua user yang sudah
 * terdaftar, bukan admin saja. Ini mengikuti perilaku yang sudah berjalan --
 * App.tsx memanggil fetchUsersFirestore() untuk setiap user yang login lalu
 * meneruskan hasilnya ke Dashboard, ActivityList, dan komponen lain. Yang
 * dibatasi khusus admin adalah ubah dan hapus.
 */
final class UserController
{
    private const ROLES = ['admin', 'atasan', 'karyawan'];

    public function __construct(
        private UserModel $users,
        private MasterModel $master,
        private SuperAdmins $superAdmins
    ) {
    }

    /**
     * GET /api/users
     *
     * Query string yang didukung:
     *   search   cari di nama, email, atau NIK
     *   role     admin | atasan | karyawan
     *   division nama divisi, contoh "Mekanik"
     *   limit    default API_DEFAULT_LIMIT, dibatasi API_MAX_LIMIT
     *   offset   lompati sekian baris pertama
     */
    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $query = $request->getQueryParams();

        $filters = [
            'search'   => $this->trimmed($query['search'] ?? null),
            'role'     => $this->oneOf($query['role'] ?? null, ['admin', 'atasan', 'karyawan']),
            'division' => $this->trimmed($query['division'] ?? null),
        ];

        $limit  = Pagination::limit($query['limit'] ?? null);
        $offset = Pagination::offset($query['offset'] ?? null);

        $rows  = $this->users->all($filters, $limit, $offset);
        $total = $this->users->countAll($filters);

        return ApiResponse::success(
            $response,
            array_map([Transformer::class, 'user'], $rows),
            null,
            200,
            Pagination::meta($total, $limit, $offset, count($rows))
        );
    }

    /** GET /api/users/{id} */
    public function show(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $user = $this->users->findById((string) ($args['id'] ?? ''));

        if ($user === null) {
            return ApiResponse::error($response, 'User tidak ditemukan.', 404);
        }

        return ApiResponse::success($response, Transformer::user($user));
    }

    /**
     * PUT /api/users/{id} — khusus admin.
     *
     * Body boleh berisi sebagian saja: { name?, nik?, divisi?, role? }. Kolom
     * yang tidak dikirim tidak disentuh. Bentuk ini mengikuti AdminPanel, yang
     * memakai dua tombol berbeda -- satu menyimpan nama/NIK/divisi, satu lagi
     * hanya mengganti role -- persis seperti setDoc(..., { merge: true }).
     *
     * email dan id tidak bisa diubah. Keduanya berasal dari Akun Google dan
     * jadi penghubung ke seluruh data lama; mengubahnya memutus hubungan itu.
     */
    public function update(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $target = $this->users->findById((string) ($args['id'] ?? ''));

        if ($target === null) {
            return ApiResponse::error($response, 'User tidak ditemukan.', 404);
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        if ($this->isSuperAdmin($target) && !$this->isSuperAdmin($pelaku)) {
            return ApiResponse::error($response, 'Akun super admin hanya bisa diubah oleh sesama super admin.', 403);
        }

        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->max('name', 150, 'Nama')
          ->max('nik', 50, 'NIK')
          ->max('divisi', 100, 'Divisi')
          ->in('role', self::ROLES, 'Role');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $kolom = [];

        if (array_key_exists('name', $body)) {
            $nama = $v->string('name');

            if ($nama === null) {
                return ApiResponse::error($response, 'Nama tidak boleh dikosongkan.', 422, ['name' => 'Nama wajib diisi.']);
            }

            $kolom['name'] = $nama;
        }

        if (array_key_exists('nik', $body)) {
            $nik = $v->string('nik');

            if ($nik === null) {
                return ApiResponse::error($response, 'NIK tidak boleh dikosongkan.', 422, ['nik' => 'NIK wajib diisi.']);
            }

            // Route ini sudah dijaga RoleMiddleware admin. Rolenya tetap dibaca
            // ulang di sini supaya nama pemilik NIK tidak ikut terbawa kalau
            // suatu saat routenya dibuka untuk role lain.
            $bolehSebutPemilik = (string) ($pelaku['role'] ?? '') === 'admin';

            // $target['id'] dikecualikan: NIK milik user yang sedang diubah
            // bukan bentrok. Tanpa ini, menyimpan form tanpa mengubah NIK pun
            // akan ditolak.
            $bentrokNik = NikGuard::conflict($this->users, $nik, (string) $target['id'], $bolehSebutPemilik);

            if ($bentrokNik !== null) {
                return ApiResponse::error($response, $bentrokNik, 422, NikGuard::FIELD_ERRORS);
            }

            $kolom['nik'] = $nik;
        }

        if (array_key_exists('divisi', $body)) {
            $divisi     = (string) $v->string('divisi', '');
            $divisionId = $this->master->divisionIdByName($divisi);

            if ($divisionId === null) {
                return ApiResponse::error(
                    $response,
                    sprintf(
                        'Divisi "%s" tidak ada dalam daftar. Pilih salah satu: %s.',
                        $divisi,
                        implode(', ', $this->master->divisionNames())
                    ),
                    422,
                    ['divisi' => 'Divisi tidak dikenal.']
                );
            }

            $kolom['division_id'] = $divisionId;
        }

        if (array_key_exists('role', $body)) {
            $role = $v->string('role');

            if ($role === null) {
                return ApiResponse::error($response, 'Role tidak boleh dikosongkan.', 422, ['role' => 'Role wajib diisi.']);
            }

            $kolom['role'] = $role;
        }

        if ($kolom === []) {
            return ApiResponse::error(
                $response,
                'Tidak ada yang diubah. Kirim salah satu dari: name, nik, divisi, role.',
                422
            );
        }

        try {
            $this->users->updatePartial((string) $target['id'], $kolom);
        } catch (PDOException $e) {
            // Jaring pengaman: dua admin mengubah NIK ke nilai yang sama pada
            // saat yang hampir bersamaan, jadi kedua pemeriksaan di atas
            // sama-sama lolos sebelum salah satunya sempat menulis.
            //
            // Nama pemilik tidak disebut di sini walaupun pelakunya admin:
            // barisnya baru saja berubah, jadi nama yang dibaca sekarang belum
            // tentu nama yang menyebabkan bentrok.
            if (NikGuard::duplicateColumn($e) === 'nik') {
                return ApiResponse::error(
                    $response,
                    NikGuard::message(isset($kolom['nik']) ? (string) $kolom['nik'] : null),
                    422,
                    NikGuard::FIELD_ERRORS
                );
            }

            throw $e;
        }

        $terbaru = $this->users->findById((string) $target['id']);

        return ApiResponse::success(
            $response,
            $terbaru === null ? null : Transformer::user($terbaru),
            'Profil berhasil diperbarui.'
        );
    }

    /**
     * DELETE /api/users/{id}?mode=purge|detach — khusus admin.
     *
     * Keempat tabel terhubung dengan ON DELETE RESTRICT, jadi user tidak bisa
     * dihapus begitu saja selama masih punya baris di mana pun. Admin memilih
     * apa yang terjadi pada baris-baris itu:
     *
     *   purge   ikut dihapus. Tidak bisa dibatalkan.
     *   detach  dialihkan ke akun penampung; tidak ada data yang hilang, dan
     *           kolom snapshot tidak disentuh sehingga histori tetap terbaca
     *           atas nama teknisi aslinya.
     *
     * Tidak ada nilai default, dan itu disengaja. Menghapus data orang tidak
     * boleh terjadi hanya karena satu parameter lupa dikirim, jadi permintaan
     * tanpa mode ditolak 422 -- bukan diam-diam diperlakukan sebagai purge.
     */
    public function destroy(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $target = $this->users->findById((string) ($args['id'] ?? ''));

        if ($target === null) {
            return ApiResponse::error($response, 'User tidak ditemukan.', 404);
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        if ((string) $target['id'] === (string) $pelaku['id']) {
            return ApiResponse::error($response, 'Anda tidak bisa menghapus akun Anda sendiri.', 403);
        }

        if ($this->isSuperAdmin($target)) {
            return ApiResponse::error($response, 'Akun super admin tidak bisa dihapus.', 403);
        }

        $legacyId = (string) Env::get('LEGACY_USER_ID', 'legacy-unknown');

        // Baris penampung tempat log lama yang tidak teridentifikasi bersandar.
        // Menghapusnya berarti menghapus data hasil migrasi itu sendiri.
        if ((string) $target['id'] === $legacyId) {
            return ApiResponse::error(
                $response,
                'Akun penampung data lama tidak bisa dihapus. Semua log hasil migrasi yang belum teridentifikasi bersandar padanya.',
                403
            );
        }

        $mode = $this->deleteMode($request);

        if ($mode === null) {
            return ApiResponse::error(
                $response,
                'Parameter "mode" wajib diisi: "purge" untuk ikut menghapus seluruh data user ini,'
                    . ' atau "detach" untuk mengalihkan datanya ke akun penampung dan hanya menghapus profilnya.',
                422,
                ['mode' => 'Harus "purge" atau "detach".']
            );
        }

        if ($mode === 'purge') {
            $jumlah = $this->users->purgeWithData((string) $target['id'], (string) $target['nik']);

            return ApiResponse::success(
                $response,
                [
                    'id'      => (string) $target['id'],
                    'mode'    => 'purge',
                    'deleted' => $jumlah,
                ],
                sprintf(
                    'User %s dihapus beserta %d aktivitas, %d catatan audit, dan %d laporan bug. Data itu tidak bisa dikembalikan.',
                    (string) $target['name'],
                    $jumlah['tech_logs'],
                    $jumlah['audit_logs'],
                    $jumlah['bug_reports']
                )
            );
        }

        // Tanpa akun penampung, UPDATE-nya akan ditolak foreign key dan
        // berakhir sebagai 500. Lebih baik dijelaskan sekarang.
        if ($this->users->findById($legacyId) === null) {
            return ApiResponse::error(
                $response,
                sprintf(
                    'Akun penampung "%s" belum ada di database, jadi data user ini tidak punya tempat dialihkan.'
                        . ' Jalankan 04_legacy_user.sql terlebih dahulu.',
                    $legacyId
                ),
                409
            );
        }

        $jumlah = $this->users->detachAndDelete((string) $target['id'], $legacyId);

        return ApiResponse::success(
            $response,
            [
                'id'       => (string) $target['id'],
                'mode'     => 'detach',
                'detached' => $jumlah,
            ],
            sprintf(
                'Profil %s dihapus. %d aktivitas, %d catatan audit, dan %d laporan bug miliknya dialihkan ke akun'
                    . ' penampung dan tetap tersimpan -- nama teknisi pada histori tidak berubah.',
                (string) $target['name'],
                $jumlah['tech_logs'],
                $jumlah['audit_logs'],
                $jumlah['bug_reports']
            )
        );
    }

    /**
     * Baca mode dari query string, lalu dari body.
     *
     * Query string didahulukan karena paling tahan banting: sebagian proxy dan
     * konfigurasi PHP di shared hosting membuang body pada permintaan DELETE,
     * dan mode yang hilang di jalan akan terbaca sebagai "tidak dikirim".
     * Bodynya tetap diterima supaya frontend bebas memilih.
     */
    private function deleteMode(ServerRequestInterface $request): ?string
    {
        $query = $request->getQueryParams();
        $nilai = $query['mode'] ?? null;

        if ($nilai === null || (is_string($nilai) && trim($nilai) === '')) {
            $body  = $request->getParsedBody();
            $nilai = is_array($body) ? ($body['mode'] ?? null) : null;
        }

        if (!is_string($nilai)) {
            return null;
        }

        $nilai = strtolower(trim($nilai));

        return in_array($nilai, ['purge', 'detach'], true) ? $nilai : null;
    }

    // -----------------------------------------------------------------------

    /**
     * Super admin sekarang bisa lebih dari satu: gabungan SUPER_ADMIN_EMAILS di
     * .env dan yang diangkat lewat AdminPanel. Lihat Helpers/SuperAdmins.
     *
     * Akibatnya di sini: seorang super admin boleh mengubah profil super admin
     * lain, sedangkan admin biasa tetap tidak boleh menyentuh satu pun dari
     * mereka. Status super admin sendiri tidak berada di users.role, jadi tidak
     * ada cara mencabutnya lewat endpoint ini.
     *
     * @param array<string, mixed> $user
     */
    private function isSuperAdmin(array $user): bool
    {
        return $this->superAdmins->isSuperAdmin((string) ($user['email'] ?? ''));
    }

    private function trimmed(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }

    /** @param list<string> $allowed */
    private function oneOf(mixed $value, array $allowed): ?string
    {
        $value = $this->trimmed($value);

        return $value !== null && in_array($value, $allowed, true) ? $value : null;
    }
}
