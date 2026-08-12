<?php

declare(strict_types=1);

namespace App\Middleware;

use App\Helpers\ApiResponse;
use App\Helpers\FirebaseToken;
use App\Helpers\TokenException;
use App\Models\UserModel;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Memastikan setiap request membawa Firebase ID token yang sah.
 *
 * Middleware ini hanya memverifikasi token dan menempelkan hasilnya ke
 * request. Urusan "sudah terdaftar atau belum" dan "rolenya boleh atau tidak"
 * ditangani RoleMiddleware, karena endpoint pendaftaran justru harus bisa
 * diakses user yang belum punya baris di tabel users.
 *
 * Atribut yang ditempelkan:
 *   auth  -> seluruh claim di dalam token
 *   uid   -> claim "sub", nilai yang dipakai sebagai users.id
 *   user  -> baris tabel users, atau null kalau belum terdaftar
 */
final class AuthMiddleware implements MiddlewareInterface
{
    public function __construct(
        private FirebaseToken $verifier,
        private UserModel $users,
        private ResponseFactoryInterface $responseFactory
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $token = $this->bearerToken($request);

        if ($token === null) {
            return ApiResponse::errorFrom(
                $this->responseFactory,
                'Anda belum masuk. Silakan login terlebih dahulu.',
                401
            );
        }

        try {
            $claims = $this->verifier->verify($token);
        } catch (TokenException $e) {
            return ApiResponse::errorFrom($this->responseFactory, $e->getMessage(), 401);
        }

        $uid = (string) $claims['sub'];

        return $handler->handle(
            $request
                ->withAttribute('auth', $claims)
                ->withAttribute('uid', $uid)
                ->withAttribute('user', $this->users->findById($uid))
        );
    }

    /**
     * Ambil token dari header Authorization.
     *
     * Sebagian shared hosting menjalankan PHP sebagai CGI/FastCGI dan membuang
     * header Authorization sebelum sampai ke PHP. Karena itu ada beberapa
     * tempat yang diperiksa, bukan hanya header PSR-7-nya.
     */
    private function bearerToken(ServerRequestInterface $request): ?string
    {
        $candidates = [$request->getHeaderLine('Authorization')];

        $server = $request->getServerParams();

        foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
            if (isset($server[$key]) && is_string($server[$key])) {
                $candidates[] = $server[$key];
            }
        }

        if (function_exists('apache_request_headers')) {
            $headers = apache_request_headers();

            foreach ($headers as $name => $value) {
                if (strcasecmp((string) $name, 'Authorization') === 0 && is_string($value)) {
                    $candidates[] = $value;
                }
            }
        }

        foreach ($candidates as $candidate) {
            if (preg_match('/^Bearer\s+(\S+)$/i', trim($candidate), $m) === 1) {
                return $m[1];
            }
        }

        return null;
    }
}
