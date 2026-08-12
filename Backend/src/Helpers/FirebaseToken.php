<?php

declare(strict_types=1);

namespace App\Helpers;

use Firebase\JWT\BeforeValidException;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\SignatureInvalidException;
use Throwable;

/**
 * Verifikasi Firebase ID token.
 *
 * Frontend login lewat signInWithPopup (Google SSO) lalu mengirim ID token
 * hasil login di header Authorization. Backend TIDAK boleh percaya isi token
 * begitu saja: tanda tangannya diperiksa memakai public key milik Google.
 *
 * Yang diperiksa:
 *   1. Tanda tangan RS256 cocok dengan salah satu public key Google
 *   2. iss  == https://securetoken.google.com/<projectId>
 *   3. aud  == <projectId>              (token milik project ini, bukan project lain)
 *   4. sub  tidak kosong                (ini yang dipakai sebagai users.id)
 *   5. exp / iat / auth_time masih masuk akal
 *
 * Public key Google berganti berkala, jadi hasil unduhan disimpan di file
 * cache dan diperbarui otomatis saat kedaluwarsa atau saat menemukan "kid"
 * yang belum dikenal.
 */
final class FirebaseToken
{
    private const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

    /** Toleransi selisih jam antara server hosting dan Google, dalam detik. */
    private const LEEWAY = 60;

    /** Dipakai kalau header Cache-Control dari Google tidak terbaca. */
    private const FALLBACK_TTL = 3600;

    /**
     * Jeda minimum antar pengunduhan paksa, dalam detik.
     *
     * Tanda tangan yang tidak cocok memicu pengunduhan ulang kunci, karena
     * bisa jadi Google baru merotasi kuncinya. Tanpa jeda ini, seseorang yang
     * mengirim token bertanda tangan asal-asalan berkali-kali akan memaksa
     * server mengunduh ke Google pada setiap request.
     */
    private const MIN_REFRESH_INTERVAL = 300;

    public function __construct(
        private string $projectId,
        private string $cacheFile
    ) {
    }

    /**
     * @return array<string, mixed> claim di dalam token
     * @throws TokenException kalau token tidak sah karena alasan apa pun
     */
    public function verify(string $idToken): array
    {
        if ($this->projectId === '') {
            throw new TokenException('Verifikasi login belum dikonfigurasi di server.');
        }

        JWT::$leeway = self::LEEWAY;

        $kid  = $this->keyIdOf($idToken);
        $keys = $this->keys();

        // "kid" yang belum dikenal berarti Google baru saja merotasi kunci.
        if ($kid !== null && !isset($keys[$kid])) {
            $keys = $this->keys(true);
        }

        $claims = $this->decode($idToken, $keys, $kid);

        $this->assertClaims($claims);

        return $claims;
    }

    // -----------------------------------------------------------------------
    // Pembacaan token
    // -----------------------------------------------------------------------

    /**
     * @param array<string, \Firebase\JWT\Key> $keys
     * @return array<string, mixed>
     */
    private function decode(string $idToken, array $keys, ?string $kid): array
    {
        try {
            return (array) JWT::decode($idToken, $keys);
        } catch (ExpiredException) {
            throw new TokenException('Sesi login sudah berakhir. Silakan masuk kembali.');
        } catch (BeforeValidException) {
            throw new TokenException('Token belum berlaku. Periksa jam pada perangkat Anda.');
        } catch (SignatureInvalidException) {
            // Bisa jadi cache kunci sudah basi walau belum kedaluwarsa.
            if ($kid !== null) {
                try {
                    return (array) JWT::decode($idToken, $this->keys(true));
                } catch (Throwable) {
                    // jatuh ke pesan di bawah
                }
            }

            throw new TokenException('Tanda tangan token tidak sah.');
        } catch (Throwable) {
            throw new TokenException('Token login tidak valid.');
        }
    }

    /** @param array<string, mixed> $claims */
    private function assertClaims(array $claims): void
    {
        $expectedIssuer = 'https://securetoken.google.com/' . $this->projectId;

        if (($claims['iss'] ?? null) !== $expectedIssuer) {
            throw new TokenException('Token berasal dari penerbit yang tidak dikenal.');
        }

        if (($claims['aud'] ?? null) !== $this->projectId) {
            throw new TokenException('Token ini bukan untuk aplikasi ini.');
        }

        $subject = $claims['sub'] ?? '';

        if (!is_string($subject) || trim($subject) === '') {
            throw new TokenException('Token tidak memuat identitas pengguna.');
        }

        // auth_time di masa depan menandakan token dirakit sendiri.
        $authTime = $claims['auth_time'] ?? null;

        if (is_numeric($authTime) && (int) $authTime > time() + self::LEEWAY) {
            throw new TokenException('Waktu login pada token tidak wajar.');
        }
    }

    /** Baca "kid" dari header token tanpa mempercayai isinya. */
    private function keyIdOf(string $idToken): ?string
    {
        $segments = explode('.', $idToken);

        if (count($segments) !== 3) {
            throw new TokenException('Format token login tidak dikenali.');
        }

        $decoded = base64_decode(strtr($segments[0], '-_', '+/'), true);

        if ($decoded === false) {
            return null;
        }

        $header = json_decode($decoded, true);

        return is_array($header) && isset($header['kid']) && is_string($header['kid'])
            ? $header['kid']
            : null;
    }

