import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

/**
 * Awalan alamat tempat hasil build dipasang.
 *
 * Saat build, Vite menulis alamat berkas JS dan CSS ke dalam index.html.
 * Bawaannya "/", yang berarti hasilnya hanya jalan kalau diletakkan tepat di
 * akar domain. Di Hostinger aplikasi ini duduk di subfolder
 * (arpgrs.com/log_activity), jadi alamat itu harus ikut bergeser -- kalau
 * tidak, browser meminta /assets/index-xxxx.js, dijawab 404 oleh halaman lain,
 * dan yang muncul layar putih tanpa pesan error apa pun.
 *
 * Nilainya dibaca dari VITE_BASE_PATH, bukan ditulis tetap, supaya
 * `npm run dev` tetap melayani di "/" (.env.local tidak mengisinya) sementara
 * `npm run build` memakai .env.production.
 */
function baseDari(nilai: string | undefined): string {
  const bersih = (nilai ?? '').trim().replace(/^\/+|\/+$/g, '');

  // Vite mensyaratkan garis miring di kedua ujung.
  return bersih === '' ? '/' : `/${bersih}/`;
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: baseDari(env.VITE_BASE_PATH),
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
