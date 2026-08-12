import { api } from './api';

/**
 * Sakelar maintenance.
 *
 * Di backend nilainya disimpan di storage/settings.json, bukan tabel -- schema
 * V1.0 dikunci dan tidak punya tabel settings.
 */

/**
 * GET /api/settings/maintenance -- terbuka, tanpa token.
 *
 * Satu-satunya endpoint tanpa autentikasi selain /api/health. App.tsx
 * membacanya saat aplikasi dimuat, sebelum ada yang login, karena layar
 * "Under Maintenance" juga harus tampil di halaman login. Yang terekspos hanya
 * satu boolean, sama seperti aturan Firestore yang dipakai sebelumnya.
 *
 * Kegagalan dibaca sebagai "tidak sedang maintenance". Kalau backend mati,
 * mengunci seluruh aplikasi di layar maintenance justru menyesatkan -- yang
 * salah bukan maintenance, dan kegagalan sebenarnya akan muncul sendiri saat
 * login.
 */
export const fetchMaintenance = async (): Promise<boolean> => {
  try {
    const data = await api.get<{ active: boolean }>('/api/settings/maintenance', { auth: false });

    return data.active === true;
  } catch (e) {
    console.error("Gagal membaca status maintenance", e);
    return false;
  }
};

/** PUT /api/settings/maintenance -- khusus admin. */
export const setMaintenance = async (active: boolean): Promise<boolean> => {
  const data = await api.put<{ active: boolean }>('/api/settings/maintenance', { active });

  return data.active === true;
};
