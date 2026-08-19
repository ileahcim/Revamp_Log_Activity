<?php

declare(strict_types=1);

namespace App\Middleware;

use App\Helpers\ApiResponse;
use App\Helpers\RegistrationStore;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Penjaga hak akses.
 *
 * Dipasang setelah AuthMiddleware, jadi token sudah pasti sah di titik ini.
 * Yang diperiksa di sini adalah dua hal berikutnya:
 *
 *   1. Apakah user sudah punya baris di tabel users
 *   2. Apakah rolenya termasuk yang diizinkan untuk route ini
 *
 * Daftar role kosong berarti "cukup sudah terdaftar, role apa pun boleh".
 *
 * Pengecekan ini ada di server, bukan hanya di React, supaya seseorang tidak
 * bisa memanggil endpoint admin langsung lewat curl.
 *
 * Bagaimana pendaftar yang menunggu tertahan
 * ------------------------------------------
 * Pelamar yang menunggu persetujuan TIDAK punya baris di tabel users -- lihat
 * alasannya di Helpers/RegistrationStore. Artinya syarat nomor 1 di atas sudah
 * menahan mereka di setiap endpoint yang memakai middleware ini, tanpa aturan
 * baru, dan endpoint yang ditambahkan besok ikut terlindungi dengan sendirinya.
 *
 * Yang ditambahkan di sini hanyalah PESANNYA. Tanpa itu, orang yang sudah
 * mengirim formulir dan sedang menunggu akan terus dibalas "Lengkapi profil
 * terlebih dahulu" dan mengira formulirnya tidak terkirim, lalu mendaftar lagi.
 * Hasil akhirnya sama-sama 403; tidak ada satu pun jalan masuk baru di sini.
 */
final class RoleMiddleware implements MiddlewareInterface
{
    /** @param list<string> $allowedRoles */
    public function __construct(
        private array $allowedRoles,
        private ResponseFactoryInterface $responseFactory,
        private RegistrationStore $registrations
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        /** @var array<string, mixed>|null $user */
        $user = $request->getAttribute('user');

        if ($user === null) {
            return ApiResponse::errorFrom(
                $this->responseFactory,
                $this->pesanBelumTerdaftar((string) $request->getAttribute('uid')),
                403
            );
        }

        if ($this->allowedRoles !== [] && !in_array((string) $user['role'], $this->allowedRoles, true)) {
            return ApiResponse::errorFrom(
                $this->responseFactory,
                'Anda tidak punya hak akses untuk tindakan ini.',
                403
            );
        }

        return $handler->handle($request);
    }

    /**
     * Belum punya baris users bisa berarti tiga keadaan yang berbeda bagi
     * pemakainya, walaupun jawabannya sama-sama 403.
     */
    private function pesanBelumTerdaftar(string $uid): string
    {
        if ($this->registrations->findPending($uid) !== null) {
            return 'Pendaftaran Anda sedang menunggu persetujuan admin.'
                . ' Anda akan bisa masuk setelah disetujui.';
        }

        if ($this->registrations->findRejected($uid) !== null) {
            return 'Pendaftaran Anda tidak disetujui. Hubungi admin bila menurut Anda ini keliru.';
        }

        return 'Akun Anda belum terdaftar di sistem. Lengkapi profil terlebih dahulu.';
    }
}
