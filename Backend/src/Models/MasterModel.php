<?php

declare(strict_types=1);

namespace App\Models;

/**
 * Query untuk keempat tabel master.
 *
 * Dipakai dua arah: sebagai sumber pilihan dropdown di frontend, dan sebagai
 * pemeriksa saat data masuk. Kolom kategori_code dan delay_code di tech_logs
 * tidak punya foreign key di schema V1.0, jadi satu-satunya yang mencegah kode
 * asal-asalan masuk ke database adalah pemeriksaan di sini.
 *
 * Baris yang is_active = FALSE tetap dianggap sah saat memeriksa data lama,
 * tapi tidak ikut ditawarkan sebagai pilihan baru.
 */
final class MasterModel extends BaseModel
{
    // -----------------------------------------------------------------------
    // Daftar untuk dropdown
    // -----------------------------------------------------------------------

    /** @return list<array<string, mixed>> */
    public function divisions(): array
    {
        return $this->fetchAll(
            'SELECT id, name FROM master_divisions WHERE is_active = 1 ORDER BY name ASC'
        );
    }

    /** @return list<array<string, mixed>> */
    public function supervisors(): array
    {
        return $this->fetchAll(
            'SELECT id, name FROM master_supervisors WHERE is_active = 1 ORDER BY name ASC'
        );
    }

    /** @return list<array<string, mixed>> */
    public function categories(): array
    {
        return $this->fetchAll(
            'SELECT code, name, type FROM master_categories WHERE is_active = 1 ORDER BY code ASC'
        );
    }

    /** @return list<array<string, mixed>> */
    public function delayCodes(): array
    {
        return $this->fetchAll(
            'SELECT code, name, category_code FROM master_delay_codes WHERE is_active = 1 ORDER BY code ASC'
        );
    }

    // -----------------------------------------------------------------------
    // Pemeriksaan saat data masuk
    // -----------------------------------------------------------------------

    public function divisionIdByName(string $name): ?int
    {
        $id = $this->fetchValue(
            'SELECT id FROM master_divisions WHERE name = :name AND is_active = 1',
            ['name' => $name]
        );

        return $id === null ? null : (int) $id;
    }

    public function categoryExists(string $code): bool
    {
        return $this->fetchValue(
            'SELECT 1 FROM master_categories WHERE code = :code',
            ['code' => $code]
        ) !== null;
    }

    public function delayCodeExists(string $code): bool
    {
        return $this->fetchValue(
            'SELECT 1 FROM master_delay_codes WHERE code = :code',
            ['code' => $code]
        ) !== null;
    }

    // -----------------------------------------------------------------------
    // Daftar ringkas untuk pesan error "pilih salah satu dari ..."
    // -----------------------------------------------------------------------

    /** @return list<string> */
    public function divisionNames(): array
    {
        return $this->kolomPertama($this->divisions(), 'name');
    }

    /** @return list<string> */
    public function categoryCodeList(): array
    {
        return $this->kolomPertama($this->categories(), 'code');
    }

    /** @return list<string> */
    public function delayCodeList(): array
    {
        return $this->kolomPertama($this->delayCodes(), 'code');
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<string>
     */
    private function kolomPertama(array $rows, string $kolom): array
    {
        return array_map(static fn (array $row): string => (string) $row[$kolom], $rows);
    }
}
