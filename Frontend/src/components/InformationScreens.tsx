import React from 'react';
import { useDelayCodeNames, useKategoriCodes } from '../utils/masterData';

export default function InformationScreens({ type }: { type: 'lists' | 'howto' }) {
  // Dipanggil sebelum percabangan `type`: hook tidak boleh dipanggil di dalam
  // cabang kondisi, urutannya harus sama di setiap render.
  const KATEGORI_CODES = useKategoriCodes();
  const DELAY_CODES = useDelayCodeNames();

  if (type === 'lists') {
    return (
      <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full max-w-4xl mx-auto w-full">
        <div className="p-4 sm:p-6 border-b border-slate-100 shrink-0">
          <h2 className="text-xl font-bold text-[#143c68]">Data Categories & Lists</h2>
          <p className="text-xs text-slate-500 mt-1">Reference for all codes used in the system</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-8">
          <div>
            <h3 className="font-bold text-slate-800 mb-3 text-sm uppercase tracking-wider">Kategori (Code) Status</h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#143c68] text-white">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Category Code</th>
                    <th className="px-4 py-2 font-semibold">Category Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {Object.entries(KATEGORI_CODES).map(([code, name]) => (
                    <tr key={code} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800">{code}</td>
                      <td className="px-4 py-2 text-slate-600">{name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="font-bold text-slate-800 mb-3 text-sm uppercase tracking-wider">Delay Code & Reason</h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#143c68] text-white">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Delay Code</th>
                    <th className="px-4 py-2 font-semibold">Delay Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {Object.entries(DELAY_CODES).map(([code, name]) => (
                    <tr key={code} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800">{code}</td>
                      <td className="px-4 py-2 text-slate-600">{name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full max-w-4xl mx-auto w-full">
      <div className="p-4 sm:p-6 border-b border-slate-100 shrink-0">
        <h2 className="text-xl font-bold text-[#143c68]">How to Use System</h2>
        <p className="text-xs text-slate-500 mt-1">Instructions for technicians</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="border border-[#143c68] bg-slate-50 text-slate-800 p-4 rounded-lg font-bold mb-6 text-sm">
          PENGISIAN ADA di layar My Day untuk jam kerja 07:30-16:30 dan istirahat 12:00-13:00.
        </div>
        
        <h3 className="font-bold text-slate-800 mb-4 text-base">Cara Pakai:</h3>
        <ul className="space-y-4 text-slate-700 text-sm list-decimal list-inside">
          <li className="pl-2">
            <strong>Isi/ubah aktivitas</strong> pada menu <strong>"My Day" -&gt; "Tambah"</strong>.
          </li>
          <li className="pl-2">
            <strong>Kategori (Code)</strong> pilih dari dropdown: P1, P2, P3, P4, D1-D5, B.
          </li>
          <li className="pl-2">
            <strong>Start &amp; Finish</strong> format hh:mm. Durasi (jam) otomatis dihitung oleh sistem.
          </li>
          <li className="pl-2">
            Pastikan <strong>Shift</strong> dipilih dengan benar (Pagi/Siang).
          </li>
          <li className="pl-2">
            Di halaman <strong>Dashboard (Summary)</strong>, Rekap jam dan KPI terhitung otomatis.
          </li>
        </ul>
      </div>
    </div>
  );
}
