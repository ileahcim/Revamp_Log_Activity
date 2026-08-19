<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Helpers\NikGuard;
use App\Helpers\RegistrationPolicy;
use App\Helpers\RegistrationStore;
use App\Helpers\SuperAdmins;
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
 * Endpoint di sini hanya dilindungi AuthMiddleware, bukan RoleMiddleware,
 * kecuali /auth/me. Alasannya user yang baru pertama kali login memang belum
 * punya baris di tabel users -- kalau RoleMiddleware dipasang, dia akan ditolak
 * 403 dan tidak akan pernah bisa mendaftar.
 *
 * Yang dipercaya dari frontend hanya nama, NIK, dan divisi. UID dan email
 * selalu diambil dari isi token yang sudah diverifikasi tanda tangannya, supaya
 * seseorang tidak bisa mendaftarkan profil atas nama akun Google orang lain.
 *
 * Dua lapis pembatasan pendaftaran
 * --------------------------------
 *   Lapis 1  NIK harus sudah dikenal sistem      -> Helpers/RegistrationPolicy
 *   Lapis 2  admin harus menyetujui              -> Helpers/RegistrationStore
 *
 * Yang lolos Lapis 1 masuk ke antrean, BUKAN ke tabel users. Selama menunggu
 * dia tidak punya baris users sama sekali, jadi RoleMiddleware menolaknya di
 * setiap endpoint tanpa aturan tambahan. Satu-satunya yang bisa dia lihat
 * adalah status dirinya sendiri lewat /auth/sync dan /auth/status.
 */
final class AuthController
{
    public function __construct(
        private UserModel $users,
        private MasterModel $master,
        private RegistrationStore $registrations,
        private RegistrationPolicy $policy,
        private SuperAdmins $superAdmins
    ) {
    }

    /**
     * POST /api/auth/sync
     *
     * Dipanggil sekali setiap selesai login Google. Menggantikan blok
     * "getDoc(doc(db,'users',uid))" di Login.tsx.
     *
     * Selalu menjawab 200, termasuk untuk akun yang belum terdaftar dan yang
     * sedang menunggu -- keduanya keadaan normal, bukan error.
     *
     * Bentuk jawabannya:
     *
     *   status = "active"        data.user berisi profilnya, langsung masuk
     *   status = "unregistered"  tampilkan form "Lengkapi Profil", isi awalnya
     *                            ada di data.prefill
     *   status = "pending"       tampilkan layar "menunggu persetujuan",
     *                            detailnya di data.registration
     *   status = "rejected"      tampilkan penolakan, alasannya di
     *                            data.registration.reason
     *
     * Field `registered` yang lama tetap dikirim dan artinya tidak berubah,
     * supaya frontend yang belum diperbarui tetap jalan: keduanya selain
     * "active" tetap terbaca sebagai belum terdaftar.
     */
    public function sync(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return $this->jawabStatus($request, $response);
    }

    /**
     * GET /api/auth/status
     *
     * Isi yang sama dengan /auth/sync, tapi tanpa efek samping dan tanpa body.
     * Dipakai layar "menunggu persetujuan" untuk memeriksa ulang apakah admin
     * sudah menyetujui, tanpa harus login ulang.
     */
    public function status(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return $this->jawabStatus($request, $response);
    }

