import { User } from './auth';
import { apiRequest } from './api';

/**
 * Tiga daftar yang menentukan siapa boleh masuk -- seluruhnya khusus admin.
 *
 *   ANTREAN PENDAFTARAN  siapa yang sudah mendaftar dan menunggu disetujui
 *   DAFTAR IZIN NIK      siapa yang BOLEH mendaftar padahal tidak punya jejak
 *                        di tech_logs (atasan dan admin baru)
 *   SUPER ADMIN          khusus super admin, bukan admin biasa
 *
 * Ketiganya disimpan backend sebagai berkas JSON di storage/, bukan tabel:
 * schema database dikunci di V1.0 dan tidak boleh di-ALTER. Penjelasan
 * lengkapnya ada di Backend/README.md bagian 12 dan 13.
 */

/**
 * Hasil satu aksi, lengkap dengan pesan dari server.
 *
 * Pesannya bukan hiasan: kalau backend gagal menulis ke audit_logs, aksinya
 * tetap dijalankan tapi pesannya diberi peringatan. Menelan pesan itu berarti
 * admin tidak pernah tahu ada persetujuan yang tidak tercatat.
 */
export interface HasilAksi<T> {
  data: T;
  message: string | null;
}

const kirim = async <T>(
  path: string,
  method: 'POST' | 'DELETE',
  body?: unknown
): Promise<HasilAksi<T>> => {
  const r = await apiRequest<T>(path, { method, body });

  return { data: r.data, message: r.message };
};

// =========================================================================
// Antrean pendaftaran
// =========================================================================

/**
 * Hasil pemeriksaan NIK satu pendaftar -- khusus untuk mata admin.
 *
 * Datang dari GET /api/registrations, yang dijaga role admin. Balasan untuk
 * pendaftarnya sendiri (GET /api/auth/status) tidak memuat apa pun dari sini
 * dan memang tidak boleh: pendaftar yang diberi tahu "NIK itu milik Budi"
 * membuat formulir pendaftaran jadi alat memanen data karyawan.
 *
 * Isinya baru benar-benar terasa perlu sejak Lapis 1
 * (REGISTRATION_REQUIRE_KNOWN_NIK) dimatikan: NIK apa pun yang belum terpakai
 * bisa masuk antrean, termasuk salah ketik, jadi yang menyaring sekarang admin.
 */
export interface NikCheck {
  /**
   * User aktif yang sudah memakai NIK ini, null kalau NIK-nya bebas.
   *
   * Kalau terisi, menyetujui pendaftaran itu akan GAGAL -- users.nik bertipe
   * UNIQUE di database. Jadi ini praktis selalu berarti tolak.
   */
  taken_by: { name: string; email: string; role: string } | null;

  /**
   * Pendaftar LAIN di antrean tunggu yang memakai NIK sama. Yang disetujui
   * lebih dulu menang; yang kedua akan gagal dengan alasan yang sama.
   */
  queued_by: { name: string; email: string }[];

  /**
   * Ada jejaknya di tech_logs atau di daftar izin NIK. false berarti sistem
   * tidak punya catatan apa pun atas NIK ini -- persis yang dulu ditolak
   * Lapis 1.
   */
  known: boolean;
}

export interface RegistrationRequest {
  uid: string;
  email: string;
  name: string;
  nik: string;
  divisi: string;
  requested_at: string | null;
  /**
   * Opsional supaya frontend yang lebih baru tetap jalan di atas backend yang
   * belum diperbarui: yang hilang cuma penandanya, bukan seluruh tabel.
   */
  nik_check?: NikCheck;
  /** Ketiganya hanya ada pada daftar yang sudah ditolak. */
  rejected_at?: string | null;
  rejected_by_email?: string | null;
  reason?: string | null;
}

export type RegistrationQueue = 'pending' | 'rejected';

/**
 * GET /api/registrations?status=pending|rejected
 *
 * Yang ditolak tidak dihapus, supaya orangnya tidak bisa mendaftar berulang
 * kali dan membuat antrean tidak ada habisnya.
 */
export const fetchRegistrations = async (
  status: RegistrationQueue = 'pending'
): Promise<RegistrationRequest[]> => {
  const r = await apiRequest<RegistrationRequest[]>(`/api/registrations?status=${status}`);

  return r.data ?? [];
};

/**
 * POST /api/registrations/{uid}/approve
 *
 * Rolenya dipilih di sini supaya atasan baru tidak perlu dua langkah: setujui
 * dulu sebagai karyawan lalu naikkan rolenya lewat menu lain.
 *
 * Backend menjalankan ULANG seluruh pemeriksaan saat menyetujui -- jarak antara
 * mendaftar dan disetujui bisa berhari-hari, dan dalam rentang itu NIK-nya bisa
 * saja sudah dipakai orang lain atau divisinya dinonaktifkan.
 */
