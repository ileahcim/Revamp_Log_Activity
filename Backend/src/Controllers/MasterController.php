<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Models\MasterModel;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Endpoint tabel master: divisi, supervisor, kategori, kode delay.
 *
 * Sekarang keempatnya masih ditulis tetap di frontend -- KATEGORI_CODES dan
 * DELAY_CODES di types.ts, OFFICIAL_SUPERVISORS di BatchUpdateModal.tsx, dan
 * daftar divisi sebagai <option> di Login.tsx. Karena disalin di beberapa
 * tempat, isinya sempat berbeda-beda; itulah yang membuat 03_align_master_data.sql
 * perlu ada. Setelah frontend memakai endpoint ini, daftarnya cukup diperbaiki
 * di database.
 *
 * Hanya baris is_active = TRUE yang dikirim. Baris nonaktif tetap sah untuk
 * data lama, tapi tidak lagi ditawarkan sebagai pilihan baru.
 */
final class MasterController
{
    public function __construct(private MasterModel $master)
    {
    }

    /** GET /api/master/divisions */
    public function divisions(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return ApiResponse::success($response, array_map(
            static fn (array $row): array => [
                'id'   => (int) $row['id'],
                'name' => (string) $row['name'],
            ],
            $this->master->divisions()
        ));
    }

    /** GET /api/master/supervisors */
    public function supervisors(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return ApiResponse::success($response, array_map(
            static fn (array $row): array => [
                'id'   => (int) $row['id'],
                'name' => (string) $row['name'],
            ],
            $this->master->supervisors()
        ));
    }

    /**
     * GET /api/master/categories
     *
     * Untuk menggantikan KATEGORI_CODES yang berbentuk Record<string, string>:
     *
     *     const KATEGORI = Object.fromEntries(data.map(k => [k.code, k.name]));
     */
    public function categories(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return ApiResponse::success($response, array_map(
            static fn (array $row): array => [
                'code' => (string) $row['code'],
                'name' => (string) $row['name'],
                // Productive | Delay | Break -- dipakai untuk mengelompokkan di
                // Dashboard tanpa menebak dari awalan kodenya.
                'type' => (string) $row['type'],
            ],
            $this->master->categories()
        ));
    }

    /** GET /api/master/delay-codes */
    public function delayCodes(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return ApiResponse::success($response, array_map(
            static fn (array $row): array => [
                'code'          => (string) $row['code'],
                'name'          => (string) $row['name'],
                'category_code' => (string) $row['category_code'],
            ],
            $this->master->delayCodes()
        ));
    }
}