    /**
     * POST /api/auth/register
     *
     * Body: { "name": "...", "nik": "...", "divisi": "Mekanik" }
     *
     * Jawabannya dua kemungkinan kalau berhasil:
     *   201  profil langsung aktif (super admin, atau Lapis 2 dimatikan)
     *   202  permintaan masuk antrean, menunggu persetujuan admin
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

        // Akun penampung data lama tidak boleh dipakai siapa pun. UID-nya bukan
        // UID Google dan emailnya memakai domain .invalid yang tidak bisa
        // didaftarkan, jadi ini tidak akan pernah terpicu lewat login normal --
        // dipasang supaya tetap tertutup kalau nilainya suatu saat diubah.
        //
        // Diperiksa SEBELUM pengecualian super admin di bawah, supaya alamat
        // penampung tidak bisa dibuka dengan mengangkatnya jadi super admin.
        if ($this->policy->akunPenampung($uid, $email)) {
            return ApiResponse::error($response, 'Akun ini tidak bisa dipakai mendaftar.', 403);
        }

        // ---------------------------------------------------------------
        // Super admin melewati seluruh gerbang di bawah.
        //
        // Ini syarat yang paling keras di fitur ini: super admin harus selalu
        // bisa masuk, apa pun aturannya. Kalau dia pernah ditolak, atau
        // permintaannya terlanjur mengantre sebelum dia diangkat, dia akan
        // tertahan di gerbang yang tidak ada seorang pun tersisa untuk
        // membukanya.
        // ---------------------------------------------------------------
        $superAdmin = $this->superAdmins->isSuperAdmin($email);

        if (!$superAdmin) {
            // Sudah mengantre. Ditolak hanya selama Lapis 2 memang menyala:
            // kalau Lapis 2 dimatikan sebagai tindakan darurat, orang yang
            // terlanjur mengantre justru akan jadi satu-satunya yang tetap
            // terkunci -- tidak punya baris users, dan pendaftaran ulangnya
            // ditolak 409.
            if ($this->registrations->findPending($uid) !== null && $this->policy->butuhPersetujuan()) {
                return ApiResponse::error(
                    $response,
                    'Pendaftaran Anda sudah terkirim dan sedang menunggu persetujuan admin.',
                    409
                );
            }

            if ($this->registrations->findRejected($uid) !== null) {
                return ApiResponse::error(
                    $response,
                    'Pendaftaran Anda tidak disetujui. Hubungi admin bila menurut Anda ini keliru.',
                    403
                );
            }
        }

        $body = $this->body($request);

        $v = new Validator($body);
        $v->required('name', 'Nama')->max('name', 150, 'Nama')
          ->required('nik', 'NIK')->max('nik', 50, 'NIK')
          ->required('divisi', 'Divisi')->max('divisi', 100, 'Divisi');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $nama   = (string) $v->string('name');
        $nik    = (string) $v->string('nik');
        $divisi = (string) $v->string('divisi');

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

        if ($this->users->findByEmail($email) !== null) {
            return ApiResponse::error(
                $response,
                'Email ini sudah terdaftar dengan akun lain. Hubungi admin.',
                409
            );
        }

        // ---------------------------------------------------------------
        // Super admin: lewat kedua lapis.
        //
        // Ini yang menjaga supaya aturan di bawah tidak bisa mengunci semua
        // orang di luar sistem. Super admin baru -- yang diangkat pendahulunya
        // lewat AdminPanel -- belum tentu punya NIK di tech_logs mana pun, dan
        // tidak ada siapa pun di dalam yang bisa menyetujuinya kalau semua
        // admin sudah pergi.
        // ---------------------------------------------------------------
        if ($superAdmin) {
            // NIK kembar tetap tidak boleh, karena kolomnya UNIQUE. Bedanya di
            // sini pemilik NIK-nya boleh disebut: yang membaca pesan ini sudah
            // dipastikan super admin lewat alamat emailnya.
            $bentrok = NikGuard::conflict($this->users, $nik, null, true);

            if ($bentrok !== null) {
                return ApiResponse::error($response, $bentrok, 422, NikGuard::FIELD_ERRORS);
            }

            return $this->buatProfil($response, $uid, $email, $nama, $nik, $divisionId, 'admin');
        }

        // ---------------------------------------------------------------
        // Lapis 1 -- NIK harus sudah dikenal sistem.
        //
        // Satu pesan untuk semua alasan penolakan: tidak dikenal, sudah
        // dipakai, dan sedang diantre orang lain dijawab sama persis. Lihat
        // Helpers/RegistrationPolicy.
        // ---------------------------------------------------------------
        if (!$this->policy->nikBolehDipakai($nik, $uid)) {
            return ApiResponse::error(
                $response,
                RegistrationPolicy::PESAN_NIK_DITOLAK,
                422,
                RegistrationPolicy::FIELD_ERRORS
            );
        }

        // ---------------------------------------------------------------
        // Lapis 2 -- persetujuan admin.
        // ---------------------------------------------------------------
        if (!$this->policy->butuhPersetujuan()) {
            return $this->buatProfil($response, $uid, $email, $nama, $nik, $divisionId, 'karyawan');
        }

        $permintaan = $this->registrations->queue([
            'uid'    => $uid,
            'email'  => $email,
            'name'   => $nama,
            'nik'    => $nik,
            'divisi' => $divisi,
        ]);

        return ApiResponse::success(
            $response,
            [
                'registered'   => false,
                'status'       => 'pending',
                'user'         => null,
                'registration' => $this->tampilkanPermintaan($permintaan),
            ],
            'Pendaftaran Anda terkirim dan sedang menunggu persetujuan admin.'
                . ' Anda akan bisa masuk setelah disetujui.',
            202
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

    /**
     * Isi jawaban /auth/sync dan /auth/status, yang memang sama.
     */
    private function jawabStatus(
        ServerRequestInterface $request,
        ResponseInterface $response
    ): ResponseInterface {
        /** @var array<string, mixed> $claims */
        $claims = $request->getAttribute('auth');
        /** @var array<string, mixed>|null $user */
        $user = $request->getAttribute('user');
        $uid  = (string) $request->getAttribute('uid');

        if ($user !== null) {
            // Menyalin perilaku Login.tsx: alamat email tertentu selalu
            // dinaikkan menjadi admin. Bedanya, daftarnya sekarang dibaca dari
            // .env ditambah yang diangkat lewat AdminPanel, dan pencocokannya
            // terjadi di server.
            //
            // Ini juga yang membuat status super admin tidak bisa dicabut
            // dengan mengubah users.role: rolenya naik lagi setiap dia login.
            $superAdmin = $this->superAdmins->isSuperAdmin((string) $user['email']);

            if ($superAdmin && (string) $user['role'] !== 'admin') {
                $this->users->updateRole((string) $user['id'], 'admin');
                $user['role'] = 'admin';
            }

            return ApiResponse::success($response, [
                'registered' => true,
                'status'     => 'active',
                'user'       => Transformer::user($user),
                // Dipakai AdminPanel untuk memutuskan apakah menu "Kelola super
                // admin" ditampilkan. Bukan pengaman -- pengamannya
                // SuperAdminMiddleware di server.
                'is_super_admin' => $superAdmin,
            ]);
        }

        // Super admin yang belum punya baris users selalu diarahkan ke formulir
        // pendaftaran, walaupun permintaannya sedang mengantre atau pernah
        // ditolak. Kalau tidak, dia akan melihat layar "menunggu persetujuan"
        // padahal register() memang akan meloloskannya -- dan tidak ada
        // seorang pun tersisa untuk menekan tombol setuju.
        if ($this->superAdmins->isSuperAdmin($this->emailFrom($claims))) {
            return $this->jawabBelumTerdaftar($response, $uid, $claims);
        }

        $menunggu = $this->registrations->findPending($uid);

        if ($menunggu !== null) {
            return ApiResponse::success(
                $response,
                [
                    'registered'   => false,
                    'status'       => 'pending',
                    'user'         => null,
                    'registration' => $this->tampilkanPermintaan($menunggu),
                ],
                'Pendaftaran Anda sedang menunggu persetujuan admin.'
            );
        }

        $ditolak = $this->registrations->findRejected($uid);

        if ($ditolak !== null) {
            return ApiResponse::success(
                $response,
                [
                    'registered'   => false,
                    'status'       => 'rejected',
                    'user'         => null,
                    'registration' => array_merge(
                        $this->tampilkanPermintaan($ditolak),
                        [
                            'rejected_at' => $ditolak['rejected_at'] ?? null,
                            'reason'      => $ditolak['reason'] ?? null,
                        ]
                    ),
                ],
                'Pendaftaran Anda tidak disetujui. Hubungi admin bila menurut Anda ini keliru.'
            );
        }

        return $this->jawabBelumTerdaftar($response, $uid, $claims);
    }

