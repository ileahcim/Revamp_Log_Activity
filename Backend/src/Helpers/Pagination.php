<?php

declare(strict_types=1);

namespace App\Helpers;

use App\Config\Env;

/**
 * Penjepit nilai limit dan offset.
 *
 * Nilai yang tidak masuk akal (0, negatif, sangat besar, atau bukan angka)
 * dijepit ke rentang aman, bukan ditolak, supaya frontend tidak gagal total
 * hanya karena salah ketik satu parameter.
 */
final class Pagination
{
    public static function limit(mixed $value): int
    {
        $max     = Env::int('API_MAX_LIMIT', 500);
        $default = min(Env::int('API_DEFAULT_LIMIT', 100), $max);

        if (!is_numeric($value)) {
            return $default;
        }

        return max(1, min((int) $value, $max));
    }

    public static function offset(mixed $value): int
    {
        return is_numeric($value) ? max(0, (int) $value) : 0;
    }

    /**
     * Isi "meta" untuk endpoint daftar.
     *
     * has_more memberi tahu frontend bahwa masih ada baris berikutnya. Ini
     * penting untuk tech_logs: Dashboard menghitung statistik dari seluruh
     * baris yang diterimanya, jadi kalau backend memotong di baris ke-500 tanpa
     * memberi tanda, angkanya salah tanpa ada yang sadar.
     *
     * @return array<string, mixed>
     */
    public static function meta(int $total, int $limit, int $offset, int $returned): array
    {
        return [
            'total'    => $total,
            'limit'    => $limit,
            'offset'   => $offset,
            'has_more' => ($offset + $returned) < $total,
        ];
    }
}
