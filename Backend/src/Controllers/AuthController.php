<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Config\Env;
use App\Helpers\ApiResponse;
use App\Helpers\NikGuard;
use App\Helpers\Transformer;
use App\Helpers\Validator;
use App\Models\MasterModel;
use App\Models\UserModel;
use PDOException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Endpoint login dan pendaftaran profil.
 *
 * Ketiga endpoint di sini hanya dilindungi AuthMiddleware, bukan RoleMiddleware,
 * kecuali /auth/me. Alasannya user yang baru pertama kali login memang belum
 * punya baris di tabel users -- kalau RoleMiddleware dipasang, dia akan ditolak
 * 403 dan tidak akan pernah bisa mendaftar.
 *
 * Yang dipercaya dari frontend hanya nama, NIK, dan divisi. UID dan email
 * selalu diambil dari isi token yang sudah diverifikasi tanda tangannya, supaya
 * seseorang tidak bisa mendaftarkan profil atas nama akun Google orang lain.
 */
final class AuthController
{
    public function __construct(
        private UserModel $users,
        private MasterModel $master
    ) {
    }

    /**
     * POST /api/auth/sync
     *
     * Dipanggil sekali setiap selesai login Google. Menggantikan blok
     * "getDoc(doc(db,'users',uid))" di Login.tsx.
     *
     * Selalu menjawab 200, termasuk untuk akun yang belum terdaftar -- itu
     * keadaan normal, bukan error. Frontend cukup melihat data.registered:
     *
     *   true  -> langsung masuk aplikasi memakai data.user
     *   false -> tampilkan form "Lengkapi Profil", isi awalnya ada di
     *            data.prefill, lalu kirim ke POST /api/auth/register
     */
    public function sync(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array<string, mixed> $claims */
        $claims = $request->getAttribute('auth');
        /** @var array<string, mixed>|null $user */
        $user = $request->getAttribute('user');

        if ($user === null) {
            return ApiResponse::success(
                $response,
                [
                    'registered' => false,
                    'user'       => null,
                    'prefill'    => [
                        'id'    => (string) $request->getAttribute('uid'),
                        'email' => $this->emailFrom($claims),
                        'name'  => trim((string) ($claims['name'] ?? '')),
                    ],
                ],
                'Akun Google Anda belum terdaftar. Lengkapi profil terlebih dahulu.'
            );
        }

        // Menyalin perilaku Login.tsx: satu alamat email tertentu selalu
        // dinaikkan menjadi admin. Bedanya, alamat itu sekarang dibaca dari
        // .env dan pencocokannya terjadi di server.
        if ($this->isSuperAdmin((string) $user['email']) && (string) $user['role'] !== 'admin') {
            $this->users->updateRole((string) $user['id'], 'admin');
            $user['role'] = 'admin';
        }

        return ApiResponse::success($response, [
            'registered' => true,
            'user'       => Transformer::user($user),
        ]);
    }

