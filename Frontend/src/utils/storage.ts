import { LogActivity } from '../types';
import { ApiError, api, apiRequest } from './api';

/**
 * Aktivitas teknisi (tabel tech_logs), lewat backend Slim.
 *
 * Dulu berkas ini membaca seluruh collection tech_logs setiap halaman dibuka.
 * Sekarang rentang tanggalnya dikirim sebagai filter ke server, dan yang
 * kembali hanya baris di dalam rentang itu -- untuk 6.000+ baris di MySQL lewat
 * hosting bersama, perbedaannya besar.
 *
 * Dua nilai tidak lagi dibuat di browser karena server yang menentukannya:
 *
 *   id                UUID buatan server. Yang lama, 7 karakter acak dari
 *                     Math.random(), bisa bentrok dan tidak muat di CHAR(36).
 *   duration_minutes  dihitung ulang server dari start_time dan finish_time,
 *                     rumusnya sama termasuk shift malam yang lewat tengah
 *                     malam. Nilai kiriman browser diabaikan.
 */

/** Batas satu halaman. 500 adalah API_MAX_LIMIT di .env backend. */
const LIMIT_HALAMAN = 500;

/**
 * Pengaman supaya perulangan tidak pernah jadi tak berujung kalau `has_more`
 * dari server tidak pernah menjadi false. 20 x 500 = 10.000 baris, sementara
 * seluruh tabel baru 6.000-an -- jadi batas ini tidak akan tersentuh oleh
 * rentang tanggal yang wajar.
 */
const MAKS_HALAMAN = 20;

/**
 * Merapikan nama supervisor dan teknisi di browser.
 *
 * Dipertahankan apa adanya dari versi Firestore supaya yang tampil di layar
 * tidak berubah, dan supaya penyaringan di ActivityList -- yang memakai nama
 * sebagai kunci cadangan ketika NIK kosong -- tetap cocok seperti sebelumnya.
 *
 * Sekarang sebenarnya menambal di tempat yang salah: kalau nama di database
 * memang belum rapi, yang perlu diperbaiki datanya, bukan tampilannya. Layak
 * dibuang setelah isi tabel dipastikan bersih.
 */
export const normalizeName = (name: any): string => {
  if (!name || typeof name !== 'string') return typeof name === 'string' ? name : String(name || '');
  let clean = name.replace(/\s+/g, ' ').trim().toLowerCase();
  clean = clean.replace(/^(pak|bapak)\s+/, '');
  return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const rapikan = (log: LogActivity): LogActivity => ({
  ...log,
  supervisor: normalizeName(log.supervisor),
  nama_technician: normalizeName(log.nama_technician),
});

/**
 * GET /api/tech-logs dalam rentang tanggal.
 *
 * Halamannya diambil sampai habis, bukan dipotong di halaman pertama. Dashboard
 * dan ResumeTab menghitung statistik dari seluruh baris yang diterimanya, jadi
 * memotong diam-diam di baris ke-500 membuat angkanya salah tanpa ada yang
 * sadar. Ini tetap bukan "tarik semua data": yang diambil hanya rentang tanggal
 * yang sedang dipilih user.
 *
 * Kegagalan dikembalikan sebagai daftar kosong, sama seperti versi sebelumnya.
 * Efek sampingnya tetap sama juga: backend yang mati terlihat persis seperti
 * "belum ada aktivitas". Alasannya belum ada tempat di layar untuk menampilkan
 * kegagalan pengambilan daftar.
 */
export const fetchLogs = async (startDate?: string, endDate?: string): Promise<LogActivity[]> => {
  const params = new URLSearchParams();

  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);

  params.set('limit', String(LIMIT_HALAMAN));

  const semua: LogActivity[] = [];

  try {
    for (let halaman = 0; halaman < MAKS_HALAMAN; halaman++) {
      params.set('offset', String(halaman * LIMIT_HALAMAN));

      const r = await apiRequest<LogActivity[]>(`/api/tech-logs?${params.toString()}`);

      semua.push(...(r.data ?? []).map(rapikan));

      if (!r.meta?.has_more) {
        return semua;
      }
    }

    console.warn(
      `Berhenti di ${MAKS_HALAMAN} halaman (${semua.length} baris) padahal server bilang masih ada sisa. ` +
      'Persempit rentang tanggalnya, atau naikkan MAKS_HALAMAN di utils/storage.ts.'
    );

    return semua;
  } catch (e) {
    console.error("Gagal mengambil daftar aktivitas", e);
    return [];
  }
};

/**
 * POST /api/tech-logs
 *
 * Server yang membuat id dan menghitung duration_minutes, jadi yang
 * dikembalikan adalah baris hasil simpan -- bukan tebakan dari sisi browser.
 */
export const saveLog = async (log: Omit<LogActivity, 'id' | 'duration_minutes'>): Promise<LogActivity> => {
  try {
    return rapikan(await api.post<LogActivity>('/api/tech-logs', log));
  } catch (e) {
    // ApiError diteruskan apa adanya: pesannya dari server dan jauh lebih
    // berguna daripada kalimat umum -- misalnya kode kategori yang tidak ada
    // di master, atau karyawan yang mencatat untuk tanggal selain hari ini.
    if (e instanceof ApiError) throw e;
    console.error("Gagal simpan aktivitas", e);
    throw Error("Gagal menyimpan data aktivitas");
  }
};

/** PUT /api/tech-logs/{id} */
export const updateLog = async (
  id: string,
  log: Omit<LogActivity, 'id' | 'duration_minutes'>
): Promise<LogActivity> => {
  try {
    return rapikan(await api.put<LogActivity>(`/api/tech-logs/${encodeURIComponent(id)}`, log));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error("Gagal mengupdate aktivitas", e);
    throw Error("Gagal mengupdate data aktivitas");
  }
};

/**
 * DELETE /api/tech-logs/{id}
 *
 * Aturan "karyawan hanya boleh menghapus log hari ini" sekarang ditegakkan
 * server juga, jadi penolakan bisa datang sebagai 403 walaupun tombolnya
 * terlihat aktif. Pemanggil wajib menangkapnya.
 */
export const deleteLog = async (id: string): Promise<void> => {
  try {
    await api.delete(`/api/tech-logs/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error("Gagal menghapus aktivitas", e);
    throw Error("Gagal menghapus data aktivitas");
  }
};

/**
 * Belum ada padanannya di backend.
 *
 * Versi lamanya menghapus seluruh collection tech_logs di Firestore. Kalau
 * dibiarkan hidup, ia menghapus data di tempat yang sudah tidak dibaca aplikasi
 * -- tampak berhasil, padahal tidak mengubah apa pun di MariaDB. Karena itu
 * sengaja dibuat gagal keras, dan tombol pemanggilnya di AdminPanel
 * dinonaktifkan.
 */
export const clearLogs = async (): Promise<never> => {
  throw Error(
    'Fitur "Kosongkan Tabel" belum tersedia. Backend belum punya endpoint hapus massal, ' +
    'dan yang lama menghapus di Firestore yang sudah tidak dipakai.'
  );
};
