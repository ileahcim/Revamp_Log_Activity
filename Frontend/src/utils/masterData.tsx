import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Category,
  DelayCode,
  Division,
  Supervisor,
  asRecord,
  fetchCategories,
  fetchDelayCodes,
  fetchDivisions,
  fetchSupervisors,
} from './master';

/**
 * Data master untuk seluruh layar setelah login.
 *
 * Menggantikan KATEGORI_CODES dan DELAY_CODES di types.ts serta daftar
 * supervisor yang ditulis tetap sebagai <option> di InputForm. Selama salinan
 * itu masih dipakai, perbaikan di database -- PR=Permit, AC=Access, OT=Other --
 * tidak pernah terlihat di layar.
 *
 * Kenapa context, bukan diambil sendiri-sendiri di tiap komponen: ketiganya
 * dipakai bersamaan oleh InputForm, Dashboard, ActivityList, InformationScreens,
 * dan dua util export. Kalau masing-masing mengambil sendiri, satu kali buka
 * aplikasi jadi belasan request untuk daftar yang isinya sama dan hampir tidak
 * pernah berubah.
 *
 * Diambil sekali saat provider dipasang. Provider hanya dipasang setelah user
 * terdaftar masuk, karena ketiga endpointnya mensyaratkan baris di tabel users.
 */

interface MasterData {
  categories: Category[];
  delayCodes: DelayCode[];
  supervisors: Supervisor[];
  divisions: Division[];
  /** Bentuk Record<code, name>, sama persis dengan konstanta yang digantikan. */
  kategoriCodes: Record<string, string>;
  delayCodeNames: Record<string, string>;
}

const KOSONG: MasterData = {
  categories: [],
  delayCodes: [],
  supervisors: [],
  divisions: [],
  kategoriCodes: {},
  delayCodeNames: {},
};

const MasterDataContext = createContext<MasterData>(KOSONG);

export const useMasterData = (): MasterData => useContext(MasterDataContext);

/** Pengganti langsung KATEGORI_CODES. */
export const useKategoriCodes = (): Record<string, string> => useMasterData().kategoriCodes;

/** Pengganti langsung DELAY_CODES. */
export const useDelayCodeNames = (): Record<string, string> => useMasterData().delayCodeNames;

export const useSupervisors = (): Supervisor[] => useMasterData().supervisors;

/**
 * Pengganti enam <option> divisi yang tersalin di lima berkas.
 *
 * Login.tsx tetap mengambil sendiri lewat fetchDivisions(): form "Lengkapi
 * Profil" tampil sebelum provider ini dipasang, karena provider baru hidup
 * setelah user terdaftar masuk.
 */
export const useDivisions = (): Division[] => useMasterData().divisions;

/**
 * Menahan aplikasi sampai data master siap.
 *
 * Kegagalan sengaja TIDAK dilewati diam-diam dengan daftar kosong. Tanpa data
 * master, dropdown Kategori di InputForm kosong sehingga aktivitas tidak bisa
 * disimpan sama sekali, dan Dashboard menampilkan angka nol yang terlihat
 * seperti data sungguhan. Aplikasi yang terbuka tapi salah lebih berbahaya
 * daripada aplikasi yang jujur berhenti.
 */
export function MasterDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<MasterData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setError(null);

    try {
      // Keempatnya diminta bersamaan; tidak ada yang bergantung pada yang lain.
      const [categories, delayCodes, supervisors, divisions] = await Promise.all([
        fetchCategories(),
        fetchDelayCodes(),
        fetchSupervisors(),
        fetchDivisions(),
      ]);

      setData({
        categories,
        delayCodes,
        supervisors,
        divisions,
        kategoriCodes: asRecord(categories),
        delayCodeNames: asRecord(delayCodes),
      });
    } catch (e: any) {
      console.error("Gagal memuat data master", e);
      setData(null);
      setError(e?.message || 'Tidak diketahui.');
    }
  }, []);

  useEffect(() => {
    muat();
  }, [muat]);

  if (error !== null) {
    return (
      <div className="flex h-screen w-full bg-slate-50 items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-16 h-16 text-[#143c68] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Gagal Memuat Data Master</h1>
          <p className="text-slate-600 mb-2">
            Daftar kategori, kode delay, dan supervisor tidak bisa diambil dari server. Tanpa itu,
            aktivitas tidak bisa dicatat dengan benar.
          </p>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={muat}
            className="w-full flex justify-center items-center gap-2 bg-[#143c68] text-white py-2 px-4 rounded-lg font-bold hover:bg-[#1a4f8a] transition"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  if (data === null) {
    // Tampilan yang sama persis dengan layar tunggu saat memeriksa sesi, supaya
    // pemuatan data master tidak terasa seperti langkah baru bagi pengguna.
    return (
      <div className="flex h-screen w-full bg-slate-50 items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#143c68] animate-spin" />
          <p className="font-semibold text-sm">Menghubungkan ke Server...</p>
        </div>
      </div>
    );
  }

  return <MasterDataContext.Provider value={data}>{children}</MasterDataContext.Provider>;
}
