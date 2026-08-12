<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Helpers\Pagination;
use App\Helpers\Transformer;
use App\Helpers\Uuid;
use App\Helpers\Validator;
use App\Models\BugReportModel;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Endpoint untuk tabel tech_bug_reports.
 *
 * Hak aksesnya lebih ketat daripada tech_logs: di sini hanya **admin** yang
 * melihat laporan orang lain, atasan tidak. Itu menyalin BugReportModal.tsx:26,
 * yang mengambil seluruh laporan hanya ketika role-nya admin dan selain itu
 * menyaring ke user yang sedang login.
 *
 * Gambar hanya ikut di endpoint detail. Isinya data URL hasil kompresi di
 * browser, ratusan KB per baris -- kalau ikut di endpoint daftar, satu halaman
 * berisi puluhan laporan bisa jadi belasan MB dan halaman admin terasa macet.
 */
final class BugReportController
{
    private const STATUSES = ['Open', 'In Progress', 'Resolved'];

    /**
     * Batas panjang data URL gambar.
     *
     * BugReportModal menolak berkas di atas 5 MB lalu mengecilkannya ke lebar
     * 800px kualitas 0.7, jadi hasil normalnya jauh di bawah angka ini. Batas
     * ini ada untuk menahan kiriman yang tidak lewat form: kolomnya LONGTEXT
     * dan MySQL akan memutus koneksi kalau paketnya melebihi max_allowed_packet.
     */
    private const MAX_IMAGE = 5_000_000;

    public function __construct(private BugReportModel $reports)
    {
    }

    /**
     * GET /api/bug-reports
     *
     * Query string: status, user_id (admin), search, limit, offset.
     * Gambar tidak ikut.
     */
    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        $query = $request->getQueryParams();

        $v = new Validator($query);
        $v->in('status', self::STATUSES, 'Status');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $filters = [
            'status'  => $v->string('status'),
            'user_id' => $v->string('user_id'),
            'search'  => $v->string('search'),
        ];

        // Dipasang paling akhir supaya menimpa user_id dari query string, bukan
        // sekadar menambah -- selain admin tidak bisa mengintip laporan lain.
        if (!$this->isAdmin($user)) {
            $filters['user_id'] = (string) $user['id'];
        }

        $limit  = Pagination::limit($query['limit'] ?? null);
        $offset = Pagination::offset($query['offset'] ?? null);

        $rows  = $this->reports->all($filters, $limit, $offset);
        $total = $this->reports->countAll($filters);

        return ApiResponse::success(
            $response,
            array_map(static fn (array $row): array => Transformer::bugReport($row), $rows),
            null,
            200,
            Pagination::meta($total, $limit, $offset, count($rows))
        );
    }

    /** GET /api/bug-reports/{id} — lengkap dengan gambarnya. */
    public function show(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $report = $this->reports->findById((string) ($args['id'] ?? ''));

        if ($report === null) {
            return ApiResponse::error($response, 'Laporan tidak ditemukan.', 404);
        }

        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        if (!$this->isAdmin($user) && (string) $report['user_id'] !== (string) $user['id']) {
            return ApiResponse::error($response, 'Ini bukan laporan milik Anda.', 403);
        }

        return ApiResponse::success($response, Transformer::bugReport($report, true));
    }

    /** POST /api/bug-reports */
    public function store(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->required('title', 'Judul')->max('title', 255, 'Judul')
          ->required('description', 'Deskripsi')->max('description', 65535, 'Deskripsi')
          ->max('imageBase64', self::MAX_IMAGE, 'Gambar');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $id = Uuid::v4();

        $this->reports->insert([
            'id' => $id,
            // Pelapor selalu pemilik token. userId, userName, dan role yang
            // dikirim BugReportModal diabaikan -- ketiganya sudah ada di tabel
            // users dan diambil lewat JOIN saat dibaca.
            'user_id'      => (string) $user['id'],
            'title'        => (string) $v->string('title'),
            'description'  => (string) $v->string('description'),
            'image_base64' => $v->string('imageBase64'),
            'status'       => 'Open',
        ]);

        $dibuat = $this->reports->findById($id);

        return ApiResponse::created(
            $response,
            $dibuat === null ? null : Transformer::bugReport($dibuat, true),
            'Laporan berhasil dikirim. Terima kasih.'
        );
    }

    /** PATCH /api/bug-reports/{id} — khusus admin, hanya mengubah status. */
    public function updateStatus(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id     = (string) ($args['id'] ?? '');
        $report = $this->reports->findById($id);

        if ($report === null) {
            return ApiResponse::error($response, 'Laporan tidak ditemukan.', 404);
        }

        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->required('status', 'Status')->in('status', self::STATUSES, 'Status');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $this->reports->updateStatus($id, (string) $v->string('status'));

        $terbaru = $this->reports->findById($id);

        return ApiResponse::success(
            $response,
            $terbaru === null ? null : Transformer::bugReport($terbaru, true),
            'Status laporan diperbarui.'
        );
    }

    /** @param array<string, mixed> $user */
    private function isAdmin(array $user): bool
    {
        return (string) $user['role'] === 'admin';
    }
}
