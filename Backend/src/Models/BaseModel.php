<?php

declare(strict_types=1);

namespace App\Models;

use App\Config\Database;
use PDO;
use PDOStatement;
use Throwable;

/**
 * Dasar seluruh model.
 *
 * Semua query di aplikasi ini lewat sini, dan semuanya memakai prepared
 * statement. Tidak ada nilai yang pernah disambung langsung ke dalam string
 * SQL -- termasuk angka LIMIT dan OFFSET, yang di-bind sebagai PDO::PARAM_INT.
 */
abstract class BaseModel
{
    private ?PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo;
    }

    /**
     * Koneksi dibuka saat query pertama, bukan saat model dibuat.
     *
     * Model dibuat di routes/api.php, yaitu sebelum $app->run(), jadi di luar
     * jangkauan ErrorMiddleware. Kalau koneksi dibuka di konstruktor, database
     * yang bermasalah membuat PHP berhenti sebelum handler error sempat
     * bekerja -- klien menerima status 500 dengan body kosong. Menundanya
     * sampai query pertama membuat kegagalan koneksi tertangkap sebagai JSON
     * biasa, dan endpoint yang tidak menyentuh database (/api/health) tetap
     * bisa dipakai untuk memastikan backend hidup.
     */
    protected function db(): PDO
    {
        return $this->pdo ??= Database::pdo();
    }

    /**
     * @param array<string, mixed> $params
     * @return list<array<string, mixed>>
     */
    protected function fetchAll(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    /**
     * @param array<string, mixed> $params
     * @return array<string, mixed>|null
     */
    protected function fetchOne(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();

        return $row === false ? null : $row;
    }

    /** @param array<string, mixed> $params */
    protected function fetchValue(string $sql, array $params = []): mixed
    {
        $value = $this->run($sql, $params)->fetchColumn();

        return $value === false ? null : $value;
    }

    /**
     * Jalankan INSERT/UPDATE/DELETE, kembalikan jumlah baris terpengaruh.
     *
     * @param array<string, mixed> $params
     */
    protected function execute(string $sql, array $params = []): int
    {
        return $this->run($sql, $params)->rowCount();
    }

    /**
     * Jalankan beberapa query sebagai satu kesatuan.
     *
     * Dipakai saat menghapus user: barisnya tersebar di empat tabel dengan
     * foreign key ON DELETE RESTRICT, jadi urutannya harus benar dan tidak
     * boleh berhenti di tengah. Kalau salah satu gagal, semuanya dibatalkan.
     *
     * @template T
     * @param callable(): T $langkah
     * @return T
     */
    protected function transaction(callable $langkah): mixed
    {
        $pdo = $this->db();

        $pdo->beginTransaction();

        try {
            $hasil = $langkah();

            $pdo->commit();

            return $hasil;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }
    }

    /**
     * Netralkan wildcard LIKE.
     *
     * Tanpa ini, pencarian "%" akan cocok dengan seluruh baris dan "_" cocok
     * dengan karakter apa pun -- bukan lubang keamanan, tapi hasilnya salah.
     */
    protected function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    /**
     * Siapkan dan jalankan statement.
     *
     * Tipe tiap parameter ditentukan dari tipe nilainya di PHP. Ini penting
     * karena PDO::ATTR_EMULATE_PREPARES dimatikan: tanpa PARAM_INT, angka
     * akan dikirim sebagai string dan MySQL menolak "LIMIT '100'".
     *
     * @param array<string, mixed> $params
     */
    protected function run(string $sql, array $params = []): PDOStatement
    {
        $statement = $this->db()->prepare($sql);

        foreach ($params as $name => $value) {
            $statement->bindValue(
                is_int($name) ? $name + 1 : $name,
                $value,
                match (true) {
                    is_int($value)  => PDO::PARAM_INT,
                    is_bool($value) => PDO::PARAM_BOOL,
                    $value === null => PDO::PARAM_NULL,
                    default         => PDO::PARAM_STR,
                }
            );
        }

        $statement->execute();

        return $statement;
    }
}
