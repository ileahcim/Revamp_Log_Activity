import React, { useState, useMemo, useEffect } from 'react';
import { Pencil, Trash2, Plus, Calendar, Download, Users } from 'lucide-react';
import { LogActivity } from '../types';
import { useDivisions, useKategoriCodes } from '../utils/masterData';
import { deleteLog } from '../utils/storage';
import { User, addAuditLog } from '../utils/auth';
import { exportToExcel } from '../utils/exportExcel';
import ExportModal from './ExportModal';
import BatchUpdateModal from './BatchUpdateModal';
import { getDrafts, deleteDraft, Draft } from '../utils/drafts';

interface ActivityListProps {
  logs: LogActivity[];
  users: User[];
  user: User;
  onNewActivity: () => void;
  onEditActivity: (log: LogActivity) => void;
  onDeleteSuccess: (id: string) => void;
  filterStartDate: string;
  onStartDateChange: (date: string) => void;
  filterEndDate: string;
  onEndDateChange: (date: string) => void;
  filterNik: string;
  onNikChange: (nik: string) => void;
  filterDivisi?: string;
  onDivisiChange?: (divisi: string) => void;
  onRefreshLogs?: () => void;
  onResumeDraft?: (draftId: string) => void;
}

const renderSnSummary = (snString: string) => {
  if (!snString) return null;
  const sns = snString.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (sns.length <= 15) return snString;
  const displaySns = sns.slice(0, 15).join(', ');
  const remaining = sns.length - 15;
  return `${displaySns}, ..., +${remaining}`;
};

