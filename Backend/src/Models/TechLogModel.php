<?php

declare(strict_types=1);

namespace App\Models;

/**
 * Query untuk tabel tech_logs.
 *
 * Sengaja memakai LEFT JOIN ke users, bukan JOIN biasa. Foreign key-nya memang
 * NOT NULL, tapi 01_schema.sql menonaktifkan FOREIGN_KEY_CHECKS saat tabel
 * dibuat dan proses migrasi berjalan di luar aplikasi ini. Kalau sampai ada
 * satu baris yatim, LEFT JOIN membuatnya tetap terlihat -- INNER JOIN akan
 * menyembunyikannya diam-diam dan data teknisi hilang tanpa jejak.
 *
 * Kolom yang dipakai frontend untuk menampilkan (display_name, nik_snapshot,
 * supervisor) diambil dari tabel ini apa adanya, bukan dari hasil JOIN, supaya
 * log lama tidak ikut berubah ketika profil user diperbarui.
 */
final class TechLogModel extends BaseModel
{
    private const SELECT = 'SELECT t.id,
                                   t.user_id,
                                   t.tanggal,
                                   t.display_name,
                                   t.nik_snapshot,
                                   t.supervisor,
                                   t.shift,
                                   t.wo_notif,
                                   t.asset_tag,
                                   t.party,
                                   t.sn,
                                   t.deskripsi_pekerjaan,
                                   t.kategori_code,
                                   t.start_time,
                                   t.finish_time,
                                   t.duration_minutes,
                                   t.status,
                                   t.delay_code,
                                   t.output_qty,
                                   t.catatan,
                                   t.created_at,
                                   t.updated_at,
                                   u.name AS user_name,
                                   u.role AS user_role
                              FROM tech_logs t
                              LEFT JOIN users u ON u.id = t.user_id';

    private const FROM = 'FROM tech_logs t LEFT JOIN users u ON u.id = t.user_id';

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    public function all(array $filters, int $limit, int $offset): array
    {
        [$where, $params] = $this->buildFilter($filters);

        $params['limit']  = $limit;
        $params['offset'] = $offset;

        // Urutan mengikuti fetchLogsFirestore(): created_at menurun. id dipakai
        // sebagai pemecah seri supaya halaman kedua tidak mengulang baris yang
        // sudah muncul di halaman pertama -- banyak baris hasil migrasi punya
        // created_at yang sama persis.
        return $this->fetchAll(
            self::SELECT . $where . ' ORDER BY t.created_at DESC, t.id ASC LIMIT :limit OFFSET :offset',
            $params
        );
    }

    /** @param array<string, mixed> $filters */
    public function countAll(array $filters): int
    {
        [$where, $params] = $this->buildFilter($filters);

        return (int) $this->fetchValue('SELECT COUNT(*) ' . self::FROM . $where, $params);
    }

    /** @return array<string, mixed>|null */
    public function findById(string $id): ?array
    {
        return $this->fetchOne(self::SELECT . ' WHERE t.id = :id', ['id' => $id]);
    }

    /**
     * Pernahkah NIK ini muncul di histori aktivitas?
     *
     * Ini sumber utama "NIK yang dikenal sistem" saat pendaftaran. Sengaja
     * bukan tabel users: teknisi lama yang belum pernah login tidak punya baris
     * di sana, dan justru merekalah yang paling mungkin mendaftar. NIK mereka
     * hanya ada di kolom snapshot ini, terikat ke akun penampung hasil migrasi.
     *
     * nik_snapshot tidak punya indeks, jadi query ini memindai tabel. Dengan
     * 6.713 baris hasil migrasi biayanya tidak terasa, dan pemanggilnya hanya
     * pendaftaran -- beberapa kali sehari, bukan per halaman dibuka. Kalau
     * tabelnya tumbuh sampai ratusan ribu baris, tambahkan indeks pada
     * nik_snapshot lewat skrip SQL baru (itu CREATE INDEX, bukan perubahan
     * struktur kolom, jadi tidak melanggar kunci schema V1.0).
     *
     * LIMIT 1 membuat MySQL berhenti pada baris pertama yang cocok.
     */
    public function nikPernahDipakai(string $nik): bool
    {
        $nik = trim($nik);

        if ($nik === '') {
            return false;
        }

        // fetchValue() mengubah "tidak ada baris" menjadi null, bukan false.
        return $this->fetchValue(
            'SELECT 1 FROM tech_logs WHERE nik_snapshot = :nik LIMIT 1',
            ['nik' => $nik]
        ) !== null;
    }

