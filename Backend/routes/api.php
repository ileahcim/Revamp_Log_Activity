<?php

declare(strict_types=1);

/**
 * Daftar seluruh route.
 *
 * Semua endpoint ada di bawah prefix /api. Prefix ini ditulis di sini, bukan
 * lewat setBasePath(), supaya URL-nya sama persis baik saat development
 * (php -S localhost:8080) maupun saat production (folder public_html/api).
 *
 * Susunan middleware per route:
 *
 *     $auth        token wajib sah          -> menempelkan uid + baris user
 *     $terdaftar   wajib punya baris users  -> role apa pun boleh
 *     $admin       wajib punya baris users  -> hanya role admin
 *     $superAdmin  wajib punya baris users  -> emailnya harus super admin
 *
 * $superAdmin sengaja dipasang SENDIRIAN, tidak ditumpuk di atas $admin.
 * Menumpuknya akan membuat super admin yang users.role-nya sempat diubah orang
 * lain ikut tertolak -- padahal justru dialah yang harus bisa membetulkannya.
 */

use App\Config\Env;
use App\Controllers\AuditLogController;
use App\Controllers\AuthController;
use App\Controllers\BugReportController;
use App\Controllers\MasterController;
use App\Controllers\RegistrationController;
use App\Controllers\SettingController;
use App\Controllers\SuperAdminController;
use App\Controllers\TechLogController;
use App\Controllers\UserController;
use App\Helpers\ApiResponse;
use App\Helpers\Audit;
use App\Helpers\FirebaseToken;
use App\Helpers\JsonStore;
use App\Helpers\NikAllowlist;
use App\Helpers\RegistrationPolicy;
use App\Helpers\RegistrationStore;
use App\Helpers\Settings;
use App\Helpers\SuperAdmins;
use App\Middleware\AuthMiddleware;
use App\Middleware\RoleMiddleware;
use App\Middleware\SuperAdminMiddleware;
use App\Models\AuditLogModel;
use App\Models\BugReportModel;
use App\Models\MasterModel;
use App\Models\TechLogModel;
use App\Models\UserModel;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\App;
use Slim\Routing\RouteCollectorProxy;

