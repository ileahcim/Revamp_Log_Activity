<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Helpers\ApiResponse;
use App\Helpers\Audit;
use App\Helpers\NikAllowlist;
use App\Helpers\NikGuard;
use App\Helpers\RegistrationPolicy;
use App\Helpers\RegistrationStore;
use App\Helpers\Transformer;
use App\Helpers\Validator;
use App\Models\MasterModel;
use App\Models\UserModel;
use PDOException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Pintu masuk sistem, dikelola admin.
 *
 * Dua hal yang bersebelahan dan sengaja disatukan di sini:
 *
 *   ANTREAN PENDAFTARAN  siapa yang sudah mendaftar dan menunggu persetujuan
 *   DAFTAR IZIN NIK      siapa yang BOLEH mendaftar padahal tidak punya jejak
 *                        di tech_logs
 *
 * Keduanya menjawab pertanyaan yang sama -- siapa yang boleh masuk -- dan
 * memisahkannya ke dua controller hanya akan menyebarkan satu konsep ke dua
 * tempat.
 *
 * Seluruh endpoint di sini khusus admin, dijaga RoleMiddleware di routes/api.php.
 */
final class RegistrationController
{
    private const ROLES = ['admin', 'atasan', 'karyawan'];

    public function __construct(
        private RegistrationStore $registrations,
        private NikAllowlist $allowlist,
        private RegistrationPolicy $policy,
        private UserModel $users,
        private MasterModel $master,
        private Audit $audit
    ) {
    }

    // =======================================================================
    // Antrean pendaftaran
    // =======================================================================

    /**
     * GET /api/registrations?status=pending|rejected
     *
     * Default pending -- itu yang perlu ditindaklanjuti. Yang ditolak dibaca
     * hanya kalau admin ingin membuka kembali salah satunya.
     */
    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $status = strtolower(trim((string) ($request->getQueryParams()['status'] ?? 'pending')));

        if (!in_array($status, ['pending', 'rejected'], true)) {
            return ApiResponse::error(
                $response,
                'Parameter "status" hanya boleh "pending" atau "rejected".',
                422,
                ['status' => 'Harus "pending" atau "rejected".']
            );
        }

        $baris = $status === 'pending' ? $this->registrations->pending() : $this->registrations->rejected();

        // Permintaan yang pemiliknya ternyata sudah punya baris users
        // disembunyikan. Ini bisa terjadi kalau penghapusan dari antrean gagal
        // tepat setelah barisnya dibuat; menampilkannya hanya akan membuat
        // admin menyetujui sesuatu yang sudah aktif.
        if ($status === 'pending') {
            $baris = array_values(array_filter(
                $baris,
                fn (array $b): bool => $this->users->findById((string) ($b['uid'] ?? '')) === null
            ));
        }

