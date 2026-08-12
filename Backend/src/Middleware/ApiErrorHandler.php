<?php

declare(strict_types=1);

namespace App\Middleware;

use App\Config\Env;
use App\Helpers\ApiResponse;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Exception\HttpException;
use Slim\Exception\HttpMethodNotAllowedException;
use Slim\Exception\HttpNotFoundException;
use Slim\Interfaces\ErrorHandlerInterface;
use Throwable;

/**
 * Penangan error global.
 *
 * Semua error apa pun keluar sebagai JSON dengan bentuk yang sama seperti
 * response lain, jadi frontend tidak pernah menerima halaman HTML error
 * bawaan PHP yang tidak bisa di-parse.
 *
 * Detail teknis (pesan PDO, nama tabel, jalur file, stack trace) TIDAK PERNAH
 * ikut dalam response saat APP_DEBUG=false. Detail itu hanya ditulis ke file
 * log di storage/logs/.
 */
final class ApiErrorHandler implements ErrorHandlerInterface
{
    public function __construct(
        private ResponseFactoryInterface $responseFactory,
        private string $logDirectory
    ) {
    }

    public function __invoke(
        ServerRequestInterface $request,
        Throwable $exception,
        bool $displayErrorDetails,
        bool $logErrors,
        bool $logErrorDetails
    ): ResponseInterface {
        [$status, $message] = $this->classify($exception);

        if ($logErrors && $status >= 500) {
            $this->log($request, $exception);
        }

        if ($displayErrorDetails && $status >= 500) {
            $message .= sprintf(
                ' [%s: %s @ %s:%d]',
                $exception::class,
                $exception->getMessage(),
                $exception->getFile(),
                $exception->getLine()
            );
        }

        return ApiResponse::errorFrom($this->responseFactory, $message, $status);
    }

    /** @return array{0: int, 1: string} */
    private function classify(Throwable $exception): array
    {
        if ($exception instanceof HttpNotFoundException) {
            return [404, 'Endpoint yang diminta tidak ada.'];
        }

        if ($exception instanceof HttpMethodNotAllowedException) {
            return [405, 'Metode HTTP ini tidak didukung oleh endpoint tersebut.'];
        }

        if ($exception instanceof HttpException) {
            // HttpException dibuat sendiri oleh kode kita, pesannya sudah aman.
            return [$exception->getCode(), $exception->getMessage()];
        }

        return [500, 'Terjadi kesalahan di server. Silakan coba lagi beberapa saat.'];
    }

    private function log(ServerRequestInterface $request, Throwable $exception): void
    {
        if (!is_dir($this->logDirectory) && !@mkdir($this->logDirectory, 0775, true) && !is_dir($this->logDirectory)) {
            return;
        }

        $entry = sprintf(
            "[%s] %s %s\n  %s: %s\n  di %s:%d\n%s\n\n",
            date('Y-m-d H:i:s'),
            $request->getMethod(),
            (string) $request->getUri()->getPath(),
            $exception::class,
            $exception->getMessage(),
            $exception->getFile(),
            $exception->getLine(),
            $exception->getTraceAsString()
        );

        @file_put_contents(
            rtrim($this->logDirectory, '/') . '/error-' . date('Y-m-d') . '.log',
            $entry,
            FILE_APPEND | LOCK_EX
        );
    }

    /** Nilai displayErrorDetails yang dipakai saat mendaftarkan middleware. */
    public static function shouldDisplayDetails(): bool
    {
        return Env::isDebug() && !Env::isProduction();
    }
}
