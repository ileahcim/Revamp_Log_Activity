<?php

declare(strict_types=1);

namespace App\Middleware;

use App\Helpers\ApiResponse;
use App\Helpers\SuperAdmins;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Hanya super admin yang boleh lewat.
 *
 * Dipasang di atas RoleMiddleware admin, bukan menggantikannya, jadi urutan
 * pemeriksaannya: token sah -> punya baris users -> rolenya admin -> emailnya
 * termasuk super admin.
 *
 * Kenapa perlu terpisah dari role 'admin': admin biasa boleh mengubah role
 * orang lain lewat PUT /api/users/{id}. Kalau pengangkatan super admin ikut
 * dibuka untuk mereka, admin biasa bisa mengangkat dirinya sendiri menjadi
 * super admin, dan pembedaan keduanya jadi tidak berarti.
 *
 * Yang diperiksa adalah EMAIL, bukan users.role. Lihat Helpers/SuperAdmins.
 */
final class SuperAdminMiddleware implements MiddlewareInterface
{
    public function __construct(
        private SuperAdmins $superAdmins,
        private ResponseFactoryInterface $responseFactory
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        /** @var array<string, mixed>|null $user */
        $user = $request->getAttribute('user');

        if ($user === null || !$this->superAdmins->isSuperAdmin((string) ($user['email'] ?? ''))) {
            return ApiResponse::errorFrom(
                $this->responseFactory,
                'Hanya super admin yang boleh melakukan tindakan ini.',
                403
            );
        }

        return $handler->handle($request);
    }
}