    // -----------------------------------------------------------------------
    // Public key Google
    // -----------------------------------------------------------------------

    /** @return array<string, \Firebase\JWT\Key> */
    private function keys(bool $forceRefresh = false): array
    {
        $cached = $this->readCache();

        if ($cached !== null) {
            $stillValid     = $cached['expires_at'] > time();
            $justDownloaded = (time() - $cached['fetched_at']) < self::MIN_REFRESH_INTERVAL;

            // Permintaan biasa cukup melihat masa berlaku. Permintaan paksa
            // tetap memakai cache kalau baru saja diunduh, supaya tidak bisa
            // dipakai membanjiri Google dengan permintaan.
            if ($forceRefresh ? $justDownloaded : $stillValid) {
                return $this->parse($cached['jwks']);
            }
        }

        try {
            [$body, $ttl] = $this->download();
        } catch (Throwable $e) {
            // Kalau jaringan sedang bermasalah, cache lama masih jauh lebih
            // berguna daripada menolak semua login.
            if ($cached !== null) {
                return $this->parse($cached['jwks']);
            }

            throw new TokenException('Server tidak dapat menghubungi Google untuk memverifikasi login.');
        }

        $jwks = json_decode($body, true);

        if (!is_array($jwks) || !isset($jwks['keys'])) {
            if ($cached !== null) {
                return $this->parse($cached['jwks']);
            }

            throw new TokenException('Gagal membaca kunci verifikasi dari Google.');
        }

        $this->writeCache($jwks, $ttl);

        return $this->parse($jwks);
    }

    /**
     * @param array<string, mixed> $jwks
     * @return array<string, \Firebase\JWT\Key>
     */
    private function parse(array $jwks): array
    {
        try {
            return JWK::parseKeySet($jwks, 'RS256');
        } catch (Throwable) {
            throw new TokenException('Kunci verifikasi dari Google tidak dapat diproses.');
        }
    }

    /**
     * @return array{0: string, 1: int} isi respons dan umur cache dalam detik
     */
    private function download(): array
    {
        if (function_exists('curl_init')) {
            return $this->downloadWithCurl();
        }

        return $this->downloadWithStream();
    }

    /** @return array{0: string, 1: int} */
    private function downloadWithCurl(): array
    {
        $curl = curl_init(self::JWK_URL);

        if ($curl === false) {
            throw new TokenException('Gagal menyiapkan koneksi ke Google.');
        }

        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER         => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
        ]);

        $raw        = curl_exec($curl);
        $status     = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $headerSize = (int) curl_getinfo($curl, CURLINFO_HEADER_SIZE);

        curl_close($curl);

        if (!is_string($raw) || $status !== 200) {
            throw new TokenException('Google menolak permintaan kunci verifikasi.');
        }

        return [
            substr($raw, $headerSize),
            $this->ttlFromHeaders(substr($raw, 0, $headerSize)),
        ];
    }

    /** @return array{0: string, 1: int} */
    private function downloadWithStream(): array
    {
        $context = stream_context_create([
            'http' => ['method' => 'GET', 'timeout' => 10, 'ignore_errors' => true],
            'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);

        $body = @file_get_contents(self::JWK_URL, false, $context);

        if ($body === false) {
            throw new TokenException('Server tidak dapat mengunduh kunci verifikasi.');
        }

        // $http_response_header diisi otomatis oleh PHP setelah pemanggilan di atas.
        $headers = implode("\n", $http_response_header ?? []);

        return [$body, $this->ttlFromHeaders($headers)];
    }

    private function ttlFromHeaders(string $headers): int
    {
        if (preg_match('/max-age\s*=\s*(\d+)/i', $headers, $m) === 1) {
            // Perbarui sedikit lebih awal daripada masa berlaku sebenarnya.
            return max(300, (int) $m[1] - 300);
        }

        return self::FALLBACK_TTL;
    }

    // -----------------------------------------------------------------------
    // Cache di disk
    // -----------------------------------------------------------------------

    /** @return array{expires_at: int, fetched_at: int, jwks: array<string, mixed>}|null */
    private function readCache(): ?array
    {
        if (!is_file($this->cacheFile)) {
            return null;
        }

        $raw = @file_get_contents($this->cacheFile);

        if ($raw === false) {
            return null;
        }

        $data = json_decode($raw, true);

        if (!is_array($data) || !isset($data['expires_at'], $data['jwks']) || !is_array($data['jwks'])) {
            return null;
        }

        return [
            'expires_at' => (int) $data['expires_at'],
            'fetched_at' => (int) ($data['fetched_at'] ?? 0),
            'jwks'       => $data['jwks'],
        ];
    }

    /** @param array<string, mixed> $jwks */
    private function writeCache(array $jwks, int $ttl): void
    {
        $directory = dirname($this->cacheFile);

        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            return;
        }

        $payload = json_encode([
            'expires_at' => time() + $ttl,
            'fetched_at' => time(),
            'jwks'       => $jwks,
        ]);

        if ($payload === false) {
            return;
        }

        // Tulis ke file sementara lalu pindahkan, supaya request lain tidak
        // sempat membaca file yang isinya baru separuh.
        $temporary = $this->cacheFile . '.' . bin2hex(random_bytes(4)) . '.tmp';

        if (@file_put_contents($temporary, $payload, LOCK_EX) === false) {
            return;
        }

        if (!@rename($temporary, $this->cacheFile)) {
            @unlink($temporary);
        }
    }
}
