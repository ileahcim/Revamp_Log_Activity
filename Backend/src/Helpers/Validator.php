<?php

declare(strict_types=1);

namespace App\Helpers;

/**
 * Validasi input sebelum menyentuh database.
 *
 * Dipakai berantai:
 *
 *     $v = new Validator($body);
 *     $v->required('tanggal')->date('tanggal')
 *       ->required('shift')->in('shift', ['Pagi', 'Siang', 'Malam'])
 *       ->max('wo_notif', 100);
 *     if ($v->fails()) { ... }
 *
 * Setiap field hanya menyimpan satu pesan error, yaitu yang pertama gagal,
 * supaya pesan yang sampai ke user tidak bertumpuk.
 */
final class Validator
{
    /** @var array<string, string> */
    private array $errors = [];

    /** @param array<string, mixed> $data */
    public function __construct(private array $data)
    {
    }

    // -----------------------------------------------------------------------
    // Aturan
    // -----------------------------------------------------------------------

    public function required(string $field, ?string $label = null): self
    {
        $value = $this->raw($field);

        if ($value === null || (is_string($value) && trim($value) === '') || $value === []) {
            $this->fail($field, sprintf('%s wajib diisi.', $this->label($field, $label)));
        }

        return $this;
    }

    public function max(string $field, int $length, ?string $label = null): self
    {
        $value = $this->raw($field);

        if (is_string($value) && mb_strlen($value) > $length) {
            $this->fail($field, sprintf(
                '%s maksimal %d karakter, saat ini %d karakter.',
                $this->label($field, $label),
                $length,
                mb_strlen($value)
            ));
        }

        return $this;
    }

    /** @param list<string> $allowed */
    public function in(string $field, array $allowed, ?string $label = null): self
    {
        $value = $this->raw($field);

        if ($value !== null && $value !== '' && !in_array($value, $allowed, true)) {
            $this->fail($field, sprintf(
                '%s harus salah satu dari: %s.',
                $this->label($field, $label),
                implode(', ', $allowed)
            ));
        }

        return $this;
    }

    /** Format YYYY-MM-DD, sekaligus memastikan tanggalnya benar-benar ada. */
    public function date(string $field, ?string $label = null): self
    {
        $value = $this->raw($field);

        if ($value !== null && $value !== '' && !self::isValidDate((string) $value)) {
            $this->fail($field, sprintf('%s harus tanggal dengan format YYYY-MM-DD.', $this->label($field, $label)));
        }

        return $this;
    }

    /** Format HH:mm atau HH:mm:ss. */
    public function time(string $field, ?string $label = null): self
    {
        $value = $this->raw($field);

        if ($value !== null && $value !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', (string) $value)) {
            $this->fail($field, sprintf('%s harus jam dengan format HH:mm.', $this->label($field, $label)));
        }

        return $this;
    }

    public function integer(string $field, ?int $min = null, ?int $max = null, ?string $label = null): self
    {
        $value = $this->raw($field);

        if ($value === null || $value === '') {
            return $this;
        }

        if (!is_int($value) && !(is_string($value) && preg_match('/^-?\d+$/', $value))) {
            $this->fail($field, sprintf('%s harus berupa angka bulat.', $this->label($field, $label)));

            return $this;
        }

        $number = (int) $value;

        if ($min !== null && $number < $min) {
            $this->fail($field, sprintf('%s minimal %d.', $this->label($field, $label), $min));
        } elseif ($max !== null && $number > $max) {
            $this->fail($field, sprintf('%s maksimal %d.', $this->label($field, $label), $max));
        }

        return $this;
    }

    public function numeric(string $field, ?float $min = null, ?float $max = null, ?string $label = null): self
    {
        $value = $this->raw($field);

        if ($value === null || $value === '') {
            return $this;
        }

        if (!is_numeric($value)) {
            $this->fail($field, sprintf('%s harus berupa angka.', $this->label($field, $label)));

            return $this;
        }

        if ($min !== null && (float) $value < $min) {
            $this->fail($field, sprintf('%s minimal %s.', $this->label($field, $label), $min));
        } elseif ($max !== null && (float) $value > $max) {
            $this->fail($field, sprintf('%s maksimal %s.', $this->label($field, $label), $max));
        }

        return $this;
    }

    public function email(string $field, ?string $label = null): self
    {
        $value = $this->raw($field);

        if ($value !== null && $value !== '' && filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
            $this->fail($field, sprintf('%s bukan alamat email yang sah.', $this->label($field, $label)));
        }

        return $this;
    }

    // -----------------------------------------------------------------------
    // Hasil
    // -----------------------------------------------------------------------

    public function fails(): bool
    {
        return $this->errors !== [];
    }

    /** @return array<string, string> */
    public function errors(): array
    {
        return $this->errors;
    }

    /** Pesan ringkas untuk ditampilkan di toast frontend. */
    public function firstError(): string
    {
        return (string) (reset($this->errors) ?: 'Data yang dikirim tidak valid.');
    }

    // -----------------------------------------------------------------------
    // Pengambilan nilai
    // -----------------------------------------------------------------------

    /** Nilai apa adanya, tanpa pembersihan. */
    public function raw(string $field): mixed
    {
        return $this->data[$field] ?? null;
    }

    /** String yang sudah di-trim. Mengembalikan null kalau kosong. */
    public function string(string $field, ?string $default = null): ?string
    {
        $value = $this->raw($field);

        if ($value === null || is_array($value)) {
            return $default;
        }

        $value = trim((string) $value);

        return $value === '' ? $default : $value;
    }

    public function int(string $field, ?int $default = null): ?int
    {
        $value = $this->raw($field);

        return $value === null || $value === '' || !is_numeric($value) ? $default : (int) $value;
    }

    public function float(string $field, ?float $default = null): ?float
    {
        $value = $this->raw($field);

        return $value === null || $value === '' || !is_numeric($value) ? $default : (float) $value;
    }

    // -----------------------------------------------------------------------

    private function fail(string $field, string $message): void
    {
        // Error pertama yang menang, sisanya diabaikan.
        $this->errors[$field] ??= $message;
    }

    private function label(string $field, ?string $label): string
    {
        return $label ?? str_replace('_', ' ', $field);
    }

    private static function isValidDate(string $value): bool
    {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
            return false;
        }

        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }
}
