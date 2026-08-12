<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Helpers\Pagination;
use App\Helpers\Transformer;
use App\Helpers\Uuid;
use App\Helpers\Validator;
use App\Models\MasterModel;
use App\Models\TechLogModel;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Endpoint untuk tabel tech_logs.
 *
 * Aturan hak akses mengikuti apa yang sudah berjalan di React, tapi sekarang
 * ditegakkan di server juga -- yang di browser hanya menyembunyikan tombol,
 * dan itu tidak menghalangi siapa pun memanggil endpoint langsung:
 *
 *   karyawan       hanya melihat log miliknya sendiri (ActivityList.tsx:130),
 *                  dan hanya boleh mengubah/menghapus log bertanggal hari ini
 *                  (canModify di ActivityList.tsx:157)
 *   atasan & admin melihat seluruh log dan boleh mengubah kapan saja
 *
 * Dua nilai tidak pernah diambil dari body request:
 *
 *   id                dibuat server sebagai UUID; kolomnya CHAR(36), sedangkan
 *                     frontend lama mengirim 7 karakter acak yang bisa bentrok
 *   duration_minutes  dihitung ulang dari start_time dan finish_time
 */
final class TechLogController
{
    private const SHIFTS   = ['Pagi', 'Siang', 'Malam'];
    private const STATUSES = ['Done', 'Ongoing', 'Hold', '-'];

    public function __construct(
        private TechLogModel $logs,
        private MasterModel $master
    ) {
    }

    /**
     * GET /api/tech-logs
     *
     * Query string yang didukung:
     *   start_date, end_date  rentang kolom tanggal, format YYYY-MM-DD
     *   nik                   NIK snapshot pada log
     *   user_id               pemilik baris
     *   status                Done | Ongoing | Hold | -
     *   kategori_code         P1, D2, B, ...
     *   shift                 Pagi | Siang | Malam
     *   supervisor            nama persis
     *   search                cari di deskripsi, nama, WO, asset tag, SN, party
     *   limit, offset         lihat meta.has_more untuk tahu masih ada sisa
     */
    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        $query = $request->getQueryParams();

        $v = new Validator($query);
        $v->date('start_date', 'Tanggal awal')
          ->date('end_date', 'Tanggal akhir')
          ->in('status', self::STATUSES, 'Status')
          ->in('shift', self::SHIFTS, 'Shift');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $filters = [
            'start_date'    => $v->string('start_date'),
            'end_date'      => $v->string('end_date'),
            'nik'           => $v->string('nik'),
            'user_id'       => $v->string('user_id'),
            'status'        => $v->string('status'),
            'kategori_code' => $v->string('kategori_code'),
            'shift'         => $v->string('shift'),
            'supervisor'    => $v->string('supervisor'),
            'search'        => $v->string('search'),
        ];

        // Batas ini ditambahkan setelah filter dari query string, dan digabung
        // dengan AND, jadi karyawan tidak bisa melebarkan jangkauannya sendiri
        // lewat parameter user_id atau nik.
        if ((string) $user['role'] === 'karyawan') {
            $filters['owner'] = [
                'uid'  => (string) $user['id'],
                'nik'  => (string) $user['nik'],
                'name' => (string) $user['name'],
            ];
        }

        $limit  = Pagination::limit($query['limit'] ?? null);
        $offset = Pagination::offset($query['offset'] ?? null);

        $rows  = $this->logs->all($filters, $limit, $offset);
        $total = $this->logs->countAll($filters);

