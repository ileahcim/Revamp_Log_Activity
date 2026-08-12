/// <reference types="vite/client" />

// Tanpa berkas ini, `import.meta.env.VITE_API_URL` di utils/api.ts tidak dikenal
// TypeScript dan `npm run lint` gagal. tsconfig.json tidak menyetel
// "types": ["vite/client"], jadi acuannya ditulis di sini.
