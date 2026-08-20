import { api, apiRequest } from './api';

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

/**
 * Empat keadaan sebuah akun Google di mata backend.
 *
 *   active        punya baris di tabel users, boleh masuk
 *   unregistered  belum pernah mendaftar -- tampilkan form "Lengkapi Profil"
 *   pending       sudah mendaftar, menunggu persetujuan admin
 *   rejected      pendaftarannya ditolak
 *
 * Tiga yang terakhir sama-sama TIDAK punya baris users, jadi semua endpoint
 * lain menjawab 403. Jangan memuat dashboard untuk salah satunya.
 */
export type RegistrationStatus = 'active' | 'unregistered' | 'pending' | 'rejected';

/** Isi pendaftaran, dikirim balik kepada pemiliknya sendiri. */
export interface RegistrationInfo {
  name: string;
  nik: string;
  divisi: string;
  email: string;
  requested_at: string | null;
  /** Keduanya hanya ada saat status = 'rejected'. */
  rejected_at?: string | null;
  reason?: string | null;
}

export interface SyncResult {
  status: RegistrationStatus;
  /** Sama artinya dengan status === 'active'. Dipertahankan supaya kode lama tidak rusak. */
  registered: boolean;
  user: User | null;
  prefill: ProfilePrefill | null;
  /** Terisi saat status 'pending' atau 'rejected'. */
  registration: RegistrationInfo | null;
  /** Menentukan apakah menu "Kelola super admin" ditampilkan. Bukan pengaman. */
  isSuperAdmin: boolean;
}

/** Bentuk mentah jawaban /auth/sync dan /auth/status. */
interface StatusResponse {
  registered: boolean;
  status?: RegistrationStatus;
  user: User | null;
  prefill?: ProfilePrefill;
  registration?: RegistrationInfo;
  is_super_admin?: boolean;
}

/** Satu penerjemah untuk /auth/sync dan /auth/status, yang isinya memang sama. */
const bacaStatus = (data: StatusResponse): SyncResult => {
  const registered = data.registered === true;

  return {
    // Backend lama (sebelum fitur persetujuan) tidak mengirim `status` sama
    // sekali. Diturunkan dari `registered` supaya frontend ini tetap jalan
    // kalau backendnya belum sempat diperbarui.
    status: data.status ?? (registered ? 'active' : 'unregistered'),
    registered,
    user: data.user ?? null,
    prefill: data.prefill ?? null,
    registration: data.registration ?? null,
    isSuperAdmin: data.is_super_admin === true,
  };
};

/**
 * POST /api/auth/sync -- dipanggil sekali setiap selesai login Google, dan
 * setiap halaman dimuat ulang.
 *
 * Menggantikan pembacaan getDoc(doc(db, 'users', uid)) di Login.tsx dan App.tsx.
 * Akun yang belum terdaftar bukan error: endpointnya tetap menjawab 200 dengan
 * registered = false, dan isi awal formnya ada di prefill.
 *
 * Promosi super admin juga terjadi di sini, di server, berdasarkan
 * SUPER_ADMIN_EMAILS di .env ditambah yang diangkat lewat AdminPanel -- bukan
 * lagi ditulis frontend ke Firestore.
 *
 * Sejak ada persetujuan admin, jawabannya punya empat kemungkinan, bukan dua.
 * Lihat RegistrationStatus di atas.
 */
export const syncSession = async (): Promise<SyncResult> =>
  bacaStatus(await api.post<StatusResponse>('/api/auth/sync'));

/**
 * GET /api/auth/status -- isi yang sama dengan /auth/sync, tanpa efek samping.
 *
 * Dipakai tombol "Periksa lagi" di layar menunggu persetujuan. Ini satu-satunya
 * endpoint yang bisa dipanggil pendaftar yang belum disetujui; sisanya menjawab
 * 403 karena barisnya di tabel users memang belum ada.
 */
export const getStatus = async (): Promise<SyncResult> =>
  bacaStatus(await api.get<StatusResponse>('/api/auth/status'));

/**
 * Hasil pendaftaran. Dua keberhasilan yang berbeda, bukan satu.
 *
 *   active   201 -- baris users langsung dibuat, user boleh masuk sekarang
 *   pending  202 -- masuk antrean, menunggu disetujui admin
 *
 * Versi sebelumnya menganggap jawaban tanpa `user` sebagai kegagalan server dan
 * melempar 500. Sejak Lapis 2 menyala, jawaban seperti itu justru yang normal.
 */
export type RegisterResult =
  | { status: 'active'; user: User; registration: null }
  | { status: 'pending'; user: null; registration: RegistrationInfo | null };

/**
 * POST /api/auth/register -- membuat baris users untuk akun Google yang baru.
 *
 * Hanya nama, NIK, dan divisi yang dipercaya dari sini. id, email, dan role
 * diambil server dari token; kalau ketiganya ikut dikirim, backend
 * mengabaikannya.
 *
 * NIK yang tidak bisa dipakai dijawab 422 dengan errors.nik -- lihat
 * penanganannya di Login.tsx. Pesannya SELALU sama apa pun sebabnya (tidak
 * dikenal, sudah dipakai, atau sedang diantre orang lain); jangan menambahkan
 * tebakan di sini, itu mengembalikan kebocoran yang ditutup di server.
 */
export const registerProfile = async (input: {
  name: string;
  nik: string;
  divisi: string;
}): Promise<RegisterResult> => {
  const data = await api.post<{
    registered: boolean;
    status?: RegistrationStatus;
    user: User | null;
    registration?: RegistrationInfo;
  }>('/api/auth/register', input);

  // Dua keberhasilan yang berbeda: 201 (profil langsung aktif) dan 202 (masuk
  // antrean). Dibedakan lewat isi `status`, bukan kode HTTP -- apiRequest hanya
  // meneruskan isi amplopnya. `user` yang kosong pada 202 itu disengaja, bukan
  // jawaban yang cacat.
  if (data.user) {
    return { status: 'active', user: data.user, registration: null };
  }

  return { status: 'pending', user: null, registration: data.registration ?? null };
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
 *
 * Akun penampung data lama (legacy-unknown) tidak ada di daftar ini; backend
 * yang mengeluarkannya. Bukan orang, jadi tidak perlu tampil di User Management
 * maupun jadi kandidat pemilik NIK di Dashboard dan ActivityList.
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