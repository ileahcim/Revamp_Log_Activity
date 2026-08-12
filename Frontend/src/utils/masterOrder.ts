/**
 * Urutan tampil data master.
 *
 * Dipisah dari master.ts supaya bisa diuji tanpa menyeret utils/api.ts dan
 * Firebase SDK ikut termuat. Isinya fungsi murni, tanpa import apa pun.
 */

export interface BarisKode {
  code: string;
  name: string;
}

export interface BarisKategori extends BarisKode {
  type: string;
}

export interface BarisDelay extends BarisKode {
  category_code: string;
}

/**
 * Server mengurutkan kategori `ORDER BY code ASC`, yang menghasilkan
 * B, D1..D5, P1..P4 -- Break melompat ke urutan pertama di setiap dropdown,
 * Dashboard, dan sheet Excel. Konstanta KATEGORI_CODES yang digantikan berurut
 * P1..P4, D1..D5, B.
 *
 * Urutan itu dikembalikan lewat kolom `type`, bukan dengan menuliskan ulang
 * daftar kodenya: kategori baru yang ditambahkan di database ikut jatuh ke
 * kelompok yang benar tanpa menyentuh berkas ini.
 */
const URUTAN_TIPE: Record<string, number> = { Productive: 0, Delay: 1, Break: 2 };

export const urutkanKategori = <T extends BarisKategori>(rows: T[]): T[] =>
  rows.slice().sort((a, b) => {
    const selisih = (URUTAN_TIPE[a.type] ?? 99) - (URUTAN_TIPE[b.type] ?? 99);

    return selisih !== 0 ? selisih : a.code.localeCompare(b.code);
  });

/**
 * Kode delay dikelompokkan menurut kategori induknya, lalu menurut kode.
 *
 * Ini satu-satunya urutan yang BERUBAH dibandingkan konstanta lama. Urutan
 * lamanya -- SP, TL, PR, OP, AC, AP, WX, OT -- tidak mengikuti aturan apa pun
 * yang bisa diturunkan dari datanya: bukan menurut kode, dan bukan menurut
 * category_code (PR dan AC sama-sama D2 tapi dipisahkan oleh OP yang D3).
 * Satu-satunya cara mempertahankannya persis adalah menuliskan ulang daftarnya
 * di sini, dan itu menghidupkan kembali masalah yang sedang dihapus.
 */
export const urutkanDelayCode = <T extends BarisDelay>(rows: T[]): T[] =>
  rows.slice().sort((a, b) =>
    a.category_code === b.category_code
      ? a.code.localeCompare(b.code)
      : a.category_code.localeCompare(b.category_code)
  );

/** Bentuk Record<code, name>, sama seperti KATEGORI_CODES dan DELAY_CODES lama. */
export const asRecord = (rows: BarisKode[]): Record<string, string> =>
  Object.fromEntries(rows.map(r => [r.code, r.name]));
