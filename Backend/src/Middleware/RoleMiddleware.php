<?php

declare(strict_types=1);

namespace App\Middleware;

use App\Helpers\ApiResponse;
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
 *   1. Apakah user sudah punya baris di tabel users (sudah melengkapi profil)
 *   2. Apakah rolenya termasuk yang diizinkan untuk route ini
 *
 * Daftar role kosong berarti "cukup sudah terdaftar, role apa pun boleh".
 *
 * Pengecekan ini ada di server, bukan hanya di React, supaya seseorang tidak
 * bisa memanggil endpoint admin langsung lewat curl.
 */
final class RoleMiddleware implements MiddlewareInterface
{
    /** @param list<string> $allowedRoles */
    public function __construct(
        private array $allowedRoles,
        private ResponseFactoryInterface $responseFactory
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        /** @var array<string, mixed>|null $user */
        $user = $request->getAttribute('user');

        if ($user === null) {
            return ApiResponse::errorFrom(
                $this->responseFactory,
                'Akun Anda belum terdaftar di sistem. Lengkapi profil terlebih dahulu.',
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
}
