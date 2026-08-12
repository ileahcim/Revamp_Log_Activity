<?php

declare(strict_types=1);

namespace App\Helpers;

use RuntimeException;

/**
 * Token yang dikirim frontend tidak bisa dipercaya.
 *
 * Pesannya sengaja ditulis dalam Bahasa Indonesia dan aman ditampilkan ke
 * user -- tidak memuat detail teknis apa pun tentang kunci atau server.
 */
final class TokenException extends RuntimeException
{
}