return static function (App $app, string $appRoot): void {
    $responseFactory = $app->getResponseFactory();

    $users      = new UserModel();
    $master     = new MasterModel();
    $techLogs   = new TechLogModel();
    $bugReports = new BugReportModel();
    $auditLogs  = new AuditLogModel();

    $settings = new Settings($appRoot . '/storage/settings.json');

    // Tiga hal yang tidak punya tempat di schema V1.0 yang dikunci: antrean
    // pendaftaran, daftar izin NIK, dan daftar super admin. Masing-masing satu
    // berkas JSON di storage/. Alasan lengkapnya ada di docblock tiap kelas.
    $registrations = new RegistrationStore(new JsonStore($appRoot . '/storage/registrations.json'));
    $nikAllowlist  = new NikAllowlist(new JsonStore($appRoot . '/storage/allowed-niks.json'));
    $superAdmins   = new SuperAdmins(new JsonStore($appRoot . '/storage/super-admins.json'));

    $policy = new RegistrationPolicy($users, $techLogs, $nikAllowlist, $registrations);
    $audit  = new Audit($auditLogs);

    $auth = new AuthMiddleware(
        new FirebaseToken(
            (string) Env::get('FIREBASE_PROJECT_ID', ''),
            $appRoot . '/storage/cache/firebase-keys.json'
        ),
        $users,
        $responseFactory
    );

    $terdaftar  = new RoleMiddleware([], $responseFactory, $registrations);
    $admin      = new RoleMiddleware(['admin'], $responseFactory, $registrations);
    $superAdmin = new SuperAdminMiddleware($superAdmins, $responseFactory);

    // -----------------------------------------------------------------------
    // Tanpa autentikasi
    // -----------------------------------------------------------------------

    // Dipakai untuk memastikan backend hidup setelah deploy. Sengaja tidak
    // menampilkan versi PHP, nama database, atau info server lainnya.
    $app->get('/api/health', static function (
        ServerRequestInterface $request,
        ResponseInterface $response
    ): ResponseInterface {
        return ApiResponse::success($response, ['status' => 'ok', 'time' => date('c')]);
    });

    // Status maintenance dibaca App.tsx saat aplikasi dimuat, sebelum ada yang
    // login, karena layar "Under Maintenance" juga harus tampil di halaman
    // login. Yang dikirim hanya satu boolean.
    $app->get('/api/settings/maintenance', [new SettingController($settings), 'maintenance']);

    // -----------------------------------------------------------------------
    // Perlu login
    // -----------------------------------------------------------------------

    $app->group('/api', static function (RouteCollectorProxy $group) use (
        $users,
        $master,
        $techLogs,
        $bugReports,
        $auditLogs,
        $settings,
        $registrations,
        $nikAllowlist,
        $superAdmins,
        $policy,
        $audit,
        $terdaftar,
        $admin,
        $superAdmin
    ): void {
        // ---------------------------------------------------------------
        // Login & pendaftaran
        //
        // Tiga route pertama sengaja hanya dijaga $auth, tanpa $terdaftar.
        // User yang baru pertama kali login belum punya baris di tabel
        // users; kalau $terdaftar dipasang, dia akan ditolak 403 dan tidak
        // akan pernah bisa mendaftar.
        //
        // /auth/status juga di sini, dan itu disengaja: pendaftar yang sedang
        // menunggu persetujuan tidak punya baris users, jadi tidak ada
        // endpoint ber-$terdaftar yang bisa dia panggil. Ini satu-satunya
        // tempat dia bisa melihat statusnya sendiri -- dan yang dikirim
        // hanya permintaannya sendiri, tidak ada data orang lain.
        // ---------------------------------------------------------------

        $authController = new AuthController($users, $master, $registrations, $policy, $superAdmins);

        $group->post('/auth/sync', [$authController, 'sync']);
        $group->post('/auth/register', [$authController, 'register']);
        $group->get('/auth/status', [$authController, 'status']);
        $group->get('/auth/me', [$authController, 'me'])->add($terdaftar);

        // ---------------------------------------------------------------
        // Antrean pendaftaran & daftar izin NIK — khusus admin
        // ---------------------------------------------------------------

        $registrationController = new RegistrationController(
            $registrations,
            $nikAllowlist,
            $policy,
            $users,
            $master,
            $audit
        );

        $group->get('/registrations', [$registrationController, 'index'])->add($admin);
        $group->post('/registrations/{uid}/approve', [$registrationController, 'approve'])->add($admin);
        $group->post('/registrations/{uid}/reject', [$registrationController, 'reject'])->add($admin);

        // Menghapus catatan penolakan, supaya yang bersangkutan boleh
        // mendaftar lagi. Bukan menghapus user.
        $group->delete('/registrations/{uid}', [$registrationController, 'forget'])->add($admin);

        $group->get('/allowed-niks', [$registrationController, 'allowedNiks'])->add($admin);
        $group->post('/allowed-niks', [$registrationController, 'addAllowedNik'])->add($admin);
        $group->delete('/allowed-niks/{nik}', [$registrationController, 'removeAllowedNik'])->add($admin);

        // ---------------------------------------------------------------
        // Super admin — khusus super admin
        // ---------------------------------------------------------------

        $superAdminController = new SuperAdminController($superAdmins, $users, $audit);

        $group->get('/super-admins', [$superAdminController, 'index'])->add($superAdmin);
        $group->post('/super-admins', [$superAdminController, 'promote'])->add($superAdmin);
        $group->delete('/super-admins/{email}', [$superAdminController, 'demote'])->add($superAdmin);

        // ---------------------------------------------------------------
        // Users
        // ---------------------------------------------------------------

        $userController = new UserController($users, $master, $superAdmins);

        $group->get('/users', [$userController, 'index'])->add($terdaftar);
        $group->get('/users/{id}', [$userController, 'show'])->add($terdaftar);
        $group->put('/users/{id}', [$userController, 'update'])->add($admin);

        // DELETE wajib menyertakan ?mode=purge atau ?mode=detach. Tidak ada
        // nilai default: purge menghapus seluruh data user itu dan tidak bisa
        // dibatalkan, jadi tidak boleh terjadi karena satu parameter lupa
        // dikirim. Permintaan tanpa mode dijawab 422.
        $group->delete('/users/{id}', [$userController, 'destroy'])->add($admin);

        // ---------------------------------------------------------------
        // Aktivitas teknisi
        //
        // Semua cukup $terdaftar; pembatasan per role ada di dalam
        // controller karena aturannya bergantung pada isi barisnya
        // (pemilik log dan tanggalnya), bukan hanya pada role.
        // ---------------------------------------------------------------

        $techLogController = new TechLogController($techLogs, $master);

        $group->get('/tech-logs', [$techLogController, 'index'])->add($terdaftar);
        $group->post('/tech-logs', [$techLogController, 'store'])->add($terdaftar);
        $group->get('/tech-logs/{id}', [$techLogController, 'show'])->add($terdaftar);
        $group->put('/tech-logs/{id}', [$techLogController, 'update'])->add($terdaftar);
        $group->delete('/tech-logs/{id}', [$techLogController, 'destroy'])->add($terdaftar);

        // ---------------------------------------------------------------
        // Laporan bug
        //
        // Daftar dan detail juga cukup $terdaftar: selain admin, isinya
        // sudah disaring ke laporan milik sendiri di dalam controller.
        // Yang khusus admin hanya perubahan status.
        // ---------------------------------------------------------------

        $bugController = new BugReportController($bugReports);

        $group->get('/bug-reports', [$bugController, 'index'])->add($terdaftar);
        $group->post('/bug-reports', [$bugController, 'store'])->add($terdaftar);
        $group->get('/bug-reports/{id}', [$bugController, 'show'])->add($terdaftar);
        $group->patch('/bug-reports/{id}', [$bugController, 'updateStatus'])->add($admin);

        // ---------------------------------------------------------------
        // Catatan audit
        //
        // Dibaca admin, ditulis siapa saja: yang dicatat justru aksi user
        // biasa (login, tambah log, hapus log).
        // ---------------------------------------------------------------

        $auditController = new AuditLogController($auditLogs);

        $group->get('/audit-logs', [$auditController, 'index'])->add($admin);
        $group->post('/audit-logs', [$auditController, 'store'])->add($terdaftar);

        // ---------------------------------------------------------------
        // Tabel master
        // ---------------------------------------------------------------

        $masterController = new MasterController($master);

        // Sengaja TANPA $terdaftar, satu-satunya di grup ini.
        //
        // Yang membutuhkan daftar divisi justru user yang belum terdaftar:
        // form "Lengkapi Profil" harus menawarkan pilihan divisi sebelum
        // barisnya di tabel users ada. Dengan $terdaftar terpasang, satu-satunya
        // cara mengisi form itu adalah menyalin daftarnya ke frontend sebagai
        // <option> tetap -- persis kebiasaan yang endpoint master ini
        // dimaksudkan untuk menghapus.
        //
        // Tokennya tetap wajib sah, dan yang dikirim hanya id dan nama divisi.
        $group->get('/master/divisions', [$masterController, 'divisions']);

        $group->get('/master/supervisors', [$masterController, 'supervisors'])->add($terdaftar);
        $group->get('/master/categories', [$masterController, 'categories'])->add($terdaftar);
        $group->get('/master/delay-codes', [$masterController, 'delayCodes'])->add($terdaftar);

        // ---------------------------------------------------------------
        // Pengaturan
        //
        // Hanya yang mengubah. Pembacanya ada di luar grup ini karena harus
        // bisa diakses sebelum login.
        // ---------------------------------------------------------------

        $group->put('/settings/maintenance', [new SettingController($settings), 'setMaintenance'])
            ->add($admin);
    })->add($auth);
};
