<?php

declare(strict_types=1);

namespace App\Models;

/**
 * Query untuk tabel tech_bug_reports.
 *
 * Tabelnya tidak menyimpan nama pelapor maupun rolenya -- berbeda dengan
 * Firestore yang menyimpan userName dan role di dalam dokumen. Keduanya diambil
 * lewat LEFT JOIN ke users, artinya yang tampil adalah nama dan role
 * **sekarang**, bukan saat laporan dikirim.
 *
 * Kolom image_base64 sengaja tidak ikut di daftar kolom biasa. Isinya data URL
 * hasil kompresi di browser, ukurannya ratusan KB per baris; kalau ikut terbawa
 * di endpoint daftar, satu halaman berisi 50 laporan bisa jadi belasan MB.
 */
final class BugReportModel extends BaseModel
{
    /**
     * has_image menjawab "ada lampiran atau tidak" tanpa ikut mengirim
     * lampirannya. Tabel bug report di AdminPanel menampilkan ikon klip untuk
     * laporan berlampiran; tanpa penanda ini, satu-satunya cara mengetahuinya
     * adalah mengirim seluruh data URL di endpoint daftar -- yang justru
     * dihindari kolom image_base64 tidak masuk daftar ini.
     *
     * Dibandingkan dengan '' juga, bukan hanya IS NOT NULL: laporan tanpa
     * gambar dari BugReportModal lama bisa tersimpan sebagai string kosong.
     */
    private const KOLOM = "b.id,
                           b.user_id,
                           b.title,
                           b.description,
                           b.status,
                           b.created_at,
                           u.name AS user_name,
                           u.role AS user_role,
                           (b.image_base64 IS NOT NULL AND b.image_base64 <> '') AS has_image";

    private const FROM = 'FROM tech_bug_reports b LEFT JOIN users u ON u.id = b.user_id';

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
                . ' ORDER BY b.created_at DESC, b.id ASC LIMIT :limit OFFSET :offset',
            $params
        );
    }

    /** @param array<string, mixed> $filters */
    public function countAll(array $filters): int
    {
        [$where, $params] = $this->buildFilter($filters);

        return (int) $this->fetchValue('SELECT COUNT(*) ' . self::FROM . $where, $params);
    }

    /**
     * Detail satu laporan, lengkap dengan gambarnya.
     *
     * @return array<string, mixed>|null
     */
    public function findById(string $id): ?array
    {
        return $this->fetchOne(
            'SELECT ' . self::KOLOM . ', b.image_base64 ' . self::FROM . ' WHERE b.id = :id',
            ['id' => $id]
        );
    }

    /** @param array<string, mixed> $data */
    public function insert(array $data): void
    {
        $this->execute(
            'INSERT INTO tech_bug_reports (id, user_id, title, description, image_base64, status)
                  VALUES (:id, :user_id, :title, :description, :image_base64, :status)',
            $data
        );
    }

    public function updateStatus(string $id, string $status): int
    {
        return $this->execute(
            'UPDATE tech_bug_reports SET status = :status WHERE id = :id',
            ['status' => $status, 'id' => $id]
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

        foreach (['status' => 'b.status', 'user_id' => 'b.user_id'] as $key => $kolom) {
            $nilai = $filters[$key] ?? null;

            if ($nilai !== null && $nilai !== '') {
                $conditions[] = $kolom . ' = :' . $key;
                $params[$key] = $nilai;
            }
        }

        $search = $filters['search'] ?? null;

        if (is_string($search) && $search !== '') {
            // Placeholder terpisah walau nilainya sama; lihat catatan di
            // UserModel tentang PDO::ATTR_EMULATE_PREPARES.
            $conditions[] = '(b.title LIKE :search_judul OR b.description LIKE :search_isi)';

            $needle = '%' . $this->escapeLike($search) . '%';

            $params['search_judul'] = $needle;
            $params['search_isi']   = $needle;
        }

        return [
            $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions),
            $params,
        ];
    }
}
