<?php

declare(strict_types=1);

namespace App\Helpers;

use App\Models\AuditLogModel;
use Throwable;

/**
 * Pencatat aksi admin ke audit_logs.
 *
 * Siapa yang tercatat sebagai pelaku
 * ----------------------------------
 * Selalu adminnya, tidak pernah pelamarnya. Bukan pilihan gaya: audit_logs.user_id
 * punya foreign key ke users, sedangkan pelamar yang ditolak justru TIDAK punya
 * baris di sana. Kebetulan itu jatuh di tempat yang benar -- yang perlu
 * dipertanggungjawabkan memang keputusan adminnya, bukan permintaan pelamarnya.
 *
 * Identitas pelamar (email dan NIK) ikut ditulis di kolom description yang
 * bertipe TEXT, jadi jejaknya tetap lengkap.
 *
 * Kenapa kegagalannya dikembalikan, bukan dilempar atau ditelan
 * -------------------------------------------------------------
 * Pencatatan terjadi SETELAH perubahannya tersimpan. Kalau kegagalan menulis
 * audit dibiarkan naik sebagai exception, admin menerima 500 dan mengira
 * persetujuannya batal -- padahal sudah terjadi. Kalau ditelan diam-diam,
 * catatan yang seharusnya wajib ada bisa hilang tanpa ada yang tahu.
 *
 * Jadi hasilnya dikembalikan sebagai bool, dan pemanggil menempelkan peringatan
 * ke pesan sukses. Aksinya tetap berhasil, dan admin tahu catatannya tidak
 * tertulis.
 */
final class Audit
{
    /** Ditempelkan pemanggil ke pesan sukses saat pencatatan gagal. */
    public const PERINGATAN_GAGAL = ' (Peringatan: tindakan ini gagal dicatat di audit log.)';

    public function __construct(private AuditLogModel $logs)
    {
    }

    /**
     * @param array<string, mixed> $pelaku baris users admin yang bertindak
     * @return bool                        false kalau pencatatannya gagal
     */
    public function record(array $pelaku, string $action, ?string $description = null): bool
    {
        try {
            $this->logs->insert([
                'id'      => Uuid::v4(),
                'user_id' => (string) ($pelaku['id'] ?? ''),
                // Kolomnya VARCHAR(100). Dipotong di sini supaya aksi dengan
                // keterangan panjang tidak berakhir sebagai error database.
                'action'      => mb_substr($action, 0, 100),
                'description' => $description,
            ]);

            return true;
        } catch (Throwable $e) {
            error_log('Gagal menulis audit log: ' . $e->getMessage());

            return false;
        }
    }

    /** Pesan sukses beserta peringatan kalau pencatatannya gagal. */
    public static function pesan(string $pesan, bool $tercatat): string
    {
        return $tercatat ? $pesan : $pesan . self::PERINGATAN_GAGAL;
    }
}