    /**
     * POST /api/auth/register
     *
     * Body: { "name": "...", "nik": "...", "divisi": "Mekanik" }
     *
     * Endpoint ini tidak ada di daftar awal, tapi tanpa dia user baru tidak
     * punya cara mendaftar: POST /api/users dilindungi RoleMiddleware, sedangkan
     * user baru justru belum punya role.
     */
    public function register(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $uid = (string) $request->getAttribute('uid');

        if ($request->getAttribute('user') !== null) {
            return ApiResponse::error($response, 'Akun ini sudah terdaftar.', 409);
        }

        /** @var array<string, mixed> $claims */
        $claims = $request->getAttribute('auth');

        // Firebase menyertakan email_verified: false untuk akun yang dibuat
        // lewat email/password tanpa konfirmasi. Login Google selalu true.
        if (array_key_exists('email_verified', $claims) && $claims['email_verified'] === false) {
            return ApiResponse::error(
                $response,
                'Email akun Anda belum terverifikasi. Masuklah dengan Akun Google.',
                403
            );
        }

        $email = $this->emailFrom($claims);

        if ($email === '') {
            return ApiResponse::error(
                $response,
                'Akun Google Anda tidak memberikan alamat email, jadi profil tidak bisa dibuat.',
                422
            );
        }

        $body = $this->body($request);

        $v = new Validator($body);
        $v->required('name', 'Nama')->max('name', 150, 'Nama')
          ->required('nik', 'NIK')->max('nik', 50, 'NIK')
          ->required('divisi', 'Divisi')->max('divisi', 100, 'Divisi');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $nik = (string) $v->string('nik');

        $divisi     = (string) $v->string('divisi');
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

        // Pendaftaran terbuka untuk siapa pun yang punya Akun Google, jadi nama
        // pemilik NIK TIDAK pernah disebut di sini. Lihat catatan di NikGuard.
        $bentrokNik = NikGuard::conflict($this->users, $nik);

        if ($bentrokNik !== null) {
            return ApiResponse::error($response, $bentrokNik, 422, NikGuard::FIELD_ERRORS);
        }

        if ($this->users->findByEmail($email) !== null) {
            return ApiResponse::error(
                $response,
                'Email ini sudah terdaftar dengan akun lain. Hubungi admin.',
                409
            );
        }

        try {
            $this->users->create([
                'id'          => $uid,
                'email'       => $email,
                'nik'         => $nik,
                'name'        => (string) $v->string('name'),
                'division_id' => $divisionId,
                'role'        => $this->isSuperAdmin($email) ? 'admin' : 'karyawan',
            ]);
        } catch (PDOException $e) {
            // Jaring pengaman. Dua pendaftaran yang datang hampir bersamaan bisa
            // sama-sama lolos pemeriksaan di atas sebelum salah satunya sempat
            // menulis; yang kalah ditolak indeks UNIQUE dan harus mendapat pesan
            // yang sama, bukan 500.
            $bentrok = NikGuard::duplicateColumn($e);

            if ($bentrok === 'nik') {
                return ApiResponse::error($response, NikGuard::message($nik), 422, NikGuard::FIELD_ERRORS);
            }

            if ($bentrok === 'email') {
                return ApiResponse::error($response, 'Email ini sudah terdaftar dengan akun lain. Hubungi admin.', 409);
            }

            // Duplikat pada PRIMARY KEY berarti UID-nya sudah punya baris —
            // pendaftaran kedua dari akun yang sama.
            if (NikGuard::isDuplicateEntry($e)) {
                return ApiResponse::error($response, 'Akun ini sudah terdaftar.', 409);
            }

            throw $e;
        }

        $created = $this->users->findById($uid);

        return ApiResponse::created(
            $response,
            [
                'registered' => true,
                'user'       => $created === null ? null : Transformer::user($created),
            ],
            'Profil berhasil dibuat.'
        );
    }

    /**
     * GET /api/auth/me
     *
     * Profil user yang sedang login. Berguna setelah refresh halaman: frontend
     * tidak perlu menyimpan profil di localStorage, cukup panggil ini.
     */
    public function me(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array<string, mixed> $user dijamin ada oleh RoleMiddleware */
        $user = $request->getAttribute('user');

        return ApiResponse::success($response, Transformer::user($user));
    }

    // -----------------------------------------------------------------------

    /** @param array<string, mixed> $claims */
    private function emailFrom(array $claims): string
    {
        return strtolower(trim((string) ($claims['email'] ?? '')));
    }

    private function isSuperAdmin(string $email): bool
    {
        $superAdmin = strtolower(trim((string) Env::get('SUPER_ADMIN_EMAIL', '')));

        return $superAdmin !== '' && strtolower(trim($email)) === $superAdmin;
    }

    /** @return array<string, mixed> */
    private function body(ServerRequestInterface $request): array
    {
        $body = $request->getParsedBody();

        return is_array($body) ? $body : [];
    }
}
