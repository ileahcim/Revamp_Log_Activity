<?php

declare(strict_types=1);

namespace App\Models;

/**
 * Query untuk tabel audit_logs.
 *
 * Hanya bisa ditambah dan dibaca. Tidak ada method ubah atau hapus, dan itu
 * disengaja -- catatan aksi yang bisa disunting tidak ada gunanya sebagai
 * catatan aksi. Satu-satunya tempat baris audit ikut terhapus adalah saat
 * usernya dihapus, karena foreign key-nya ON DELETE RESTRICT.
 */
final class AuditLogModel extends BaseModel
{
    private const KOLOM = 'a.id,
                           a.user_id,
                           a.action,
                           a.description,
                           a.created_at,
                           u.name AS user_name';

    private const FROM = 'FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id';

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    public function all(array $filters, int $limit, int $offset): array
    {
        [$where, $params] = $this->buildFilter($filters);

        $params['limit']  = $limit;
        $params['offset'] = $offset;

        return $this->fetchAll(
            'SELECT ' . self::KOLOM . ' ' . self::FROM . $where
                . ' ORDER BY a.created_at DESC, a.id ASC LIMIT :limit OFFSET :offset',
            $params
        );
    }

    /** @param array<string, mixed> $filters */
    public function countAll(array $filters): int
    {
        [$where, $params] = $this->buildFilter($filters);

        return (int) $this->fetchValue('SELECT COUNT(*) ' . self::FROM . $where, $params);
    }

    /** @param array<string, mixed> $data */
    public function insert(array $data): void
    {
        $this->execute(
            'INSERT INTO audit_logs (id, user_id, action, description)
                  VALUES (:id, :user_id, :action, :description)',
            $data
        );
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function buildFilter(array $filters): array
    {
        $conditions = [];
        $params     = [];

        $userId = $filters['user_id'] ?? null;

        if ($userId !== null && $userId !== '') {
            $conditions[]      = 'a.user_id = :user_id';
            $params['user_id'] = $userId;
        }

        foreach (['start_date' => '>=', 'end_date' => '<='] as $key => $operator) {
            $nilai = $filters[$key] ?? null;

            if ($nilai !== null && $nilai !== '') {
                // Kolomnya TIMESTAMP, sedangkan yang dikirim tanggal saja.
                // DATE() membuat batas atas ikut menyertakan hari itu penuh.
                $conditions[] = 'DATE(a.created_at) ' . $operator . ' :' . $key;
                $params[$key] = $nilai;
            }
        }

        $search = $filters['search'] ?? null;

        if (is_string($search) && $search !== '') {
            $conditions[] = '(a.action LIKE :search_aksi OR u.name LIKE :search_nama)';

            $needle = '%' . $this->escapeLike($search) . '%';

            $params['search_aksi'] = $needle;
            $params['search_nama'] = $needle;
        }

        return [
            $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions),
            $params,
        ];
    }
}
