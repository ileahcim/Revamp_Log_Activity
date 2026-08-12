<?php

declare(strict_types=1);

namespace App\Helpers;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * Pembentuk response JSON.
 *
 * Bentuk response selalu sama supaya frontend cukup mengecek satu field:
 *
 *     { "success": true,  "data": ..., "message": null }
 *     { "success": false, "data": null, "message": "..." }
 *
 * Endpoint daftar boleh menambah "meta" untuk info pagination. Field "data"
 * pada endpoint daftar tetap berupa array, jadi frontend tidak perlu berubah.
 */
final class ApiResponse
{
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

    public static function success(
        ResponseInterface $response,
        mixed $data = null,
        ?string $message = null,
        int $status = 200,
        ?array $meta = null
    ): ResponseInterface {
        return self::write($response, [
            'success' => true,
            'data'    => $data,
            'message' => $message,
        ], $status, $meta);
    }

    public static function created(
        ResponseInterface $response,
        mixed $data = null,
        ?string $message = null
    ): ResponseInterface {
        return self::success($response, $data, $message, 201);
    }

    /**
     * @param array<string, string>|null $errors daftar error per field
     */
    public static function error(
        ResponseInterface $response,
        string $message,
        int $status = 400,
        ?array $errors = null
    ): ResponseInterface {
        $payload = [
            'success' => false,
            'data'    => null,
            'message' => $message,
        ];

        if ($errors !== null && $errors !== []) {
            $payload['errors'] = $errors;
        }

        return self::write($response, $payload, $status);
    }

    /**
     * Versi untuk middleware, yang belum memegang objek response.
     *
     * @param array<string, string>|null $errors
     */
    public static function errorFrom(
        ResponseFactoryInterface $factory,
        string $message,
        int $status = 400,
        ?array $errors = null
    ): ResponseInterface {
        return self::error($factory->createResponse($status), $message, $status, $errors);
    }

    private static function write(
        ResponseInterface $response,
        array $payload,
        int $status,
        ?array $meta = null
    ): ResponseInterface {
        if ($meta !== null) {
            $payload['meta'] = $meta;
        }

        $json = json_encode($payload, self::JSON_FLAGS);

        if ($json === false) {
            $json = json_encode([
                'success' => false,
                'data'    => null,
                'message' => 'Gagal menyusun response JSON.',
            ], self::JSON_FLAGS);
        }

        $response->getBody()->write((string) $json);

        return $response
            ->withHeader('Content-Type', 'application/json; charset=utf-8')
            ->withStatus($status);
    }
}