    /** @param array<string, mixed> $data */
    public function insert(array $data): void
    {
        $this->execute(
            'INSERT INTO tech_logs (
                 id, user_id, tanggal, display_name, nik_snapshot, supervisor, shift,
                 wo_notif, asset_tag, party, sn, deskripsi_pekerjaan, kategori_code,
                 start_time, finish_time, duration_minutes, status, delay_code,
                 output_qty, catatan
             ) VALUES (
                 :id, :user_id, :tanggal, :display_name, :nik_snapshot, :supervisor, :shift,
                 :wo_notif, :asset_tag, :party, :sn, :deskripsi_pekerjaan, :kategori_code,
                 :start_time, :finish_time, :duration_minutes, :status, :delay_code,
                 :output_qty, :catatan
             )',
            $data
        );
    }

    /**
     * user_id tidak ikut diubah. Pemiliknya tetap orang yang pertama membuat
     * log, walaupun yang mengedit adalah admin.
     *
     * @param array<string, mixed> $data
     */
    public function update(string $id, array $data): int
    {
        $data['id'] = $id;

        return $this->execute(
            'UPDATE tech_logs SET
                 tanggal             = :tanggal,
                 display_name        = :display_name,
                 nik_snapshot        = :nik_snapshot,
                 supervisor          = :supervisor,
                 shift               = :shift,
                 wo_notif            = :wo_notif,
                 asset_tag           = :asset_tag,
                 party               = :party,
                 sn                  = :sn,
                 deskripsi_pekerjaan = :deskripsi_pekerjaan,
                 kategori_code       = :kategori_code,
                 start_time          = :start_time,
                 finish_time         = :finish_time,
                 duration_minutes    = :duration_minutes,
                 status              = :status,
                 delay_code          = :delay_code,
                 output_qty          = :output_qty,
                 catatan             = :catatan
             WHERE id = :id',
            $data
        );
    }

    public function delete(string $id): int
    {
        return $this->execute('DELETE FROM tech_logs WHERE id = :id', ['id' => $id]);
    }

    /**
     * Susun klausa WHERE.
     *
     * Yang disambung ke SQL hanya potongan tetap yang tertulis di file ini.
     * Semua nilai dari luar masuk lewat parameter, termasuk isi LIKE.
     *
     * @param array<string, mixed> $filters
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function buildFilter(array $filters): array
    {
        $conditions = [];
        $params     = [];

        $equals = [
            'user_id'       => 't.user_id',
            'nik'           => 't.nik_snapshot',
            'status'        => 't.status',
            'kategori_code' => 't.kategori_code',
            'shift'         => 't.shift',
            'supervisor'    => 't.supervisor',
        ];

        foreach ($equals as $key => $column) {
            $value = $filters[$key] ?? null;

            if ($value !== null && $value !== '') {
                $conditions[]   = $column . ' = :' . $key;
                $params[$key]   = $value;
            }
        }

        foreach (['start_date' => '>=', 'end_date' => '<='] as $key => $operator) {
            $value = $filters[$key] ?? null;

            if ($value !== null && $value !== '') {
                $conditions[] = 't.tanggal ' . $operator . ' :' . $key;
                $params[$key] = $value;
            }
        }

        $search = $filters['search'] ?? null;

        if (is_string($search) && $search !== '') {
            // Satu nama placeholder tidak boleh dipakai dua kali dalam satu
            // statement selama PDO::ATTR_EMULATE_PREPARES mati, jadi tiap kolom
            // punya nama sendiri walaupun nilainya sama.
            $columns = [
                'search_deskripsi' => 't.deskripsi_pekerjaan',
                'search_nama'      => 't.display_name',
                'search_wo'        => 't.wo_notif',
                'search_asset'     => 't.asset_tag',
                'search_sn'        => 't.sn',
                'search_party'     => 't.party',
            ];

            $needle = '%' . $this->escapeLike($search) . '%';
            $parts  = [];

            foreach ($columns as $name => $column) {
                $parts[]       = $column . ' LIKE :' . $name;
                $params[$name] = $needle;
            }

            $conditions[] = '(' . implode(' OR ', $parts) . ')';
        }

        /**
         * Penyaring "hanya log milik saya" untuk role karyawan.
         *
         * Tiga kemungkinan dicoba sekaligus karena data hasil migrasi tidak
         * seragam: sebagian baris user_id-nya sudah benar, sebagian jatuh ke
         * user penampung legacy-unknown dan hanya bisa dikenali lewat NIK, dan
         * baris paling lama bahkan tidak menyimpan NIK sehingga tinggal nama.
         * Sama persis dengan cara ActivityList.tsx menyaring di browser.
         *
         * @var array{uid: string, nik: string, name: string}|null $owner
         */
        $owner = $filters['owner'] ?? null;

        if (is_array($owner)) {
            $parts = ['t.user_id = :own_uid'];

            $params['own_uid'] = $owner['uid'];

            if (($owner['nik'] ?? '') !== '') {
                $parts[]           = 't.nik_snapshot = :own_nik';
                $params['own_nik'] = $owner['nik'];
            }

            if (($owner['name'] ?? '') !== '') {
                $parts[]            = 'LOWER(t.display_name) = LOWER(:own_name)';
                $params['own_name'] = $owner['name'];
            }

            $conditions[] = '(' . implode(' OR ', $parts) . ')';
        }

        return [
            $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions),
            $params,
        ];
    }
}