        return ApiResponse::success(
            $response,
            $this->tandaiNik(array_map([$this, 'tampilkan'], $baris)),
            null,
            200,
            ['total' => count($baris), 'status' => $status]
        );
    }

    /**
     * Menempelkan hasil pemeriksaan NIK ke tiap baris antrean.
     *
     * Khusus untuk mata admin. Endpoint ini dijaga RoleMiddleware admin, dan
     * balasan untuk pendaftar sendiri (GET /api/auth/status) tidak melewati
     * method ini sama sekali -- yang di sana tetap tidak menyebut apa pun
     * tentang NIK atau orang lain. Perbedaan itu disengaja: pendaftar yang
     * diberi tahu "NIK itu milik Budi" berarti formulir pendaftaran berubah
     * jadi alat memanen data karyawan.
     *
     * Kenapa perlu: dengan REGISTRATION_REQUIRE_KNOWN_NIK=false, NIK apa pun
     * yang belum terpakai bisa masuk antrean -- termasuk salah ketik, dan
     * termasuk NIK milik teknisi lama yang belum pernah login sehingga belum
     * punya baris users untuk menghalanginya. Yang dulu disaring Lapis 1
     * sekarang disaring mata admin, dan mata itu perlu diberi tahu apa yang
     * sedang dilihatnya.
     *
     * Tiga jawaban, masing-masing berdiri sendiri:
     *
     *   taken_by   NIK sudah dipakai user aktif. Menyetujuinya akan gagal --
     *              users.nik UNIQUE -- jadi ini nyaris selalu berarti tolak.
     *              Bisa terjadi walau pendaftarannya dulu lolos: jarak antara
     *              mendaftar dan disetujui bisa berhari-hari, dan NIK bisa
     *              berpindah lewat User Management dalam rentang itu.
     *   queued_by  NIK yang sama sedang diantre pendaftar lain. Yang disetujui
     *              duluan menang; yang kedua akan gagal.
     *   known      Ada jejaknya di tech_logs atau di daftar izin NIK. false
     *              berarti sistem tidak punya catatan apa pun atas NIK ini --
     *              persis yang dulu ditolak Lapis 1.
     *
     * Biayanya dua query per baris. Antrean persetujuan berisi satuan baris,
     * bukan ratusan, jadi ini ditukar dengan sengaja: menggabungkannya jadi
     * satu query akan membuat method ini menyusun SQL sendiri, sesuatu yang
     * seharusnya tinggal di Models.
     *
     * @param  list<array<string, mixed>> $rows hasil tampilkan()
     * @return list<array<string, mixed>>
     */
    private function tandaiNik(array $rows): array
    {
        // Antrean tunggu selalu jadi pembanding, termasuk saat yang dibuka
        // daftar "pernah ditolak": NIK-nya bisa saja sudah diantre orang lain
        // sejak penolakan itu, dan itu justru perlu diketahui sebelum tombol
        // "Boleh Daftar Lagi" ditekan.
        $antrean = $this->registrations->pending();

        foreach ($rows as $i => $baris) {
            $nik = trim((string) ($baris['nik'] ?? ''));

            $rows[$i]['nik_check'] = [
                'taken_by'  => $this->pemilikNik($nik),
                'queued_by' => $this->pengantreLain($nik, (string) ($baris['uid'] ?? ''), $antrean),
                'known'     => $this->policy->nikDikenal($nik),
            ];
        }

        return $rows;
    }

    /**
     * User aktif yang sudah memakai NIK ini.
     *
     * Hanya nama, email, dan role yang ikut -- cukup untuk admin mengenali
     * siapa, tanpa mengirim seluruh baris user ke layar yang tidak
     * membutuhkannya.
     *
     * @return array{name: string, email: string, role: string}|null
     */
    private function pemilikNik(string $nik): ?array
    {
        if ($nik === '') {
            return null;
        }

        $user = $this->users->findByNik($nik);

        if ($user === null) {
            return null;
        }

        return [
            'name'  => (string) ($user['name'] ?? ''),
            'email' => (string) ($user['email'] ?? ''),
            'role'  => (string) ($user['role'] ?? ''),
        ];
    }

    /**
     * Pendaftar LAIN di antrean yang memakai NIK sama.
     *
     * Dirinya sendiri tidak dihitung, kalau tidak setiap baris akan menuduh
     * dirinya kembar. Dibandingkan setelah trim dan huruf kecil, sepadan
     * dengan cara RegistrationStore menyimpan dan mencocokkan NIK.
     *
     * @param  list<array<string, mixed>> $antrean
     * @return list<array{name: string, email: string}>
     */
    private function pengantreLain(string $nik, string $uid, array $antrean): array
    {
        if ($nik === '') {
            return [];
        }

        $kunci = mb_strtolower($nik);
        $lain  = [];

        foreach ($antrean as $baris) {
            $uidLain = (string) ($baris['uid'] ?? '');

            if ($uidLain === '' || $uidLain === $uid) {
                continue;
            }

            if (mb_strtolower(trim((string) ($baris['nik'] ?? ''))) !== $kunci) {
                continue;
            }

            $lain[] = [
                'name'  => (string) ($baris['name'] ?? ''),
                'email' => (string) ($baris['email'] ?? ''),
            ];
        }

        return $lain;
    }

    /**
     * POST /api/registrations/{uid}/approve
     *
     * Body opsional: { "role": "atasan" }. Tanpa itu, rolenya 'karyawan'.
     * Pilihan role di sini penting untuk atasan baru: tanpa itu, admin harus
     * menyetujui dulu lalu mengubah rolenya lewat menu lain.
     *
     * Seluruh pemeriksaan dijalankan ULANG di sini, tidak mengandalkan yang
     * sudah lolos saat pendaftaran. Jarak antara mendaftar dan disetujui bisa
     * berhari-hari, dan dalam rentang itu NIK-nya bisa saja sudah dipakai orang
     * lain atau divisinya dinonaktifkan.
     */
    public function approve(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $uid = (string) ($args['uid'] ?? '');

        $permintaan = $this->registrations->findPending($uid);

        if ($permintaan === null) {
            return ApiResponse::error($response, 'Permintaan pendaftaran tidak ditemukan.', 404);
        }

        // Sudah punya baris users -- sisa antrean yang tidak sempat terhapus.
        // Dibersihkan sekalian supaya tidak muncul lagi besok.
        if ($this->users->findById($uid) !== null) {
            $this->registrations->remove($uid);

            return ApiResponse::error($response, 'Akun ini sudah terdaftar.', 409);
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->in('role', self::ROLES, 'Role');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $role   = (string) $v->string('role', 'karyawan');
        $nama   = (string) ($permintaan['name'] ?? '');
        $nik    = (string) ($permintaan['nik'] ?? '');
        $email  = (string) ($permintaan['email'] ?? '');
        $divisi = (string) ($permintaan['divisi'] ?? '');

        $divisionId = $this->master->divisionIdByName($divisi);

        if ($divisionId === null) {
            return ApiResponse::error(
                $response,
                sprintf(
                    'Divisi "%s" yang dipilih pendaftar sudah tidak ada dalam daftar.'
                        . ' Aktifkan kembali divisi itu, atau tolak pendaftaran ini dan minta yang bersangkutan'
                        . ' mendaftar ulang dengan divisi yang tersedia: %s.',
                    $divisi,
                    implode(', ', $this->master->divisionNames())
                ),
                422,
                ['divisi' => 'Divisi tidak dikenal.']
            );
        }

        // Pemilik NIK boleh disebut di sini: yang membaca sudah dipastikan
        // admin oleh RoleMiddleware. Justru ini yang dibutuhkan admin untuk
        // memutuskan -- "sudah dipakai" saja tidak memberi tahu oleh siapa.
        $bentrokNik = NikGuard::conflict($this->users, $nik, null, true);

        if ($bentrokNik !== null) {
            return ApiResponse::error($response, $bentrokNik, 422, NikGuard::FIELD_ERRORS);
        }

        if ($this->users->findByEmail($email) !== null) {
            return ApiResponse::error(
                $response,
                'Email pendaftar ini sudah dipakai akun lain di tabel users.',
                409
            );
        }

        try {
            $this->users->create([
                'id'          => $uid,
                'email'       => $email,
                'nik'         => $nik,
                'name'        => $nama,
                'division_id' => $divisionId,
                'role'        => $role,
            ]);
        } catch (PDOException $e) {
            $bentrok = NikGuard::duplicateColumn($e);

            if ($bentrok === 'nik') {
                return ApiResponse::error($response, NikGuard::message($nik), 422, NikGuard::FIELD_ERRORS);
            }

            if ($bentrok === 'email') {
                return ApiResponse::error($response, 'Email pendaftar ini sudah dipakai akun lain.', 409);
            }

            throw $e;
        }

        // Baru dikeluarkan dari antrean SETELAH barisnya jadi. Kalau urutannya
        // dibalik dan pembuatan baris gagal, permintaannya hilang dari antrean
        // tanpa pernah menjadi user -- dan pendaftarnya tidak punya cara
        // mengulang, karena dia sudah tercatat pernah mendaftar.
        $this->registrations->remove($uid);

        $tercatat = $this->audit->record(
            $pelaku,
            'Menyetujui pendaftaran',
            sprintf('%s (NIK %s, %s) disetujui sebagai %s. Divisi: %s.', $nama, $nik, $email, $role, $divisi)
        );

        $dibuat = $this->users->findById($uid);

        return ApiResponse::success(
            $response,
            $dibuat === null ? null : Transformer::user($dibuat),
            Audit::pesan(sprintf('Pendaftaran %s disetujui sebagai %s.', $nama, $role), $tercatat)
        );
    }

    /**
     * POST /api/registrations/{uid}/reject
     *
     * Body opsional: { "reason": "..." }. Alasannya ikut ditampilkan kepada
     * yang ditolak, jadi sebaiknya diisi.
     *
     * Yang ditolak disimpan, bukan dihapus -- kalau dihapus, orangnya bisa
     * mendaftar ulang berkali-kali dan antrean tidak ada habisnya.
     */
    public function reject(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $uid = (string) ($args['uid'] ?? '');

        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->max('reason', 500, 'Alasan');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        $tolakan = $this->registrations->reject($uid, $pelaku, $v->string('reason'));

        if ($tolakan === null) {
            return ApiResponse::error($response, 'Permintaan pendaftaran tidak ditemukan.', 404);
        }

        $tercatat = $this->audit->record(
            $pelaku,
            'Menolak pendaftaran',
            sprintf(
                '%s (NIK %s, %s) ditolak. Alasan: %s',
                (string) ($tolakan['name'] ?? '-'),
                (string) ($tolakan['nik'] ?? '-'),
                (string) ($tolakan['email'] ?? '-'),
                $tolakan['reason'] === null || $tolakan['reason'] === '' ? 'tidak disebutkan' : (string) $tolakan['reason']
            )
        );

        return ApiResponse::success(
            $response,
            $this->tampilkan($tolakan),
            Audit::pesan(
                sprintf('Pendaftaran %s ditolak.', (string) ($tolakan['name'] ?? '-')),
                $tercatat
            )
        );
    }

    /**
     * DELETE /api/registrations/{uid}
     *
     * Hapus catatan penolakan supaya orangnya boleh mendaftar lagi. Dipakai
     * kalau penolakan sebelumnya keliru, atau keadaannya sudah berubah.
     */
    public function forget(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $uid = (string) ($args['uid'] ?? '');

        $tolakan = $this->registrations->forget($uid);

        if ($tolakan === null) {
            return ApiResponse::error($response, 'Catatan penolakan tidak ditemukan.', 404);
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        $tercatat = $this->audit->record(
            $pelaku,
            'Membuka kembali pendaftaran yang ditolak',
            sprintf(
                '%s (NIK %s, %s) boleh mendaftar lagi.',
                (string) ($tolakan['name'] ?? '-'),
                (string) ($tolakan['nik'] ?? '-'),
                (string) ($tolakan['email'] ?? '-')
            )
        );

        return ApiResponse::success(
            $response,
            null,
            Audit::pesan(
                sprintf('%s sekarang boleh mendaftar lagi.', (string) ($tolakan['name'] ?? '-')),
                $tercatat
            )
        );
    }

    // =======================================================================
    // Daftar izin NIK
    // =======================================================================

    /** GET /api/allowed-niks */
    public function allowedNiks(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $daftar = $this->allowlist->all();

        return ApiResponse::success($response, $daftar, null, 200, ['total' => count($daftar)]);
    }

    /**
     * POST /api/allowed-niks
     *
     * Body: { "nik": "90001", "note": "Atasan baru divisi Produksi" }
     *
     * Yang diberikan hanya izin MENDAFTAR. Orangnya tetap mengisi formulir
     * sendiri dengan Akun Google-nya, dan pendaftarannya tetap masuk antrean
     * persetujuan seperti yang lain.
     */
    public function addAllowedNik(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $request->getParsedBody();
        $body = is_array($body) ? $body : [];

        $v = new Validator($body);
        $v->required('nik', 'NIK')->max('nik', 50, 'NIK')->max('note', 255, 'Catatan');

        if ($v->fails()) {
            return ApiResponse::error($response, $v->firstError(), 422, $v->errors());
        }

        $nik = (string) $v->string('nik');

        if (mb_strtolower($nik) === mb_strtolower($this->policy->legacyNik())) {
            return ApiResponse::error(
                $response,
                'NIK akun penampung data lama tidak boleh diizinkan mendaftar.',
                422,
                ['nik' => 'NIK ini dipakai akun penampung.']
            );
        }

        if ($this->allowlist->contains($nik)) {
            return ApiResponse::error($response, sprintf('NIK %s sudah ada di daftar izin.', $nik), 409);
        }

        $pemilik = $this->users->findByNik($nik);

        if ($pemilik !== null) {
            return ApiResponse::error(
                $response,
                sprintf(
                    'NIK %s sudah dipakai %s, jadi tidak ada gunanya diizinkan mendaftar.',
                    $nik,
                    (string) $pemilik['name']
                ),
                409
            );
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        $baris = $this->allowlist->add($nik, $v->string('note'), $pelaku);

        $tercatat = $this->audit->record(
            $pelaku,
            'Menambahkan NIK ke daftar izin',
            sprintf('NIK %s diizinkan mendaftar. Catatan: %s', $nik, $v->string('note') ?? 'tidak ada')
        );

        return ApiResponse::created(
            $response,
            $baris,
            Audit::pesan(
                sprintf('NIK %s sekarang boleh dipakai mendaftar. Persetujuan admin tetap diperlukan.', $nik),
                $tercatat
            )
        );
    }

    /** DELETE /api/allowed-niks/{nik} */
    public function removeAllowedNik(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        // rawurldecode dengan alasan yang sama seperti di SuperAdminController:
        // Slim mencocokkan path mentah, jadi NIK yang memuat spasi sampai ke
        // sini sebagai "%20" dan tidak akan pernah ketemu di daftar.
        $nik = trim(rawurldecode((string) ($args['nik'] ?? '')));

        $baris = $this->allowlist->remove($nik);

        if ($baris === null) {
            return ApiResponse::error($response, sprintf('NIK %s tidak ada di daftar izin.', $nik), 404);
        }

        /** @var array<string, mixed> $pelaku */
        $pelaku = $request->getAttribute('user');

        $tercatat = $this->audit->record(
            $pelaku,
            'Menghapus NIK dari daftar izin',
            sprintf('NIK %s tidak lagi diizinkan mendaftar.', $nik)
        );

        return ApiResponse::success(
            $response,
            null,
            Audit::pesan(
                sprintf(
                    'NIK %s dikeluarkan dari daftar izin. User yang terlanjur mendaftar dengan NIK ini tidak terpengaruh.',
                    $nik
                ),
                $tercatat
            )
        );
    }

    // -----------------------------------------------------------------------

    /**
     * Bentuk satu baris antrean untuk admin.
     *
     * @param array<string, mixed> $baris
     * @return array<string, mixed>
     */
    private function tampilkan(array $baris): array
    {
        $hasil = [
            'uid'          => (string) ($baris['uid'] ?? ''),
            'email'        => (string) ($baris['email'] ?? ''),
            'name'         => (string) ($baris['name'] ?? ''),
            'nik'          => (string) ($baris['nik'] ?? ''),
            'divisi'       => (string) ($baris['divisi'] ?? ''),
            'requested_at' => $baris['requested_at'] ?? null,
        ];

        // Hanya ada pada baris yang sudah ditolak.
        foreach (['rejected_at', 'rejected_by_email', 'reason'] as $kolom) {
            if (array_key_exists($kolom, $baris)) {
                $hasil[$kolom] = $baris[$kolom];
            }
        }

        return $hasil;
    }
}
