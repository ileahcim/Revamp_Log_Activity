<?php

declare(strict_types=1);

/**
 * ===========================================================================
 *  Log Activity API - satu-satunya pintu masuk
 * ===========================================================================
 *
 *  Semua request masuk lewat file ini, diarahkan oleh .htaccess di folder
 *  yang sama. Tidak ada file PHP lain yang boleh diakses langsung dari web.
 */

use App\Config\Env;
use App\Middleware\ApiErrorHandler;
use App\Middleware\CorsMiddleware;
use Slim\Factory\AppFactory;

/**
 * Letak src/, routes/, vendor/, dan .env.
 *
 * Dua susunan folder didukung tanpa perlu mengubah file ini:
 *
 *   1. Susunan repo          -> Backend/public/index.php, Backend/src, ...
 *   2. Susunan shared hosting -> public_html/api/index.php
 *                                public_html/api/app/src, app/vendor, app/.env
 *
 * Susunan kedua dipakai saat hosting tidak mengizinkan file di luar
 * public_html. Lihat bagian Deployment di README.
 */
$appRoot = is_dir(__DIR__ . '/app') ? __DIR__ . '/app' : dirname(__DIR__);

if (!is_file($appRoot . '/vendor/autoload.php')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');

    echo json_encode([
        'success' => false,
        'data'    => null,
        'message' => 'Dependensi belum terpasang. Jalankan "composer install", '
            . 'atau unggah folder vendor/ ke server.',
    ], JSON_UNESCAPED_UNICODE);

    exit;
}

require $appRoot . '/vendor/autoload.php';

Env::load($appRoot);

date_default_timezone_set((string) Env::get('APP_TIMEZONE', 'Asia/Jakarta'));

$app = AppFactory::create();

$basePath = (string) Env::get('APP_BASE_PATH', '');

if ($basePath !== '') {
    $app->setBasePath(rtrim($basePath, '/'));
}

// Mengubah body JSON jadi array supaya $request->getParsedBody() bisa dipakai.
$app->addBodyParsingMiddleware();
$app->addRoutingMiddleware();

$errorMiddleware = $app->addErrorMiddleware(
    ApiErrorHandler::shouldDisplayDetails(),
    true,
    true
);

$errorMiddleware->setDefaultErrorHandler(
    new ApiErrorHandler($app->getResponseFactory(), $appRoot . '/storage/logs')
);

/*
 * CORS didaftarkan paling akhir supaya posisinya paling luar: Slim menjalankan
 * middleware dengan urutan terbalik dari urutan pendaftaran. Dengan begitu
 * response error dari ErrorMiddleware pun tetap membawa header CORS, jadi
 * pesan aslinya terbaca di browser, bukan tertutup pesan "CORS error".
 */
$app->add(new CorsMiddleware(
    Env::bool('CORS_ENABLED', false),
    Env::list('CORS_ALLOWED_ORIGINS'),
    $app->getResponseFactory()
));

(require $appRoot . '/routes/api.php')($app, $appRoot);

/*
 * Route tak dikenal dan metode yang salah tidak ditangkap route penampung di
 * sini, melainkan diserahkan ke ApiErrorHandler. Route penampung "/{path:.*}"
 * justru merugikan: ia ikut cocok dengan POST /api/users sehingga Slim tidak
 * pernah melempar HttpMethodNotAllowedException, dan kesalahan metode terbaca
 * sebagai 404, bukan 405.
 */
$app->run();
