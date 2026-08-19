<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Helpers\Audit;
use App\Helpers\SuperAdmins;
use App\Helpers\Validator;
use App\Models\UserModel;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Pengelolaan daftar super admin.
 *
 * Seluruh endpoint di sini dijaga SuperAdminMiddleware, bukan RoleMiddleware
 * admin: admin biasa tidak boleh mengangkat super admin, karena kalau boleh, dia
 * bisa mengangkat dirinya sendiri dan pembedaan keduanya jadi tidak berarti.
 *
 * Tiga pengaman yang tidak boleh hilang
 * -------------------------------------
 *   1. Alamat dari .env tidak bisa diturunkan lewat endpoint mana pun. Itu
 *      jalan pulang terakhir kalau berkas super-admins.json rusak atau
 *      seseorang salah menurunkan orang.
 *   2. Super admin terakhir tidak bisa diturunkan, termasuk oleh dirinya
 *      sendiri. Sistem tanpa super admin hanya bisa dipulihkan lewat server.
 *   3. Setiap pengangkatan dan penurunan dicatat di audit_logs.
 */
final class SuperAdminController
{
    public function __construct(
        private SuperAdmins $superAdmins,
        private UserModel $users,
        private Audit $audit
    ) {
    }

    /**
     * GET /api/super-admins
     *
     * Menyebut asal-usul tiap alamat (env atau app) dan apakah bisa
     * diturunkan, supaya AdminPanel bisa menonaktifkan tombolnya, bukan
     * menawarkan tombol yang pasti ditolak server.
     */
    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $daftar = array_map(
            function (array $baris): array {
                $user = $this->users->findByEmail((string) $baris['email']);

                // Alamat yang belum pernah login belum punya baris users. Itu
                // sah -- super admin bisa ditunjuk sebelum orangnya mendaftar,
                // dan justru begitulah penerusnya disiapkan.
                $baris['registered'] = $user !== null;
                $baris['name']       = $user === null ? null : (string) $user['name'];

                return $baris;
            },
            $this->superAdmins->details()
        );

        return ApiResponse::success($response, $daftar, null, 200, ['total' => count($daftar)]);
    }

    /**
     * POST /api/super-admins
     *
     * Body: { "email": "orang@perusahaan.com" }
     *
     * Alamat yang belum punya akun boleh diangkat. Itu bukan kelonggaran yang
     * kelupaan ditutup -- itu justru jalur serah terimanya: alamat yang sudah
     * jadi super admin melewati kedua lapis pembatasan saat mendaftar, jadi
     * penerus bisa disiapkan sebelum dia pernah login sekalipun.
     */
    public function promote(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->required('email', 'Email')->email('email', 'Email')->max('email', 255, 'Email');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $email = strtolower(trim((string) $v->string('email')));

        if ($this->superAdmins->isSuperAdmin($email)) {
            return ApiResponse::error($response, sprintf('%s sudah menjadi super admin.', $email), 409);
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        $this->superAdmins->promote($email, $pelaku);

        $user = $this->users->findByEmail($email);

        $tercatat = $this->audit->record(
            $pelaku,
            'Mengangkat super admin',
            sprintf(
                '%s diangkat menjadi super admin%s.',
                $email,
                $user === null ? ' (belum punya akun di sistem)' : sprintf(' (%s)', (string) $user['name'])
            )
        );

        $pesan = $user === null
            ? sprintf(
                '%s diangkat menjadi super admin. Alamat ini belum punya akun;'
                    . ' saat nanti login dengan Akun Google-nya, pendaftarannya langsung aktif tanpa perlu disetujui.',
                $email
            )
            : sprintf('%s diangkat menjadi super admin.', $email);

        return ApiResponse::created($response, $this->superAdmins->details(), Audit::pesan($pesan, $tercatat));
    }

    /**
     * DELETE /api/super-admins/{email}
     *
     * Hanya menyentuh alamat yang diangkat lewat aplikasi.
     */
    public function demote(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        // rawurldecode, bukan urldecode: yang kedua mengubah "+" jadi spasi, dan
        // alamat seperti "nama+tag@gmail.com" itu sah. Aman dipanggil walaupun
        // Slim sudah mengurai %-nya, karena email tidak memuat "%".
        $email = strtolower(trim(rawurldecode((string) ($args['email'] ?? ''))));

        if ($email === '') {
            return ApiResponse::error($response, 'Alamat email wajib disebutkan.', 422);
        }

        if (!$this->superAdmins->isSuperAdmin($email)) {
            return ApiResponse::error($response, sprintf('%s bukan super admin.', $email), 404);
        }

        // Pengaman 1: alamat dari .env.
        if ($this->superAdmins->isRoot($email)) {
            return ApiResponse::error(
                $response,
                sprintf(
                    '%s berasal dari SUPER_ADMIN_EMAILS di .env dan sengaja tidak bisa diturunkan lewat aplikasi.'
                        . ' Hapus alamatnya dari .env di server kalau memang harus dicabut.',
                    $email
                ),
                403
            );
        }

        // Pengaman 2: jangan sampai tidak tersisa siapa pun.
        if ($this->superAdmins->count() <= 1) {
            return ApiResponse::error(
                $response,
                'Ini satu-satunya super admin yang tersisa. Angkat penggantinya terlebih dahulu,'
                    . ' atau tambahkan alamat lain ke SUPER_ADMIN_EMAILS di .env.',
                403
            );
        }

        if (!$this->superAdmins->demote($email)) {
            return ApiResponse::error($response, sprintf('%s bukan super admin.', $email), 404);
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        $sendiri = strtolower(trim((string) ($pelaku['email'] ?? ''))) === $email;

        $tercatat = $this->audit->record(
            $pelaku,
            'Menurunkan super admin',
            sprintf('%s tidak lagi menjadi super admin%s.', $email, $sendiri ? ' (menurunkan dirinya sendiri)' : '')
        );

        return ApiResponse::success(
            $response,
            $this->superAdmins->details(),
            Audit::pesan(
                $sendiri
                    ? sprintf('Anda (%s) tidak lagi menjadi super admin. Hak admin biasa Anda tidak berubah.', $email)
                    : sprintf('%s tidak lagi menjadi super admin.', $email),
                $tercatat
            )
        );
    }
}