export const approveRegistration = (
  uid: string,
  role: 'karyawan' | 'atasan' | 'admin'
): Promise<HasilAksi<User | null>> =>
  kirim<User | null>(`/api/registrations/${encodeURIComponent(uid)}/approve`, 'POST', { role });

/** POST /api/registrations/{uid}/reject -- alasan ikut ditampilkan ke yang ditolak. */
export const rejectRegistration = (
  uid: string,
  reason: string
): Promise<HasilAksi<RegistrationRequest>> =>
  kirim<RegistrationRequest>(
    `/api/registrations/${encodeURIComponent(uid)}/reject`,
    'POST',
    reason.trim() === '' ? {} : { reason: reason.trim() }
  );

/**
 * DELETE /api/registrations/{uid}
 *
 * Menghapus CATATAN PENOLAKANNYA, bukan usernya, supaya yang bersangkutan boleh
 * mendaftar lagi. Dipakai kalau penolakan sebelumnya keliru.
 */
export const forgetRegistration = (uid: string): Promise<HasilAksi<null>> =>
  kirim<null>(`/api/registrations/${encodeURIComponent(uid)}`, 'DELETE');

// =========================================================================
// Daftar izin NIK
// =========================================================================

export interface AllowedNik {
  nik: string;
  note: string | null;
  added_by: string;
  added_by_email: string;
  added_at: string | null;
}

/** GET /api/allowed-niks */
export const fetchAllowedNiks = async (): Promise<AllowedNik[]> => {
  const r = await apiRequest<AllowedNik[]>('/api/allowed-niks');

  return r.data ?? [];
};

/**
 * POST /api/allowed-niks
 *
 * Yang diberikan hanya izin MENDAFTAR. Orangnya tetap mengisi formulir sendiri
 * dengan Akun Google-nya, dan pendaftarannya tetap masuk antrean persetujuan
 * seperti yang lain.
 */
export const addAllowedNik = (nik: string, note: string): Promise<HasilAksi<AllowedNik>> =>
  kirim<AllowedNik>('/api/allowed-niks', 'POST', note.trim() === '' ? { nik } : { nik, note: note.trim() });

/** DELETE /api/allowed-niks/{nik} -- user yang terlanjur disetujui tidak terpengaruh. */
export const removeAllowedNik = (nik: string): Promise<HasilAksi<null>> =>
  kirim<null>(`/api/allowed-niks/${encodeURIComponent(nik)}`, 'DELETE');

// =========================================================================
// Super admin
// =========================================================================

export interface SuperAdminEntry {
  email: string;
  /** 'env' = dari SUPER_ADMIN_EMAILS di server, 'app' = diangkat lewat AdminPanel. */
  source: 'env' | 'app';
  /** false untuk yang berasal dari .env. Pakai ini untuk menonaktifkan tombolnya. */
  removable: boolean;
  promoted_by_email: string | null;
  promoted_at: string | null;
  /** false kalau alamat itu belum pernah login. Itu sah -- penerus bisa ditunjuk lebih dulu. */
  registered: boolean;
  name: string | null;
}

/**
 * GET /api/super-admins
 *
 * Dijaga SuperAdminMiddleware, bukan role admin: admin biasa yang boleh
 * mengangkat super admin bisa mengangkat dirinya sendiri, dan pembedaan
 * keduanya jadi tidak berarti.
 */
export const fetchSuperAdmins = async (): Promise<SuperAdminEntry[]> => {
  const r = await apiRequest<SuperAdminEntry[]>('/api/super-admins');

  return r.data ?? [];
};

/**
 * POST /api/super-admins
 *
 * Alamat yang belum punya akun boleh diangkat, dan itu memang jalur serah
 * terimanya: alamat yang sudah jadi super admin melewati kedua lapis
 * pembatasan saat nanti mendaftar.
 */
export const promoteSuperAdmin = (email: string): Promise<HasilAksi<SuperAdminEntry[]>> =>
  kirim<SuperAdminEntry[]>('/api/super-admins', 'POST', { email: email.trim() });

/**
 * DELETE /api/super-admins/{email}
 *
 * Ditolak server untuk alamat dari .env dan untuk super admin terakhir yang
 * tersisa. Keduanya sengaja: yang pertama jalan pulang kalau berkasnya rusak,
 * yang kedua supaya sistem tidak pernah kehabisan super admin.
 */
export const demoteSuperAdmin = (email: string): Promise<HasilAksi<SuperAdminEntry[]>> =>
  kirim<SuperAdminEntry[]>(`/api/super-admins/${encodeURIComponent(email)}`, 'DELETE');
