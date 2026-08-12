import { ApiError, api, apiRequest } from './api';

/**
 * User, sesi, dan catatan audit -- seluruhnya lewat backend Slim.
 *
 * Tidak ada lagi Firestore di berkas ini. Yang ikut hilang bersamanya:
 *
 *   DEFAULT_USERS  empat user karangan yang dituliskan ke database kalau
 *                  collection users kosong, lalu dipakai seolah nyata
 *   saveUser       tidak pernah dipanggil dari mana pun
 *   getCurrentUser selalu mengembalikan null sejak App.tsx mengambil alih
 */

export interface User {
  id: string; // matches Firebase UID
  email: string;
  name: string;
  role: 'karyawan' | 'atasan' | 'admin';
  nik?: string;
  divisi?: string;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
}

/** Isi awal form "Lengkapi Profil", diambil backend dari isi token. */
export interface ProfilePrefill {
  id: string;
  email: string;
  name: string;
}

export interface SyncResult {
  registered: boolean;
  user: User | null;
  prefill: ProfilePrefill | null;
}

/**
 * POST /api/auth/sync -- dipanggil sekali setiap selesai login Google, dan
 * setiap halaman dimuat ulang.
 *
 * Menggantikan pembacaan getDoc(doc(db, 'users', uid)) di Login.tsx dan App.tsx.
 * Akun yang belum terdaftar bukan error: endpointnya tetap menjawab 200 dengan
 * registered = false, dan isi awal formnya ada di prefill.
 *
 * Promosi super admin juga terjadi di sini, di server, berdasarkan
 * SUPER_ADMIN_EMAIL di .env -- bukan lagi ditulis frontend ke Firestore.
 */
export const syncSession = async (): Promise<SyncResult> => {
  const data = await api.post<{
    registered: boolean;
    user: User | null;
    prefill?: ProfilePrefill;
  }>('/api/auth/sync');

  return {
    registered: data.registered === true,
    user: data.user ?? null,
    prefill: data.prefill ?? null,
  };
};

/**
 * POST /api/auth/register -- membuat baris users untuk akun Google yang baru.
 *
 * Hanya nama, NIK, dan divisi yang dipercaya dari sini. id, email, dan role
 * diambil server dari token; kalau ketiganya ikut dikirim, backend
 * mengabaikannya.
 *
 * NIK kembar dijawab 422 dengan errors.nik -- lihat penanganannya di Login.tsx.
 */
export const registerProfile = async (input: {
  name: string;
  nik: string;
  divisi: string;
}): Promise<User> => {
  const data = await api.post<{ registered: boolean; user: User | null }>('/api/auth/register', input);

  if (!data.user) {
    throw new ApiError(500, 'Profil tersimpan, tapi server tidak mengembalikan datanya. Coba muat ulang halaman.');
  }

  return data.user;
};

/**
 * GET /api/auth/me -- profil user yang sedang login, dibaca ulang dari server.
 *
 * Belum dipakai di tahap ini: syncSession() sudah mengembalikan profilnya saat
 * login dan saat halaman dimuat. Disediakan untuk tahap berikutnya, ketika
 * AdminPanel mengubah profil dan tampilan perlu menyegarkan currentUser tanpa
 * memaksa login ulang.
 */
export const fetchMe = async (): Promise<User> => api.get<User>('/api/auth/me');

/** Batas satu halaman; 500 adalah API_MAX_LIMIT di .env backend. */
const LIMIT_HALAMAN = 500;

/**
 * Pengaman supaya perulangan halaman tidak pernah jadi tak berujung. Catatan
 * audit tumbuh terus, jadi rentang tanggal yang sangat lebar bisa menyentuh
 * batas ini -- itulah gunanya penyaringan tanggal dikirim ke server.
 */
const MAKS_HALAMAN = 20;

/**
 * GET /api/users -- seluruh user terdaftar.
 *
 * Boleh dibaca semua user, bukan admin saja: App.tsx meneruskan daftarnya ke
 * Dashboard dan ActivityList untuk memetakan NIK ke divisi. Yang dibatasi
 * khusus admin adalah ubah dan hapus.
 *
 * Halamannya diambil sampai habis. Daftar ini dipakai sebagai kamus pencarian
 * ("siapa pemilik NIK ini"), jadi memotongnya di halaman pertama membuat
 * sebagian teknisi tidak dikenali dan barisnya hilang dari filter divisi.
 * Jumlah user memang jauh lebih kecil daripada jumlah log -- puluhan, bukan
 * ribuan.
 *
 * Daftar user contoh (DEFAULT_USERS) sudah dibuang. Versi lamanya, kalau
 * collection users kosong, menuliskan empat user karangan ke database lalu
 * memakainya seolah nyata.
 */
export const fetchUsers = async (): Promise<User[]> => {
  const semua: User[] = [];

  try {
    for (let halaman = 0; ; halaman++) {
      const r = await apiRequest<User[]>(
        `/api/users?limit=${LIMIT_HALAMAN}&offset=${halaman * LIMIT_HALAMAN}`
      );

      semua.push(...(r.data ?? []));

      if (!r.meta?.has_more) break;
    }
  } catch (e) {
    console.error("Gagal mengambil daftar user", e);
  }

  return semua;
};

