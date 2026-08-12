<?php

declare(strict_types=1);

namespace App\Middleware;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * CORS yang bisa dimatikan lewat .env.
 *
 * Saat development frontend jalan di port Vite yang berbeda, jadi browser
 * butuh header ini. Saat production frontend dan backend satu domain, set
 * CORS_ENABLED=false supaya tidak ada header yang tidak perlu.
 *
 * Middleware ini dipasang paling luar supaya response error pun tetap
 * membawa header CORS -- kalau tidak, browser hanya menampilkan "CORS error"
 * dan pesan asli dari server tidak pernah terlihat.
 */
final class CorsMiddleware implements MiddlewareInterface
{
    private const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    private const ALLOWED_HEADERS = 'Authorization, Content-Type, Accept, X-Requested-With';
    private const MAX_AGE         = '86400';

    /** @param list<string> $allowedOrigins */
    public function __construct(
        private bool $enabled,
        private array $allowedOrigins,
        private ResponseFactoryInterface $responseFactory
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        // Preflight tidak perlu diteruskan ke router; kalau diteruskan justru
        // dijawab 405 karena tidak ada route bermetode OPTIONS.
        $isPreflight = strtoupper($request->getMethod()) === 'OPTIONS';

        $response = $isPreflight
            ? $this->responseFactory->createResponse(204)
            : $handler->handle($request);

        if (!$this->enabled) {
            return $response;
        }

        $origin = $this->resolveOrigin($request->getHeaderLine('Origin'));

        if ($origin === null) {
            return $response;
        }

        $response = $response
            ->withHeader('Access-Control-Allow-Origin', $origin)
            ->withHeader('Access-Control-Allow-Methods', self::ALLOWED_METHODS)
            ->withHeader('Access-Control-Allow-Headers', self::ALLOWED_HEADERS)
            ->withHeader('Access-Control-Max-Age', self::MAX_AGE);

        // Origin yang diizinkan berbeda-beda, jadi cache bersama tidak boleh
        // memakai satu response untuk semua origin.
        if ($origin !== '*') {
            $response = $response->withHeader('Vary', 'Origin');
        }

        return $response;
    }

    private function resolveOrigin(string $requestOrigin): ?string
    {
        if (in_array('*', $this->allowedOrigins, true)) {
            return '*';
        }

        if ($requestOrigin === '') {
            return null;
        }

        return in_array($requestOrigin, $this->allowedOrigins, true) ? $requestOrigin : null;
    }
}
