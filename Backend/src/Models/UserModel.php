<?php

declare(strict_types=1);

namespace App\Models;

/**
 * Query untuk tabel users.
 *
 * Divisi disimpan sebagai division_id (FK ke master_divisions), bukan sebagai
 * teks. Karena kolomnya NOT NULL, JOIN biasa sudah aman di sini -- setiap user
 * pasti punya divisi yang sah.
 */
final class UserModel extends BaseModel
{
    /** Kolom yang selalu diambil, ditulis sekali supaya tidak beda-beda. */
    private const SELECT = 'SELECT u.id,
                                   u.email,
                                   u.nik,
                                   u.name,
                                   u.role,
                                   u.division_id,
                                   d.name AS division_name,
                                   u.created_at,
                                   u.updated_at
                              FROM users u
                              JOIN master_divisions d ON d.id = u.division_id';

    /**
     * Daftar user, opsional disaring.
     *
     * @param array{search?: ?string, role?: ?string, division?: ?string} $filters
     * @return list<array<string, mixed>>
     */
    public function all(array $filters, int $limit, int $offset): array
    {
        [$where, $params] = $this->buildFilter($filters);

        $params['limit']  = $limit;
        $params['offset'] = $offset;

        return $this->fetchAll(
            self::SELECT . $where . ' ORDER BY u.name ASC LIMIT :limit OFFSET :offset',
            $params
        );
    }

    /** @param array{search?: ?string, role?: ?string, division?: ?string} $filters */
    public function countAll(array $filters): int
    {
        [$where, $params] = $this->buildFilter($filters);

        return (int) $this->fetchValue(
            'SELECT COUNT(*) FROM users u JOIN master_divisions d ON d.id = u.division_id' . $where,
            $params
        );
    }

    /** @return array<string, mixed>|null */
    public function findById(string $id): ?array
    {
        return $this->fetchOne(self::SELECT . ' WHERE u.id = :id', ['id' => $id]);
    }

    /** @return array<string, mixed>|null */
    public function findByEmail(string $email): ?array
    {
        return $this->fetchOne(self::SELECT . ' WHERE u.email = :email', ['email' => $email]);
    }

    /**
     * Cari pemilik sebuah NIK.
     *
     * $exceptId dipakai saat mengubah profil: NIK milik user yang sedang diedit
     * sendiri tidak boleh dihitung bentrok, jadi menyimpan form tanpa mengubah
     * NIK tetap berhasil. Pengecualian itu ditaruh di sini, bukan di controller,
     * supaya tidak ada pemanggil yang lupa memasangnya.
     *
     * Perbandingannya memakai `=` dengan collation kolomnya (utf8mb4_unicode_ci),
     * jadi hasilnya persis sama dengan yang diterima atau ditolak indeks UNIQUE
     * di database -- huruf besar/kecil dan spasi di ujung diperlakukan sama.
     * Kalau keduanya tidak sepakat, pemeriksaan ini akan meloloskan nilai yang
     * kemudian ditolak database sebagai 500.
     *
     * @return array<string, mixed>|null
     */
    public function findByNik(string $nik, ?string $exceptId = null): ?array
    {
        if ($exceptId === null) {
            return $this->fetchOne(self::SELECT . ' WHERE u.nik = :nik', ['nik' => $nik]);
        }

        return $this->fetchOne(
            self::SELECT . ' WHERE u.nik = :nik AND u.id <> :except_id',
            ['nik' => $nik, 'except_id' => $exceptId]
        );
    }

    /**
     * Simpan profil baru.
     *
     * id diambil dari claim "sub" milik token, bukan dari body request, jadi
     * seseorang tidak bisa mendaftarkan profil atas nama UID orang lain.
     *
     * @param array{id: string, email: string, nik: string, name: string, division_id: int, role: string} $user
     */
    public function create(array $user): void
    {
        $this->execute(
            'INSERT INTO users (id, email, nik, name, division_id, role)
                  VALUES (:id, :email, :nik, :name, :division_id, :role)',
            $user
        );
    }

    public function updateRole(string $id, string $role): int
    {
        return $this->execute(
            'UPDATE users SET role = :role WHERE id = :id',
            ['role' => $role, 'id' => $id]
        );
    }

    /**
     * Ubah sebagian kolom saja.
     *
     * Bentuknya mengikuti setDoc(..., { merge: true }) yang dipakai AdminPanel:
     * satu tombol menyimpan nama/NIK/divisi, tombol lain hanya mengubah role.
     * Kolom yang tidak dikirim tidak disentuh.
     *
     * @param array<string, mixed> $kolom hanya nama kolom yang sudah divalidasi
     */
    public function updatePartial(string $id, array $kolom): int
    {
        if ($kolom === []) {
            return 0;
        }

        $set = [];

        foreach (array_keys($kolom) as $nama) {
            // Nama kolom berasal dari daftar tetap di UserController, tidak
            // pernah dari body request.
            $set[] = $nama . ' = :' . $nama;
        }

        $kolom['id'] = $id;

        return $this->execute(
            'UPDATE users SET ' . implode(', ', $set) . ' WHERE id = :id',
            $kolom
        );
    }

