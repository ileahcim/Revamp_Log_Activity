<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Helpers\Pagination;
use App\Helpers\Transformer;
use App\Helpers\Uuid;
use App\Helpers\Validator;
use App\Models\AuditLogModel;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Endpoint untuk tabel audit_logs.
 *
 * Membaca hanya untuk admin (tab Audit di AdminPanel), tapi **menulis** terbuka
 * untuk semua user terdaftar. Itu memang perlu: yang dicatat adalah aksi user
 * biasa -- login, logout, menambah dan menghapus log aktivitas -- dan
 * pemanggilnya addAuditLog() di frontend.
 *
 * Yang dicatat sebagai pelaku selalu pemilik token, bukan userId dari body.
 * Kalau body dipercaya, catatan audit bisa diisi atas nama orang lain, dan
 * catatan yang bisa dipalsukan tidak ada gunanya.
 */
final class AuditLogController
{
    public function __construct(private AuditLogModel $logs)
    {
    }

    /**
     * GET /api/audit-logs — khusus admin.
     *
     * Query string: user_id, start_date, end_date, search, limit, offset.
     * AdminPanel memakai 50 baris terbaru: ?limit=50
     */
    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $query = $request->getQueryParams();

        $v = new Validator($query);
        $v->date('start_date', 'Tanggal awal')->date('end_date', 'Tanggal akhir');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $filters = [
            'user_id'    => $v->string('user_id'),
            'start_date' => $v->string('start_date'),
            'end_date'   => $v->string('end_date'),
            'search'     => $v->string('search'),
        ];

        $limit  = Pagination::limit($query['limit'] ?? null);
        $offset = Pagination::offset($query['offset'] ?? null);

        $rows  = $this->logs->all($filters, $limit, $offset);
        $total = $this->logs->countAll($filters);

        return ApiResponse::success(
            $response,
            array_map([Transformer::class, 'auditLog'], $rows),
            null,
            200,
            Pagination::meta($total, $limit, $offset, count($rows))
        );
    }

    /**
     * POST /api/audit-logs
     *
     * Body: { "action": "Menambahkan log aktivitas baru", "description": "..." }
     *
     * action masuk ke VARCHAR(100), jadi keterangan panjang sebaiknya ditaruh di
     * description yang bertipe TEXT.
     */
    public function store(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->required('action', 'Aksi')->max('action', 100, 'Aksi')
          ->max('description', 65535, 'Keterangan');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $this->logs->insert([
            'id'          => Uuid::v4(),
            'user_id'     => (string) $user['id'],
            'action'      => (string) $v->string('action'),
            'description' => $v->string('description'),
        ]);

        return ApiResponse::created($response, null, 'Aksi tercatat.');
    }
}