export default function ActivityList({ logs, users, user, onNewActivity, onEditActivity, onDeleteSuccess, filterStartDate, onStartDateChange, filterEndDate, onEndDateChange, filterNik, onNikChange, filterDivisi = '', onDivisiChange = () => {}, onRefreshLogs, onResumeDraft }: ActivityListProps) {
  // Dulu konstanta di types.ts, sekarang dari /api/master/categories lewat
  // MasterDataProvider. Bentuknya tetap Record<code, name>, jadi semua
  // pemakaian di bawah tidak berubah.
  const KATEGORI_CODES = useKategoriCodes();
  const divisions = useDivisions();

  const [showExportModal, setShowExportModal] = useState(false);
  const [showBatchUpdateModal, setShowBatchUpdateModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [showDraftsModal, setShowDraftsModal] = useState(false);
  
  useEffect(() => {
    setDrafts(getDrafts());
  }, []);
  
  // Persist category to sessionStorage
  const [filterCategory, _setFilterCategory] = useState<string>(() => sessionStorage.getItem('al_category') || 'all');
  const setFilterCategory = (val: string) => {
    sessionStorage.setItem('al_category', val);
    _setFilterCategory(val);
  };
  
  const [deleteTarget, setDeleteTarget] = useState<LogActivity | null>(null);

  // Restore parent props from sessionStorage on mount
  useEffect(() => {
    const savedStartDate = sessionStorage.getItem('al_startDate');
    if (savedStartDate && savedStartDate !== filterStartDate) {
      onStartDateChange(savedStartDate);
    }
    const savedEndDate = sessionStorage.getItem('al_endDate');
    if (savedEndDate && savedEndDate !== filterEndDate) {
      onEndDateChange(savedEndDate);
    }
    const savedNik = sessionStorage.getItem('al_nik');
    if (savedNik !== null && savedNik !== filterNik) {
      onNikChange(savedNik);
    }
    const savedDivisi = sessionStorage.getItem('al_divisi');
    if (savedDivisi !== null && savedDivisi !== filterDivisi) {
      if (onDivisiChange) onDivisiChange(savedDivisi);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save parent props to sessionStorage on change
  useEffect(() => {
    sessionStorage.setItem('al_startDate', filterStartDate);
    sessionStorage.setItem('al_endDate', filterEndDate);
    sessionStorage.setItem('al_nik', filterNik);
    sessionStorage.setItem('al_divisi', filterDivisi || '');
  }, [filterStartDate, filterEndDate, filterNik, filterDivisi]);

  const ITEMS_PER_PAGE = 20;

  const techniciansMap = useMemo(() => {
    const map = new Map<string, string>();
    logs.forEach(l => {
        const key = l.nik ? String(l.nik).trim() : String(l.nama_technician).toLowerCase().trim();
        
        // Divisi logic
        if (filterDivisi) {
           const techUser = users.find(u => (u.nik && u.nik === key) || u.name.toLowerCase() === key || u.id === key);
           if (!techUser || (techUser.divisi || '-') !== filterDivisi) return;
        }

        if (!map.has(key)) {
            map.set(key, l.nama_technician);
        }
    });
    return Array.from(map.entries()).sort((a,b) => a[1].localeCompare(b[1])); 
  }, [logs, filterDivisi, users]);

  const supervisors = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => {
      if (l.supervisor) set.add(l.supervisor);
    });
    return Array.from(set).sort();
  }, [logs]);

  const [filterSupervisor, _setFilterSupervisor] = useState<string>(() => sessionStorage.getItem('al_supervisor') || '');
  const setFilterSupervisor = (val: string) => {
    sessionStorage.setItem('al_supervisor', val);
    _setFilterSupervisor(val);
  };

  const filteredLogs = useMemo(() => {
    return logs
      .filter(l => l.tanggal >= filterStartDate && l.tanggal <= filterEndDate)
      .filter(l => filterCategory === 'all' || l.kategori_code === filterCategory)
      .filter(l => filterSupervisor === '' || l.supervisor === filterSupervisor)
      .filter(l => {
        if (user.role === 'karyawan') {
          return (l.nik || l.nama_technician.toLowerCase()) === (user.nik || user.name.toLowerCase());
        }
        
        if (filterDivisi) {
           const key = l.nik ? String(l.nik).trim() : String(l.nama_technician).toLowerCase().trim();
           const techUser = users.find(u => (u.nik && u.nik === key) || u.name.toLowerCase() === key || u.id === key);
           if (!techUser || (techUser.divisi || '-') !== filterDivisi) return false;
        }

        if (filterNik === '') return true;
        return (l.nik || l.nama_technician.toLowerCase()) === filterNik;
      })
      .sort((a, b) => {
        const dateCompare = b.tanggal.localeCompare(a.tanggal);
        if (dateCompare !== 0) return dateCompare;
        return a.start_time.localeCompare(b.start_time);
      });
  }, [logs, filterStartDate, filterEndDate, filterNik, filterCategory, filterSupervisor, user, filterDivisi, users]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterStartDate, filterEndDate, filterNik, filterCategory, filterSupervisor, filterDivisi]);

  const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const canModify = (log: LogActivity) => {
    if (user.role === 'admin' || user.role === 'atasan') return true;
    
    // For karyawan, can only edit if the log's date is today. Once the day changes, no more edits.
    const todayStr = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
    return log.tanggal === todayStr;
  };

  const handleDelete = (log: LogActivity) => {
    if (!canModify(log)) {
      alert("Hanya bisa menghapus data hari ini. Setelah berganti hari, data tidak dapat dihapus.");
      return;
    }
    setDeleteTarget(log);
  };

  const executeDelete = async () => {
    if (deleteTarget) {
      // Aturan kepemilikan dan "hanya hari ini" sekarang ditegakkan server
      // juga, jadi penghapusan bisa ditolak walaupun canModify() di browser
      // meloloskannya -- misalnya saat tengah malam terlewat sementara halaman
      // masih terbuka. Tanpa penangkapan ini, penolakannya jadi unhandled
      // rejection: modalnya diam saja dan barisnya tidak hilang.
      try {
        await deleteLog(deleteTarget.id);
      } catch (e: any) {
        alert(e?.message || 'Gagal menghapus data aktivitas.');
        return;
      }

      addAuditLog(user, `Menghapus log aktivitas (ID: ${deleteTarget.id})`);
      onDeleteSuccess(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const handleEdit = (log: LogActivity) => {
    if (!canModify(log)) {
      alert("Hanya bisa mengedit data hari ini. Setelah berganti hari, data tidak dapat diedit.");
      return;
    }
    onEditActivity(log);
  };

  const handleExport = (startDate: string, endDate: string) => {
    const dataToExport = logs
      .filter(l => l.tanggal >= startDate && l.tanggal <= endDate)
      .filter(l => filterCategory === 'all' || l.kategori_code === filterCategory)
      .filter(l => {
        if (user.role === 'karyawan') {
          return (l.nik || l.nama_technician.toLowerCase()) === (user.nik || user.name.toLowerCase());
        }

        if (filterDivisi) {
           const key = l.nik ? String(l.nik).trim() : String(l.nama_technician).toLowerCase().trim();
           const techUser = users.find(u => (u.nik && u.nik === key) || u.name.toLowerCase() === key || u.id === key);
           if (!techUser || (techUser.divisi || '-') !== filterDivisi) return false;
        }

        if (filterNik === '') return true;
        return (l.nik || l.nama_technician.toLowerCase()) === filterNik;
      });

    if(dataToExport.length === 0) {
        alert("Tidak ada data untuk rentang tanggal ini.");
        return;
    }
    const headers = ['Tanggal', 'Nama Technician', 'NIK', 'Supervisor', 'Shift', 'Party', 'WO/Notif', 'Asset/Tag', 'SN', 'Deskripsi Pekerjaan', 'Kategori (Code)', 'Start', 'Finish', 'Durasi (jam)', 'Status', 'Delay Code', 'Output qty', 'Catatan'];
    
    // Sort logic to make sure the export is properly ordered by date and time
    const sortedData = [...dataToExport].sort((a, b) => {
      const dateCompare = a.tanggal.localeCompare(b.tanggal);
      if (dateCompare !== 0) return dateCompare;
      return a.start_time.localeCompare(b.start_time);
    });

    const rows = sortedData.map(l => [
        l.tanggal, l.nama_technician, l.nik, l.supervisor, l.shift, l.party, l.wo_notif, l.asset_tag, l.sn, l.deskripsi_pekerjaan, l.kategori_code, l.start_time, l.finish_time, Number((l.duration_minutes / 60).toFixed(2)), l.status, l.delay_code, l.output_qty, l.catatan
    ]);
    
    exportToExcel(headers, rows, `Log_Detail_${startDate}_to_${endDate}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {drafts.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 p-3 shrink-0 flex items-center justify-between animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-amber-800">
              📝 Ada {drafts.length} Draft yang belum diselesaikan
            </span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setShowDraftsModal(true)} 
              className="text-xs font-bold text-indigo-700 bg-indigo-100 px-3 py-1.5 rounded hover:bg-indigo-200 transition"
            >
              Lihat Detail
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Konfirmasi Hapus</h3>
            <p className="text-sm text-slate-600 mb-6">Anda yakin ingin menghapus aktivitas ini?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 px-4 border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors text-sm">Batal</button>
              <button onClick={executeDelete} className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors text-sm">Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      <ExportModal 
        isOpen={showExportModal} 
        onClose={() => setShowExportModal(false)}
        onExport={handleExport}
        title="Export Log Detail"
      />

      <BatchUpdateModal
        isOpen={showBatchUpdateModal}
        onClose={() => setShowBatchUpdateModal(false)}
        onSuccess={(count) => {
          setShowBatchUpdateModal(false);
          alert(`${count} Activity berhasil diperbarui.`);
          if (onRefreshLogs) {
            onRefreshLogs();
          }
        }}
      />
      
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-700">{user.role === 'admin' || user.role === 'atasan' ? 'Seluruh Aktivitas Teknisi' : 'Daftar Aktivitas Saya'}</h2>
          </div>
          <div className="flex gap-2">
            {user.role === 'admin' && (
              /* Dinonaktifkan sampai backend punya endpoint ubah massal.
                 BatchUpdateModal menulis langsung ke Firestore lewat writeBatch,
                 jadi kalau tetap bisa diklik sekarang, perubahannya masuk ke
                 tempat yang sudah tidak dibaca aplikasi -- tampak berhasil,
                 tapi tidak mengubah apa pun di MariaDB. */
              <button
                onClick={() => setShowBatchUpdateModal(true)}
                disabled
                title="Sementara tidak tersedia — menunggu endpoint backend"
                className="flex items-center gap-1.5 bg-white text-slate-700 border border-slate-200 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Batch Update</span>
              </button>
            )}
            <button 
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-1.5 bg-slate-100 text-slate-700 border border-slate-200 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-200 transition"
            >
              <Download className="w-4 h-4" />
              <span>{user.role === 'karyawan' ? 'Export Log Saya' : 'Export Log Detail'}</span>
            </button>
            <button 
              onClick={onNewActivity}
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah</span>
            </button>
          </div>
        </div>
        
        <div className="flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3 w-full">
            <div className="flex items-center gap-2 w-full lg:w-auto">
              <input 
                type="date" 
                value={filterStartDate}
                onChange={(e) => {
                  const newStartDate = e.target.value;
                  const start = new Date(newStartDate);
                  const maxEnd = new Date(start);
                  maxEnd.setDate(start.getDate() + 31);
                  const currentEnd = new Date(filterEndDate);
                  
                  if (currentEnd > maxEnd) {
                    onEndDateChange(maxEnd.toISOString().split('T')[0]);
                  } else if (currentEnd < start) {
                    onEndDateChange(newStartDate);
                  }
                  onStartDateChange(newStartDate);
                }}
                className="flex-1 md:flex-none px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer min-w-0"
              />
              <span className="text-sm font-bold text-slate-500 shrink-0">s/d</span>
              <input 
                type="date" 
                value={filterEndDate}
                min={filterStartDate}
                onChange={(e) => {
                  const newEndDate = e.target.value;
                  const start = new Date(filterStartDate);
                  const end = new Date(newEndDate);
                  const maxEnd = new Date(start);
                  maxEnd.setDate(start.getDate() + 31);
                  
                  if (end > maxEnd) {
                    alert("Maksimal rentang waktu adalah 31 hari.");
                    return;
                  }
                  onEndDateChange(newEndDate);
                }}
                className="flex-1 md:flex-none px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer min-w-0"
              />
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              {user.role !== 'karyawan' && (
                <select
                  value={filterSupervisor}
                  onChange={(e) => setFilterSupervisor(e.target.value)}
                  className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="">Semua Supervisor</option>
                  {supervisors.map(sup => (
                    <option key={sup} value={sup}>{sup}</option>
                  ))}
                </select>
              )}
              
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="all">Semua Kategori</option>
                {Object.entries(KATEGORI_CODES).map(([code]) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>

              {user.role !== 'karyawan' && (
                <>
                <select
                  value={filterDivisi}
                  onChange={(e) => {
                    onDivisiChange?.(e.target.value);
                    onNikChange('');
                  }}
                  className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="">Semua Divisi</option>
                  {/* Dulu enam <option> tetap, tersalin di lima berkas.
                      Sekarang dari /api/master/divisions. */}
                  {divisions.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
                <select 
                  className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={filterNik}
                  onChange={e => onNikChange(e.target.value)}
                >
                  <option value="">Semua Teknisi</option>
                  {techniciansMap.map(([key, name]) => (
                    <option key={key} value={key}>{name} {key !== name.toLowerCase() ? `(${key})` : ''}</option>
                  ))}
                </select>
                </>
              )}
            </div>
          </div>
          
          <div className="bg-indigo-50 text-indigo-700 px-3 py-2 rounded-md text-sm font-bold border border-indigo-100 text-center shrink-0 w-full lg:w-fit self-start">
            Total aktivitas: {filteredLogs.length} kegiatan
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 flex-1">
            <p>Belum ada aktivitas pada rentang tanggal ini.</p>
            {user.role === 'karyawan' && (
              <button onClick={onNewActivity} className="mt-4 text-indigo-600 font-medium hover:underline text-sm">
                + Tambah Aktivitas Baru
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600 block md:table min-w-0 md:min-w-[800px]">
                <thead className="hidden md:table-header-group bg-[#143c68] text-white">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Waktu</th>
                    {(user.role === 'admin' || user.role === 'atasan') && (
                      <th className="px-4 py-3 font-semibold">Teknisi</th>
                    )}
                    <th className="px-4 py-3 font-semibold">Kategori</th>
                    <th className="px-4 py-3 font-semibold">Aktivitas</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group divide-y-0 md:divide-y divide-slate-200">
                  {(() => {
                    let lastDate = '';
                    return paginatedLogs.map((log) => {
                      const showDateHeader = log.tanggal !== lastDate;
                      lastDate = log.tanggal;
                      let dateHeaderString = log.tanggal;
                      try {
                        const d = new Date(log.tanggal);
                        dateHeaderString = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                      } catch {
                        // ignore and use raw date format
                      }

                      return (
                        <React.Fragment key={log.id}>
                          {showDateHeader && (
                            <tr className="block md:table-row mt-6 md:mt-0 mb-3 md:mb-0 bg-transparent md:bg-slate-100 border-none md:border-y md:border-slate-200">
                              <td colSpan={6} className="px-0 py-0 md:px-4 md:py-3">
                                <div className="inline-block px-3 py-2 bg-slate-100 md:bg-indigo-50 md:border-y md:border-indigo-100 text-slate-800 md:text-slate-700 text-base md:text-sm font-bold rounded-md md:rounded-none w-auto md:w-full md:block shadow-sm md:shadow-none">
                                  {dateHeaderString}
                                </div>
                              </td>
                            </tr>
                          )}
                          <tr className="block md:table-row bg-white border border-slate-200 md:border-none rounded-xl md:rounded-none mb-4 md:mb-0 hover:bg-slate-50 transition-colors shadow-sm md:shadow-none overflow-hidden">
                      {/* Mobile Label Headers built-in, but we'll adapt slightly based on the cell content */}
                      <td className="block md:table-cell px-5 pt-5 pb-2 md:px-4 md:py-3 md:whitespace-nowrap font-medium text-slate-700 border-none bg-transparent">
                        <div className="flex md:hidden text-[10px] uppercase font-bold text-slate-400 mb-1">Waktu</div>
                        {log.start_time} - {log.finish_time}
                      </td>
                      {(user.role === 'admin' || user.role === 'atasan') && (
                        <td className="block md:table-cell px-5 py-2 md:px-4 md:py-3 font-medium text-[#143c68]">
                          <div className="flex md:hidden text-[10px] uppercase font-bold text-slate-400 mb-1">Teknisi</div>
                          <div className="break-words whitespace-normal">{log.nama_technician}</div>
                          {log.nik && <div className="text-[10px] text-slate-400 font-normal">{log.nik}</div>}
                        </td>
                      )}
                      <td className="block md:table-cell px-5 py-2 md:px-4 md:py-3 md:whitespace-nowrap">
                        <div className="flex md:hidden text-[10px] uppercase font-bold text-slate-400 mb-1">Kategori</div>
                        <span className={`inline-block px-2 py-1 rounded text-[10px] font-bold ${
                          log.kategori_code.startsWith('P1') ? 'bg-emerald-100 text-emerald-700' :
                          log.kategori_code.startsWith('D') ? 'bg-amber-100 text-amber-700' :
                          'bg-indigo-100 text-indigo-700'
                        }`}>
                          {log.kategori_code}
                        </span>
                        {log.delay_code && <div className="text-[10px] inline-block ml-2 md:block md:ml-0 text-amber-600 mt-1 font-bold">Delay: {log.delay_code}</div>}
                      </td>
                      <td className="block md:table-cell px-5 py-2 md:px-4 md:py-3 min-w-[200px]">
                        <div className="flex md:hidden text-[10px] uppercase font-bold text-slate-400 mb-1">Aktivitas</div>
                        <div className="font-medium text-slate-800 break-words whitespace-normal">{log.deskripsi_pekerjaan}</div>
                        <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-1">
                          {log.wo_notif && <span><strong className="font-semibold">WO:</strong> {log.wo_notif}</span>}
                          {log.asset_tag && <span><strong className="font-semibold">Asset:</strong> {log.asset_tag}</span>}
                          {log.party && <span><strong className="font-semibold">Party:</strong> {log.party}</span>}
                          {log.sn && <span><strong className="font-semibold">SN:</strong> {renderSnSummary(log.sn)}</span>}
                        </div>
                        {log.catatan && <div className="text-xs text-slate-500 mt-0.5 break-words whitespace-normal"><strong className="font-semibold">Catatan:</strong> {log.catatan}</div>}
                      </td>
                      <td className="block md:table-cell px-5 py-2 md:px-4 md:py-3 md:whitespace-nowrap">
                        <div className="flex md:hidden text-[10px] uppercase font-bold text-slate-400 mb-1">Status</div>
                        <span className="inline-block text-[10px] bg-slate-100 border border-slate-200 text-slate-700 px-2 py-1 rounded font-bold uppercase">
                          {log.status}
                        </span>
                      </td>
                      <td className="block md:table-cell px-5 pb-5 pt-4 md:px-4 md:py-3 md:whitespace-nowrap bg-transparent border-t border-slate-100 md:border-none mt-2 md:mt-0">
                        <div className="flex items-center justify-end md:justify-end gap-2">
                          {canModify(log) && (
                            <>
                              <button onClick={() => handleEdit(log)} className="flex-1 md:flex-none flex items-center justify-center gap-1.5 p-2 text-sm text-indigo-600 font-semibold hover:bg-slate-200 rounded transition border border-indigo-100 md:border-transparent md:text-slate-400 md:hover:text-indigo-600" title="Edit">
                                <Pencil className="w-4 h-4" /> <span className="md:hidden">Edit</span>
                              </button>
                              <button onClick={() => handleDelete(log)} className="flex-1 md:flex-none flex items-center justify-center gap-1.5 p-2 text-sm text-red-600 font-semibold hover:bg-red-50 rounded transition border border-red-100 md:border-transparent md:text-slate-400 md:hover:text-red-600" title="Delete">
                                <Trash2 className="w-4 h-4" /> <span className="md:hidden">Hapus</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                        </React.Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-600 font-medium">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showDraftsModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[250] bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Draft Tersimpan</h3>
              <button onClick={() => setShowDraftsModal(false)} className="text-slate-400 hover:text-slate-600 font-bold p-2">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {drafts.length === 0 ? (
                <div className="text-center text-slate-500 py-8">Tidak ada draft tersimpan.</div>
              ) : (
                <div className="space-y-3">
                  {drafts.map(draft => (
                    <div key={draft.id} className="border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-700">Draft Activity - {new Date(draft.updatedAt).toLocaleString('id-ID')}</div>
                        <div className="text-sm text-slate-500 mt-1 line-clamp-1">
                          WO: {draft.data.wo_notif || '-'} | Asset: {draft.data.asset_tag || '-'} | Ket: {draft.data.deskripsi_pekerjaan || '-'}
                        </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto shrink-0">
                        <button 
                          onClick={() => {
                            if (onResumeDraft) {
                              onResumeDraft(draft.id);
                              setShowDraftsModal(false);
                            }
                          }} 
                          className="flex-1 sm:flex-none text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-2 rounded hover:bg-indigo-100 transition"
                        >
                          Lanjutkan
                        </button>
                        <button 
                          onClick={() => {
                            deleteDraft(draft.id);
                            setDrafts(getDrafts());
                          }} 
                          className="flex-1 sm:flex-none text-sm font-bold text-red-600 bg-red-50 px-3 py-2 rounded hover:bg-red-100 transition"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
