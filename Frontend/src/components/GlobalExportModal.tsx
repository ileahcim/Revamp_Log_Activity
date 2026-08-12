import React, { useState } from 'react';
import { X, Download, FileSpreadsheet } from 'lucide-react';
import { exportMegaReport } from '../utils/exportExcelFormula';
import { useDivisions, useKategoriCodes } from '../utils/masterData';
import { User } from '../utils/auth';

interface GlobalExportModalProps {
  logs: any[];
  users: User[];
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSuccess: (msg: string) => void;
}

export default function GlobalExportModal({ logs, users, isOpen, onClose, user, onSuccess }: GlobalExportModalProps) {
  // exportMegaReport bukan komponen, jadi tidak bisa memakai hook sendiri;
  // datanya diambil di sini lalu dioper sebagai argumen.
  const kategoriCodes = useKategoriCodes();
  const divisions = useDivisions();

  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const defaultStart = new Date(startOfMonth.getTime() - startOfMonth.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const defaultEnd = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [divisi, setDivisi] = useState('');

  if (!isOpen) return null;

  const handleExport = () => {
    let filteredLogs = logs.filter(l => l.tanggal >= startDate && l.tanggal <= endDate);
    
    if (divisi && divisi !== '') {
      filteredLogs = filteredLogs.filter(l => {
        const key = l.nik ? String(l.nik).trim() : String(l.nama_technician).toLowerCase().trim();
        const techUser = users.find(u => (u.nik && u.nik === key) || u.name.toLowerCase() === key || u.id === key);
        if (!techUser || (techUser.divisi || '-') !== divisi) return false;
        return true;
      });
    }

    if (filteredLogs.length === 0) {
      alert('Tidak ada data dalam rentang tanggal dan divisi ini.');
      return;
    }
    exportMegaReport(filteredLogs, startDate, endDate, user, kategoriCodes);
    onSuccess(`Berhasil mengunduh Laporan Lanjutan untuk periode ${startDate} s/d ${endDate}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 bg-[#143c68] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Export Mega Report</h2>
              <p className="text-blue-100 text-sm">Download laporan lengkap dalam format Excel</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-white hover:bg-white/20 p-2 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Pilih rentang tanggal dan divisi untuk generate Mega Report. File Excel akan berisi 3 sheet lengkap: 
            <span className="font-semibold block mt-1">• Log Activity (Raw Data)</span>
            <span className="font-semibold block">• Summary System (Dynamic Formula)</span>
            <span className="font-semibold block">• Resume Daily</span>
          </p>

          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Tanggal Mulai</label>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#143c68] outline-none text-sm font-medium"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Tanggal Akhir</label>
              <input 
                type="date" 
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#143c68] outline-none text-sm font-medium"
              />
            </div>
            {user.role !== 'karyawan' && (
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Divisi</label>
                <select 
                  value={divisi}
                  onChange={(e) => setDivisi(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#143c68] outline-none text-sm font-medium"
                >
                  <option value="">Semua Divisi</option>
                  {/* Dulu enam <option> tetap, tersalin di lima berkas.
                      Sekarang dari /api/master/divisions. */}
                  {divisions.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="flex-1 bg-white border border-slate-300 text-slate-700 font-bold py-3 px-4 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Batal
            </button>
            <button 
              onClick={handleExport}
              className="flex-[2] flex items-center justify-center gap-2 bg-emerald-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-600/20"
            >
              <Download className="w-5 h-5" />
              Download Mega Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
