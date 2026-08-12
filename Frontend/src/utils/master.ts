import { api } from './api';
import { urutkanDelayCode, urutkanKategori } from './masterOrder';

export { asRecord } from './masterOrder';

/**
 * Tabel master dari backend: divisi, supervisor, kategori, kode delay.
 *
 * Sebelumnya keempatnya ditulis tetap di frontend -- KATEGORI_CODES dan
 * DELAY_CODES di types.ts, OFFICIAL_SUPERVISORS di BatchUpdateModal.tsx, dan
 * daftar divisi sebagai <option> di Login.tsx. Karena disalin di beberapa
 * tempat, isinya sempat berbeda-beda. Selama salinan itu masih dipakai,
 * perbaikan di database tidak akan terlihat di layar.
 *
 * Untuk sekarang baru divisi yang dipindahkan ke sini, sesuai tahap
 * penyambungan. Sisanya menyusul.
 */

export interface Division {
  id: number;
  name: string;
}

export interface Category {
  code: string;
  name: string;
  /** Dipakai untuk mengelompokkan tanpa menebak dari awalan kodenya. */
  type: 'Productive' | 'Delay' | 'Break';
}

export interface DelayCode {
  code: string;
  name: string;
  /** Kode kategori induknya: D1, D2, ... */
  category_code: string;
}

export interface Supervisor {
  id: number;
  name: string;
}


/**
 * GET /api/master/divisions
 *
 * Satu-satunya endpoint master yang tidak mensyaratkan baris di tabel `users`:
 * yang membutuhkannya justru user yang belum terdaftar, saat mengisi form
 * "Lengkapi Profil". Tokennya tetap wajib sah.
 *
 * Hanya divisi dengan is_active = TRUE yang dikirim, terurut menurut nama.
 */
export const fetchDivisions = async (): Promise<Division[]> => {
  const data = await api.get<Division[]>('/api/master/divisions');

  return Array.isArray(data) ? data : [];
};

/**
 * GET /api/master/categories -- menggantikan KATEGORI_CODES di types.ts.
 *
 * Perlu baris di tabel users, tidak seperti divisions. Itu tidak masalah:
 * yang membutuhkannya hanya layar setelah login.
 */
export const fetchCategories = async (): Promise<Category[]> => {
  const data = await api.get<Category[]>('/api/master/categories');

  return urutkanKategori(Array.isArray(data) ? data : []);
};

/**
 * GET /api/master/delay-codes -- menggantikan DELAY_CODES di types.ts.
 *
 * Diurutkan menurut kategori induk lalu kode. Ini satu-satunya urutan yang
 * BERUBAH dibandingkan konstanta lama: urutan lamanya (SP, TL, PR, OP, AC, AP,
 * WX, OT) tidak mengikuti aturan apa pun yang bisa diturunkan dari datanya --
 * bukan menurut kode, bukan menurut kategori. Satu-satunya cara mempertahankan
 * persis adalah menuliskan ulang daftarnya di sini, dan itu justru menghidupkan
 * kembali masalah yang sedang dihapus.
 */
export const fetchDelayCodes = async (): Promise<DelayCode[]> => {
  const data = await api.get<DelayCode[]>('/api/master/delay-codes');

  return urutkanDelayCode(Array.isArray(data) ? data : []);
};

/**
 * GET /api/master/supervisors -- menggantikan <option> tetap di InputForm.
 *
 * Sudah terurut menurut nama di server, sama seperti daftar lama yang kebetulan
 * memang alfabetis. Isinya yang bisa berbeda: 03_align_master_data.sql menambah
 * baris ke tabel ini.
 */
export const fetchSupervisors = async (): Promise<Supervisor[]> => {
  const data = await api.get<Supervisor[]>('/api/master/supervisors');

  return Array.isArray(data) ? data : [];
};