    /**
     * Mode purge: hapus user beserta seluruh barisnya di tabel lain.
     *
     * Keempat tabel terhubung dengan ON DELETE RESTRICT, jadi user tidak bisa
     * dihapus selama masih punya baris di mana pun. Urutannya: anak dulu, induk
     * belakangan, semuanya dalam satu transaksi.
     *
     * tech_logs dihapus lewat user_id maupun NIK. Alasannya sama seperti di
     * TechLogModel: sebagian log hasil migrasi tercatat atas nama user penampung
     * dan hanya bisa dikenali lewat NIK. Ini juga menyalin deleteUserAndLogs()
     * di auth.ts, yang memang menghapus berdasarkan NIK.
     *
     * @return array{tech_logs: int, audit_logs: int, bug_reports: int}
     */
    public function purgeWithData(string $id, string $nik): array
    {
        return $this->transaction(function () use ($id, $nik): array {
            $logs = $this->execute(
                'DELETE FROM tech_logs WHERE user_id = :user_id OR (nik_snapshot <> \'\' AND nik_snapshot = :nik)',
                ['user_id' => $id, 'nik' => $nik]
            );

            $audit = $this->execute('DELETE FROM audit_logs WHERE user_id = :id', ['id' => $id]);
            $bug   = $this->execute('DELETE FROM tech_bug_reports WHERE user_id = :id', ['id' => $id]);

            $this->execute('DELETE FROM users WHERE id = :id', ['id' => $id]);

            return [
                'tech_logs'   => $logs,
                'audit_logs'  => $audit,
                'bug_reports' => $bug,
            ];
        });
    }

    /**
     * Mode detach: hapus barisnya di users saja, datanya dialihkan.
     *
     * Seluruh baris milik user dipindahkan ke akun penampung, lalu barisnya di
     * tabel users dihapus. Tidak ada satu baris pun yang hilang.
     *
     * Tiga hal yang sengaja tidak disentuh:
     *
     * 1. Kolom snapshot (display_name, nik_snapshot, supervisor). Justru itu
     *    yang membuat histori tetap terbaca atas nama teknisi aslinya walaupun
     *    pemiliknya sudah jadi akun penampung.
     * 2. Baris yang NIK-nya sama tapi user_id-nya milik orang lain. Berbeda
     *    dengan purge, di sini yang dipindahkan hanya yang benar-benar terikat
     *    foreign key ke user ini -- memindahkan milik orang lain justru merusak
     *    data yang sedang kita jaga.
     * 3. Kolom updated_at pada tech_logs. Tanpa "updated_at = updated_at",
     *    ON UPDATE CURRENT_TIMESTAMP akan menandai seluruh log lama seolah baru
     *    saja diedit hari ini.
     *
     * @return array{tech_logs: int, audit_logs: int, bug_reports: int}
     */
    public function detachAndDelete(string $id, string $legacyUserId): array
    {
        return $this->transaction(function () use ($id, $legacyUserId): array {
            $logs = $this->execute(
                'UPDATE tech_logs SET user_id = :legacy, updated_at = updated_at WHERE user_id = :id',
                ['legacy' => $legacyUserId, 'id' => $id]
            );

            $audit = $this->execute(
                'UPDATE audit_logs SET user_id = :legacy WHERE user_id = :id',
                ['legacy' => $legacyUserId, 'id' => $id]
            );

            $bug = $this->execute(
                'UPDATE tech_bug_reports SET user_id = :legacy WHERE user_id = :id',
                ['legacy' => $legacyUserId, 'id' => $id]
            );

            $this->execute('DELETE FROM users WHERE id = :id', ['id' => $id]);

            return [
                'tech_logs'   => $logs,
                'audit_logs'  => $audit,
                'bug_reports' => $bug,
            ];
        });
    }

    /**
     * Susun klausa WHERE beserta parameternya.
     *
     * Yang disambung ke string SQL hanya potongan tetap yang ditulis di kode
     * ini; nilai dari user selalu masuk lewat parameter.
     *
     * @param array{search?: ?string, role?: ?string, division?: ?string} $filters
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function buildFilter(array $filters): array
    {
        $conditions = [];
        $params     = [];

        $search = $filters['search'] ?? null;

        if ($search !== null && $search !== '') {
            // Tiap kolom memakai placeholder sendiri walaupun nilainya sama.
            // Prepared statement asli MySQL (PDO::ATTR_EMULATE_PREPARES=false)
            // tidak mengizinkan satu nama placeholder dipakai berulang --
            // hasilnya SQLSTATE[HY093] Invalid parameter number.
            $conditions[] = '(u.name LIKE :search_name'
                . ' OR u.email LIKE :search_email'
                . ' OR u.nik LIKE :search_nik)';

            $needle = '%' . $this->escapeLike($search) . '%';

            $params['search_name']  = $needle;
            $params['search_email'] = $needle;
            $params['search_nik']   = $needle;
        }

        $role = $filters['role'] ?? null;

        if ($role !== null && $role !== '') {
            $conditions[]   = 'u.role = :role';
            $params['role'] = $role;
        }

        $division = $filters['division'] ?? null;

        if ($division !== null && $division !== '') {
            $conditions[]       = 'd.name = :division';
            $params['division'] = $division;
        }

        return [
            $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions),
            $params,
        ];
    }
}
