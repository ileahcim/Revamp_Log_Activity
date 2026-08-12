import { auth } from './firebase';

/**
 * Satu-satunya pintu keluar ke backend Slim.
 *
 * Semua pemanggilan API lewat sini supaya tiga hal tidak perlu diulang di tiap
 * pemanggil: alamat backend, header Authorization, dan penerjemahan bentuk
 * response menjadi error yang bisa ditangani.
 *
 * Bentuk response backend selalu sama (lihat Backend/README.md bagian 5):
 *
 *     { "success": true,  "data": ..., "message": null }
 *     { "success": false, "data": null, "message": "...", "errors": { } }
 *
 * Endpoint daftar menambahkan "meta" untuk pagination.
 */

/**
 * Alamat backend, tanpa "/api" di belakang -- itu ditambahkan tiap pemanggil,
 * mengikuti contoh di README backend (`${API_URL}/api/users`).
 *
 * Hanya variabel berawalan VITE_ yang diteruskan Vite ke kode browser. Kalau
 * awalannya salah, nilainya undefined saat dijalankan dan bukan error saat
 * build -- karena itu kekosongannya diperiksa di sini, sekali, dengan pesan
 * yang menyebut nama berkasnya.
 */
const BASE_URL = String(import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

/**
 * Batas tunggu satu request.
 *
 * Hosting bersama bisa lambat, tapi menggantung selamanya lebih buruk daripada
 * gagal: tanpa batas ini, tombol "Menyimpan..." bisa berputar tanpa akhir dan
 * user tidak tahu harus berbuat apa.
 */
const TIMEOUT_MS = 20_000;

/** Isi "meta" pada endpoint daftar. */
export interface PageMeta {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message: string | null;
  errors?: Record<string, string>;
  meta?: PageMeta;
}

/**
 * Kegagalan yang datang dari backend, atau dari kegagalan menghubunginya.
 *
 * `status` 0 berarti requestnya tidak pernah sampai (server mati, alamat salah,
 * CORS, atau timeout) -- dibedakan dari 4xx/5xx supaya pemanggil bisa memilih
 * pesan yang tepat.
 */
export class ApiError extends Error {
  readonly status: number;

  /** Error per field, contoh { nik: "NIK sudah digunakan user lain." } */
  readonly errors: Record<string, string>;

  constructor(status: number, message: string, errors: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }

  /** Gagal validasi -- termasuk NIK yang sudah dipakai user lain. */
  get isValidation(): boolean {
    return this.status === 422;
  }

  /** Backendnya tidak terjangkau sama sekali. */
  get isOffline(): boolean {
    return this.status === 0;
  }

  /** Pesan untuk field tertentu, misalnya untuk ditaruh di bawah input NIK. */
  field(name: string): string | undefined {
    return this.errors[name];
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** false untuk endpoint terbuka seperti /api/settings/maintenance. */
  auth?: boolean;
  timeoutMs?: number;
}

/**
 * ID token Firebase yang sedang berlaku.
 *
 * getIdToken() memperbarui sendiri token yang sudah kedaluwarsa, jadi tidak
 * perlu ada penjadwalan di sisi kita. Kalau belum ada yang login, requestnya
 * tetap dikirim tanpa header dan backend menjawab 401 -- itu jawaban yang lebih
 * berguna daripada error yang dibuat sendiri di browser.
 */
async function bearerToken(): Promise<string | null> {
  const user = auth.currentUser;

  if (!user) {
    return null;
  }

  try {
    return await user.getIdToken();
  } catch (e) {
    console.error('Gagal mengambil ID token Firebase', e);
    return null;
  }
}

/**
 * Kirim satu request dan kembalikan seluruh amplopnya, termasuk `meta`.
 *
 * Dipakai langsung hanya oleh endpoint daftar yang butuh pagination. Selain itu
 * pakai `api.get` dan kawan-kawannya di bawah.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  if (BASE_URL === '') {
    throw new ApiError(
      0,
      'VITE_API_URL belum diisi. Buat berkas Frontend/.env.local berisi ' +
        'VITE_API_URL=http://localhost:8080 lalu jalankan ulang "npm run dev".'
    );
  }

  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.auth !== false) {
    const token = await bearerToken();

    if (token !== null) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const batas = options.timeoutMs ?? TIMEOUT_MS;
  const pembatal = new AbortController();
  const pewaktu = setTimeout(() => pembatal.abort(), batas);

  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: pembatal.signal,
    });
  } catch (e) {
    // fetch hanya menolak kalau requestnya tidak sampai. Penyebab tersering
    // saat development: backend belum dijalankan, port salah, atau origin
    // frontend belum terdaftar di CORS_ALLOWED_ORIGINS.
    if (pembatal.signal.aborted) {
      throw new ApiError(0, `Server tidak menjawab dalam ${Math.round(batas / 1000)} detik. Coba lagi.`);
    }

    throw new ApiError(
      0,
      `Tidak bisa menghubungi server di ${BASE_URL}. Pastikan backend sedang berjalan ` +
        '(cd Backend && composer serve) dan alamat frontend ini terdaftar di CORS_ALLOWED_ORIGINS.'
    );
  } finally {
    clearTimeout(pewaktu);
  }

  const teks = await response.text();

  let payload: unknown = null;

  if (teks !== '') {
    try {
      payload = JSON.parse(teks);
    } catch {
      payload = null;
    }
  }

  // Response yang bukan JSON berarti bukan backend kita yang menjawab: halaman
  // error Apache, halaman login hosting, atau PHP yang mati sebelum sempat
  // menyusun response. Menampilkan potongan HTML-nya tidak menolong siapa pun.
  if (payload === null || typeof payload !== 'object') {
    throw new ApiError(
      response.status,
      response.ok
        ? 'Server menjawab dengan isi yang bukan JSON. Periksa apakah VITE_API_URL menunjuk ke backend yang benar.'
        : `Server menjawab ${response.status} tanpa penjelasan. Periksa storage/logs/ di backend.`
    );
  }

  const amplop = payload as Partial<ApiEnvelope<T>>;

  if (!response.ok || amplop.success === false) {
    throw new ApiError(
      response.status,
      typeof amplop.message === 'string' && amplop.message !== ''
        ? amplop.message
        : `Permintaan gagal (${response.status}).`,
      amplop.errors ?? {}
    );
  }

  return amplop as ApiEnvelope<T>;
}

/** Pintasan yang langsung mengembalikan isi `data`. */
export const api = {
  get: <T>(path: string, options: RequestOptions = {}): Promise<T> =>
    apiRequest<T>(path, { ...options, method: 'GET' }).then((r) => r.data),

  post: <T>(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<T> =>
    apiRequest<T>(path, { ...options, method: 'POST', body }).then((r) => r.data),

  put: <T>(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<T> =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }).then((r) => r.data),

  patch: <T>(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<T> =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }).then((r) => r.data),

  delete: <T>(path: string, options: RequestOptions = {}): Promise<T> =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }).then((r) => r.data),
};
