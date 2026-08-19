/**
 * Penulisan waktu untuk layar-layar persetujuan pendaftaran.
 *
 * Backend mengirim waktu dalam format ISO 8601 lengkap dengan zona (date('c')
 * di PHP), jadi Date() mengurainya dengan benar dan yang ditampilkan di sini
 * sudah waktu lokal pembacanya.
 *
 * Sengaja tidak memakai toLocaleString(): hasilnya berbeda-beda menurut setelan
 * browser, dan tabel yang kolom waktunya berubah lebar tiap komputer lebih
 * merepotkan daripada satu format tetap.
 */
export const formatWaktu = (iso: string | null | undefined): string => {
  if (!iso) return '-';

  const d = new Date(iso);

  // Berkas JSON di server bisa saja berisi nilai yang tidak terbaca kalau
  // pernah disunting tangan. Lebih baik "-" daripada "Invalid Date".
  if (Number.isNaN(d.getTime())) return '-';

  const p = (n: number) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