    /**
     * Jawaban "silakan isi formulir pendaftaran".
     *
     * @param array<string, mixed> $claims
     */
    private function jawabBelumTerdaftar(
        ResponseInterface $response,
        string $uid,
        array $claims
    ): ResponseInterface {
        return ApiResponse::success(
            $response,
            [
                'registered' => false,
                'status'     => 'unregistered',
                'user'       => null,
                'prefill'    => [
                    'id'    => $uid,
                    'email' => $this->emailFrom($claims),
                    'name'  => trim((string) ($claims['name'] ?? '')),
                ],
            ],
            'Akun Google Anda belum terdaftar. Lengkapi profil terlebih dahulu.'
        );
    }

    /**
     * Buat baris users lalu balas 201.
     *
     * Dipakai dua jalur yang melewati antrean: super admin, dan keadaan saat
     * Lapis 2 sengaja dimatikan lewat .env.
     */
    private function buatProfil(
        ResponseInterface $response,
        string $uid,
        string $email,
        string $nama,
        string $nik,
        int $divisionId,
        string $role
    ): ResponseInterface {
        try {
            $this->users->create([
                'id'          => $uid,
                'email'       => $email,
                'nik'         => $nik,
                'name'        => $nama,
                'division_id' => $divisionId,
                'role'        => $role,
            ]);
        } catch (PDOException $e) {
            // Jaring pengaman. Dua pendaftaran yang datang hampir bersamaan bisa
            // sama-sama lolos pemeriksaan di atas sebelum salah satunya sempat
            // menulis; yang kalah ditolak indeks UNIQUE dan harus mendapat pesan
            // yang sama, bukan 500.
            $bentrok = NikGuard::duplicateColumn($e);

            if ($bentrok === 'nik') {
                return ApiResponse::error(
                    $response,
                    RegistrationPolicy::PESAN_NIK_DITOLAK,
                    422,
                    RegistrationPolicy::FIELD_ERRORS
                );
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

        // Sisa antrean dan catatan tolakan, kalau ada. Hanya mungkin terjadi
        // lewat jalur super admin atau saat Lapis 2 dimatikan; dibersihkan di
        // sini supaya tidak tertinggal dan muncul lagi di layar admin sebagai
        // permintaan hantu.
        //
        // Dilakukan SETELAH barisnya jadi: kalau urutannya dibalik dan
        // pembuatan baris gagal, permintaannya hilang tanpa pernah jadi user.
        $this->registrations->remove($uid);
        $this->registrations->forget($uid);

        $created = $this->users->findById($uid);

        return ApiResponse::created(
            $response,
            [
                'registered' => true,
                'status'     => 'active',
                'user'       => $created === null ? null : Transformer::user($created),
            ],
            'Profil berhasil dibuat.'
        );
    }

    /**
     * Bentuk permintaan pendaftaran untuk dikirim ke pemiliknya sendiri.
     *
     * @param array<string, mixed> $permintaan
     * @return array<string, mixed>
     */
    private function tampilkanPermintaan(array $permintaan): array
    {
        return [
            'name'         => (string) ($permintaan['name'] ?? ''),
            'nik'          => (string) ($permintaan['nik'] ?? ''),
            'divisi'       => (string) ($permintaan['divisi'] ?? ''),
            'email'        => (string) ($permintaan['email'] ?? ''),
            'requested_at' => $permintaan['requested_at'] ?? null,
        ];
    }

    /** @param array<string, mixed> $claims */
    private function emailFrom(array $claims): string
    {
        return strtolower(trim((string) ($claims['email'] ?? '')));
    }

    /** @return array<string, mixed> */
    private function body(ServerRequestInterface $request): array
    {
        $body = $request->getParsedBody();

        return is_array($body) ? $body : [];
    }
}