        return ApiResponse::success(
            $response,
            array_map([Transformer::class, 'techLog'], $rows),
            null,
            200,
            Pagination::meta($total, $limit, $offset, count($rows))
        );
    }

    /** GET /api/tech-logs/{id} */
    public function show(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $log = $this->logs->findById((string) ($args['id'] ?? ''));

        if ($log === null) {
            return ApiResponse::error($response, 'Aktivitas tidak ditemukan.', 404);
        }

        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        if (!$this->mayRead($log, $user)) {
            return ApiResponse::error($response, 'Ini bukan aktivitas milik Anda.', 403);
        }

        return ApiResponse::success($response, Transformer::techLog($log));
    }

    /** POST /api/tech-logs */
    public function store(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        $v = $this->validate($this->body($request));

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $unknown = $this->unknownCode($v);

        if ($unknown !== null) {
            return ApiResponse::error($response, $unknown[0], 422, $unknown[1]);
        }

        if (!$this->mayUseDate($user, (string) $v->string('tanggal'))) {
            return ApiResponse::error($response, $this->dateRule(), 403);
        }

        $row = $this->columns($v);

        $row['id'] = Uuid::v4();

        // Pemilik baris adalah orang yang menekan tombol simpan, satu-satunya
        // identitas yang bisa dibuktikan server lewat token. Kolom snapshot
        // (display_name, nik_snapshot) tetap apa adanya dari form, karena
        // atasan dan admin memang mencatatkan pekerjaan teknisi lain di sana.
        $row['user_id'] = (string) $user['id'];

        $this->logs->insert($row);

        $created = $this->logs->findById($row['id']);

        return ApiResponse::created(
            $response,
            $created === null ? null : Transformer::techLog($created),
            'Aktivitas berhasil disimpan.'
        );
    }

    /** PUT /api/tech-logs/{id} */
    public function update(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id  = (string) ($args['id'] ?? '');
        $log = $this->logs->findById($id);

        if ($log === null) {
            return ApiResponse::error($response, 'Aktivitas tidak ditemukan.', 404);
        }

        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        $tolak = $this->modifyRefusal($log, $user, 'mengubah');

        if ($tolak !== null) {
            return ApiResponse::error($response, $tolak, 403);
        }

        $v = $this->validate($this->body($request));

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $unknown = $this->unknownCode($v);

        if ($unknown !== null) {
            return ApiResponse::error($response, $unknown[0], 422, $unknown[1]);
        }

        // Karyawan tidak boleh memindahkan log ke tanggal lain, termasuk ke
        // masa lalu -- kalau boleh, aturan "hanya hari ini" jadi tidak berarti.
        if (!$this->mayUseDate($user, (string) $v->string('tanggal'))) {
            return ApiResponse::error($response, $this->dateRule(), 403);
        }

        $this->logs->update($id, $this->columns($v));

        $updated = $this->logs->findById($id);

        return ApiResponse::success(
            $response,
            $updated === null ? null : Transformer::techLog($updated),
            'Aktivitas berhasil diperbarui.'
        );
    }

    /** DELETE /api/tech-logs/{id} */
    public function destroy(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id  = (string) ($args['id'] ?? '');
        $log = $this->logs->findById($id);

        if ($log === null) {
            return ApiResponse::error($response, 'Aktivitas tidak ditemukan.', 404);
        }

        /** @var array<string, mixed> $user */
        $user = $request->getAttribute('user');

        $tolak = $this->modifyRefusal($log, $user, 'menghapus');

        if ($tolak !== null) {
            return ApiResponse::error($response, $tolak, 403);
        }

        $this->logs->delete($id);

        return ApiResponse::success($response, ['id' => $id], 'Aktivitas berhasil dihapus.');
    }

    // -----------------------------------------------------------------------
    // Hak akses
    // -----------------------------------------------------------------------

    /**
     * @param array<string, mixed> $log
     * @param array<string, mixed> $user
     */
    private function mayRead(array $log, array $user): bool
    {
        return $this->isPengawas($user) || $this->owns($log, $user);
    }

    /**
     * Alasan penolakan, atau null kalau boleh.
     *
     * @param array<string, mixed> $log
     * @param array<string, mixed> $user
     */
    private function modifyRefusal(array $log, array $user, string $tindakan): ?string
    {
        if ($this->isPengawas($user)) {
            return null;
        }

        if (!$this->owns($log, $user)) {
            return sprintf('Anda hanya bisa %s aktivitas milik sendiri.', $tindakan);
        }

        if ((string) $log['tanggal'] !== $this->today()) {
            return sprintf(
                'Aktivitas tanggal %s sudah tidak bisa diubah. Karyawan hanya bisa %s data hari ini.',
                (string) $log['tanggal'],
                $tindakan
            );
        }

        return null;
    }

    /**
     * Kepemilikan dicoba lewat tiga jalur, sama seperti di ActivityList.tsx.
     * Data hasil migrasi tidak seragam: sebagian baris punya user_id yang benar,
     * sebagian hanya bisa dikenali lewat NIK, dan yang paling lama tinggal nama.
     *
     * @param array<string, mixed> $log
     * @param array<string, mixed> $user
     */
    private function owns(array $log, array $user): bool
    {
        if ((string) $log['user_id'] === (string) $user['id']) {
            return true;
        }

        $nik = (string) $log['nik_snapshot'];

        if ($nik !== '' && $nik === (string) $user['nik']) {
            return true;
        }

        return mb_strtolower((string) $log['display_name']) === mb_strtolower((string) $user['name']);
    }

    /** @param array<string, mixed> $user */
    private function isPengawas(array $user): bool
    {
        return in_array((string) $user['role'], ['admin', 'atasan'], true);
    }

    /** @param array<string, mixed> $user */
    private function mayUseDate(array $user, string $tanggal): bool
    {
        return $this->isPengawas($user) || $tanggal === $this->today();
    }

    private function dateRule(): string
    {
        return sprintf(
            'Karyawan hanya bisa mencatat aktivitas untuk hari ini (%s). Hubungi atasan untuk tanggal lain.',
            $this->today()
        );
    }

    /** Tanggal hari ini menurut APP_TIMEZONE, bukan menurut jam server. */
    private function today(): string
    {
        return date('Y-m-d');
    }

    // -----------------------------------------------------------------------
    // Pemeriksaan isi
    // -----------------------------------------------------------------------

    /** @param array<string, mixed> $body */
    private function validate(array $body): Validator
    {
        $v = new Validator($body);

        $v->required('tanggal', 'Tanggal')->date('tanggal', 'Tanggal')
          ->required('nama_technician', 'Nama technician')->max('nama_technician', 150, 'Nama technician')
          ->max('nik', 50, 'NIK')
          ->required('supervisor', 'Supervisor')->max('supervisor', 150, 'Supervisor')
          ->required('shift', 'Shift')->in('shift', self::SHIFTS, 'Shift')
          ->max('wo_notif', 100, 'WO/Notif')
          ->max('asset_tag', 100, 'Asset tag')
          ->max('party', 100, 'Party')
          // Kolomnya TEXT sejak 05_widen_sn.sql -- satu aktivitas boleh memuat
          // banyak serial number sekaligus, dipisah baris baru. Batas 65535
          // adalah kapasitas TEXT, sama seperti deskripsi_pekerjaan dan catatan;
          // dipasang supaya input kelewat panjang ditolak dengan pesan jelas,
          // bukan dipotong diam-diam oleh MySQL.
          ->max('sn', 65535, 'SN')
          ->required('deskripsi_pekerjaan', 'Deskripsi pekerjaan')
          ->max('deskripsi_pekerjaan', 65535, 'Deskripsi pekerjaan')
          ->required('kategori_code', 'Kode kategori')->max('kategori_code', 5, 'Kode kategori')
          ->required('start_time', 'Jam mulai')->time('start_time', 'Jam mulai')
          ->required('finish_time', 'Jam selesai')->time('finish_time', 'Jam selesai')
          ->required('status', 'Status')->in('status', self::STATUSES, 'Status')
          ->max('delay_code', 5, 'Kode delay')
          // DECIMAL(10,2): dua angka di belakang koma, delapan di depan.
          ->numeric('output_qty', 0, 99999999.99, 'Output qty')
          ->max('catatan', 65535, 'Catatan');

        return $v;
    }

    /**
     * kategori_code dan delay_code tidak punya foreign key di schema V1.0, jadi
     * kecocokannya dengan tabel master diperiksa di sini. Tanpa ini, salah ketik
     * satu huruf akan tersimpan dan barisnya hilang dari semua laporan yang
     * mengelompokkan per kategori.
     *
     * @return array{0: string, 1: array<string, string>}|null
     */
    private function unknownCode(Validator $v): ?array
    {
        $kategori = (string) $v->string('kategori_code');

        if (!$this->master->categoryExists($kategori)) {
            return [
                sprintf(
                    'Kode kategori "%s" tidak ada di master. Pilih salah satu: %s.',
                    $kategori,
                    implode(', ', $this->master->categoryCodeList())
                ),
                ['kategori_code' => 'Kode kategori tidak dikenal.'],
            ];
        }

        $delay = $v->string('delay_code');

        if ($delay !== null && !$this->master->delayCodeExists($delay)) {
            return [
                sprintf(
                    'Kode delay "%s" tidak ada di master. Pilih salah satu: %s.',
                    $delay,
                    implode(', ', $this->master->delayCodeList())
                ),
                ['delay_code' => 'Kode delay tidak dikenal.'],
            ];
        }

        return null;
    }

    /**
     * Susun nilai per kolom database. Kuncinya harus persis sama dengan nama
     * placeholder di TechLogModel::insert() dan update().
     *
     * @return array<string, mixed>
     */
    private function columns(Validator $v): array
    {
        $start  = $this->fullTime((string) $v->string('start_time'));
        $finish = $this->fullTime((string) $v->string('finish_time'));

        return [
            'tanggal'             => (string) $v->string('tanggal'),
            'display_name'        => (string) $v->string('nama_technician'),
            // Kolomnya NOT NULL, sementara input NIK di form tidak wajib diisi.
            'nik_snapshot'        => (string) $v->string('nik', ''),
            'supervisor'          => (string) $v->string('supervisor'),
            'shift'               => (string) $v->string('shift'),
            'wo_notif'            => $v->string('wo_notif'),
            'asset_tag'           => $v->string('asset_tag'),
            'party'               => $v->string('party'),
            'sn'                  => $v->string('sn'),
            'deskripsi_pekerjaan' => (string) $v->string('deskripsi_pekerjaan'),
            'kategori_code'       => (string) $v->string('kategori_code'),
            'start_time'          => $start,
            'finish_time'         => $finish,
            'duration_minutes'    => $this->duration($start, $finish),
            'status'              => (string) $v->string('status'),
            'delay_code'          => $v->string('delay_code'),
            'output_qty'          => $v->float('output_qty'),
            'catatan'             => $v->string('catatan'),
        ];
    }

    /** "08:00" -> "08:00:00", supaya tidak bergantung pada tafsir MySQL. */
    private function fullTime(string $time): string
    {
        return strlen($time) === 5 ? $time . ':00' : $time;
    }

    /**
     * Lama pekerjaan dalam menit.
     *
     * Rumusnya disalin dari saveLog() di storage.ts, termasuk penanganan shift
     * malam yang melewati tengah malam. Nilai duration_minutes kiriman frontend
     * diabaikan supaya laporan tidak bisa dipoles dari sisi client.
     */
    private function duration(string $start, string $finish): int
    {
        $awal   = $this->toMinutes($start);
        $akhir  = $this->toMinutes($finish);

        if ($akhir < $awal) {
            $akhir += 24 * 60;
        }

        return $akhir - $awal;
    }

    private function toMinutes(string $time): int
    {
        $parts = explode(':', $time);

        return ((int) ($parts[0] ?? 0)) * 60 + ((int) ($parts[1] ?? 0));
    }

    /** @return array<string, mixed> */
    private function body(ServerRequestInterface $request): array
    {
        $body = $request->getParsedBody();

        return is_array($body) ? $body : [];
    }
}
