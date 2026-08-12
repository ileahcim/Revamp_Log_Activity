import { api, apiRequest } from './api';

/**
 * Laporan bug (tabel tech_bug_reports), lewat backend Slim.
 *
 * Perbedaan penting dari versi Firestore: gambar tidak lagi ikut di daftar.
 * Isinya data URL hasil kompresi di bawah, ratusan KB per baris, dan satu
 * halaman berisi puluhan laporan bisa jadi belasan MB. Daftar hanya membawa
 * `has_image`; gambarnya diambil saat detail dibuka.
 */

export const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export type BugStatus = 'Open' | 'In Progress' | 'Resolved';

export interface BugReport {
  id: string;
  userId: string;
  userName: string;
  role: string;
  title: string;
  description: string;
  /** Hanya terisi di endpoint detail dan saat laporan baru dibuat. */
  imageBase64?: string;
  /** Ada lampiran atau tidak, tanpa ikut mengunduh gambarnya. */
  has_image?: boolean;
  status: BugStatus;
  timestamp: string;
}

/** Batas satu halaman; 500 adalah API_MAX_LIMIT di .env backend. */
const LIMIT_HALAMAN = 500;

/**
 * GET /api/bug-reports -- tanpa gambar.
 *
 * `filterUserId` tetap diterima supaya pemanggilnya tidak berubah, tapi
 * pembatasannya sekarang juga ditegakkan server: selain admin, hasilnya selalu
 * dipaksa ke laporan milik sendiri, apa pun yang dikirim dari sini.
 *
 * Sudah terurut dari yang terbaru di server (`ORDER BY created_at DESC`).
 */
export const fetchBugReports = async (filterUserId?: string): Promise<BugReport[]> => {
  const semua: BugReport[] = [];

  try {
    for (let halaman = 0; ; halaman++) {
      const params = new URLSearchParams();

      if (filterUserId) params.set('user_id', filterUserId);

      params.set('limit', String(LIMIT_HALAMAN));
      params.set('offset', String(halaman * LIMIT_HALAMAN));

      const r = await apiRequest<BugReport[]>(`/api/bug-reports?${params.toString()}`);

      semua.push(...(r.data ?? []));

      if (!r.meta?.has_more) break;
    }
  } catch (e) {
    console.error("Gagal mengambil laporan bug", e);
  }

  return semua;
};

/**
 * GET /api/bug-reports/{id} -- satu laporan lengkap dengan gambarnya.
 *
 * Dipanggil saat detail dibuka, bukan saat daftar dimuat.
 */
export const fetchBugReport = async (id: string): Promise<BugReport> =>
  api.get<BugReport>(`/api/bug-reports/${encodeURIComponent(id)}`);

/**
 * POST /api/bug-reports
 *
 * userId, userName, dan role yang dikirim BugReportModal diabaikan server --
 * ketiganya diambil dari token dan tabel users. status selalu mulai dari 'Open'.
 */
export const saveBugReport = async (
  report: Omit<BugReport, 'id' | 'status' | 'timestamp'>
): Promise<BugReport> =>
  api.post<BugReport>('/api/bug-reports', {
    title: report.title,
    description: report.description,
    imageBase64: report.imageBase64,
  });

/** PATCH /api/bug-reports/{id} -- khusus admin, hanya mengubah status. */
export const updateBugReportStatus = async (id: string, status: BugStatus): Promise<BugReport> =>
  api.patch<BugReport>(`/api/bug-reports/${encodeURIComponent(id)}`, { status });

/**
 * Warna lencana status, dipakai bersama AdminPanel dan BugReportModal.
 *
 * Sebelumnya keduanya memakai `status === 'Open' ? merah : hijau`. Rumus itu
 * memberi warna hijau kepada 'In Progress' -- terbaca seperti sudah selesai
 * padahal belum. Sekarang statusnya memang bisa bernilai itu, jadi ketiganya
 * dibedakan di satu tempat.
 */
export const bugStatusClass = (status: BugStatus | string): string => {
  if (status === 'Resolved') return 'bg-green-100 text-green-700';
  if (status === 'In Progress') return 'bg-amber-100 text-amber-700';

  return 'bg-red-100 text-red-700';
};
