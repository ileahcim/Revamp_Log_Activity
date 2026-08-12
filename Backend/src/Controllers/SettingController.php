<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Helpers\Settings;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Sakelar maintenance.
 *
 * Disimpan di berkas JSON, bukan tabel: schema V1.0 dikunci dan tidak punya
 * tabel settings.
 *
 * GET-nya sengaja **tanpa autentikasi**. App.tsx memasang pembacanya di
 * useEffect dengan dependency kosong, artinya berjalan saat aplikasi dimuat --
 * sebelum ada user yang login -- dan layar "Under Maintenance" memang harus
 * tampil di halaman login juga. Yang bocor hanya satu boolean, sama seperti
 * aturan Firestore yang dipakai sekarang.
 */
final class SettingController
{
    public function __construct(private Settings $settings)
    {
    }

    /** GET /api/settings/maintenance — terbuka. */
    public function maintenance(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        // Namanya "active" supaya sama dengan dokumen Firestore yang dibaca
        // App.tsx sekarang: snapshot.data().active
        return ApiResponse::success($response, ['active' => $this->settings->maintenance()]);
    }

    /**
     * PUT /api/settings/maintenance — khusus admin.
     *
     * Body: { "active": true }
     */
    public function setMaintenance(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        if (!array_key_exists('active', $body)) {
            return ApiResponse::error($response, 'Field "active" wajib diisi dengan true atau false.', 422);
        }

        $active = $this->tafsirkanBoolean($body['active']);

        if ($active === null) {
            return ApiResponse::error($response, 'Field "active" harus true atau false.', 422, [
                'active' => 'Harus berupa true atau false.',
            ]);
        }

        $this->settings->setMaintenance($active);

        return ApiResponse::success(
            $response,
            ['active' => $active],
            $active
                ? 'Mode maintenance dinyalakan. Selain admin tidak bisa masuk.'
                : 'Mode maintenance dimatikan.'
        );
    }

    /**
     * Terima true/false, "true"/"false", dan 1/0.
     *
     * Body JSON dari fetch() mengirim boolean asli, tapi form HTML biasa dan
     * curl mengirim string. Nilai lain ditolak, bukan dipaksa jadi false --
     * salah ketik tidak boleh diam-diam berarti "matikan maintenance".
     */
    private function tafsirkanBoolean(mixed $nilai): ?bool
    {
        if (is_bool($nilai)) {
            return $nilai;
        }

        return match (is_scalar($nilai) ? strtolower(trim((string) $nilai)) : null) {
            'true', '1'  => true,
            'false', '0' => false,
            default      => null,
        };
    }
}