/**
 * PUT /api/users/{id} -- khusus admin, hanya mengganti role.
 *
 * Melempar kalau gagal; versi Firestore-nya hanya mencatat ke console sehingga
 * penolakan terlihat seperti berhasil sampai halaman dimuat ulang.
 */
export const updateUserRole = async (
  id: string,
  role: 'karyawan' | 'atasan' | 'admin'
): Promise<User> =>
  api.put<User>(`/api/users/${encodeURIComponent(id)}`, { role });

export const logout = async (user: User | null) => {
  if (user) {
    await addAuditLog(user, 'Logout');
  }
};

/**
 * GET /api/audit-logs -- khusus admin.
 *
 * Penyaringan tanggal dan user dikirim ke server, tidak lagi dikerjakan di
 * browser atas 50 baris terakhir. Bedanya nyata: dulu memilih rentang tanggal
 * lama selalu menghasilkan layar kosong, karena yang disaring cuma 50 baris
 * terbaru dan tak satu pun masuk rentang itu.
 *
 * Penyaringan role tetap di browser -- tabel audit_logs tidak menyimpan role,
 * dan backend tidak menyediakan filternya.
 */
export const fetchAuditLogs = async (filter: {
  userId?: string;
  startDate?: string;
  endDate?: string;
} = {}): Promise<AuditLogItem[]> => {
  const semua: AuditLogItem[] = [];

  try {
    // Diambil sampai habis dalam rentang yang diminta. AdminPanel menampilkan
    // "Total: N logs" dan membaginya per 40 baris; memotong diam-diam di
    // halaman pertama membuat angka total itu berbohong.
    for (let halaman = 0; halaman < MAKS_HALAMAN; halaman++) {
      const params = new URLSearchParams();

      if (filter.userId) params.set('user_id', filter.userId);
      if (filter.startDate) params.set('start_date', filter.startDate);
      if (filter.endDate) params.set('end_date', filter.endDate);

      params.set('limit', String(LIMIT_HALAMAN));
      params.set('offset', String(halaman * LIMIT_HALAMAN));

      const r = await apiRequest<AuditLogItem[]>(`/api/audit-logs?${params.toString()}`);

      semua.push(...(r.data ?? []));

      if (!r.meta?.has_more) break;
    }
  } catch (e) {
    console.error("Gagal mengambil catatan audit", e);
  }

  return semua;
};

/**
 * POST /api/audit-logs
 *
 * Parameter `user` dibiarkan ada supaya pemanggilnya (ActivityList, InputForm,
 * App) tidak perlu diubah, tapi isinya TIDAK dikirim: pelaku selalu diambil
 * server dari pemilik token. Catatan audit yang bisa diisi atas nama orang lain
 * tidak ada gunanya.
 *
 * Kegagalannya sengaja ditelan seperti versi Firestore sebelumnya. Mencatat
 * aktivitas tidak boleh menggagalkan aksi yang sedang dicatat -- log yang gagal
 * tersimpan jauh lebih ringan akibatnya daripada penghapusan yang batal karena
 * pencatatannya error.
 *
 * `action` masuk ke VARCHAR(100); keterangan panjang taruh di `description`
 * yang bertipe TEXT.
 */
export const addAuditLog = async (
  user: User | { id: string, name: string },
  action: string,
  description?: string
) => {
  try {
    await api.post('/api/audit-logs', description ? { action, description } : { action });
  } catch (e) {
    console.error("Gagal mencatat audit log", e);
  }
};

/**
 * PUT /api/users/{id} -- khusus admin.
 *
 * Hanya field yang dikirim yang diubah, sama seperti setDoc({merge:true}).
 * NIK yang sudah dipakai user lain dijawab 422 dengan errors.nik; NIK milik
 * user yang sedang diedit sendiri tidak dihitung bentrok.
 */
export const updateUserProfileByAdmin = async (
  id: string,
  updates: Partial<Pick<User, 'name' | 'nik' | 'divisi'>>
): Promise<User> =>
  api.put<User>(`/api/users/${encodeURIComponent(id)}`, updates);

/** Apa yang terjadi pada data milik user yang dihapus. */
export type DeleteMode = 'purge' | 'detach';

export interface DeleteResult {
  id: string;
  mode: DeleteMode;
  /** Jumlah baris per tabel; kuncinya berbeda menurut mode. */
  deleted?: Record<string, number>;
  detached?: Record<string, number>;
}

/**
 * DELETE /api/users/{id}?mode=purge|detach -- khusus admin.
 *
 *   purge   aktivitas, catatan audit, dan laporan bug miliknya ikut dihapus.
 *           Tidak bisa dibatalkan. Ini yang menyamai perilaku lama.
 *   detach  ketiganya dialihkan ke akun penampung dan tetap tersimpan; kolom
 *           snapshot tidak disentuh sehingga histori tetap terbaca atas nama
 *           teknisi aslinya.
 *
 * Mode wajib disebut, tanpa nilai default -- menghapus data orang tidak boleh
 * terjadi hanya karena satu parameter lupa dikirim.
 *
 * Backend menolak empat hal untuk kedua mode: menghapus akun sendiri, super
 * admin, akun penampung legacy, dan user yang tidak ada.
 */
export const deleteUserAndLogs = async (userId: string, mode: DeleteMode): Promise<DeleteResult> =>
  api.delete<DeleteResult>(`/api/users/${encodeURIComponent(userId)}?mode=${mode}`);