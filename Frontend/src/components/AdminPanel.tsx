import React, { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { User, DeleteMode, updateUserRole, AuditLogItem, fetchAuditLogs, fetchUsers as fetchUsersApi, updateUserProfileByAdmin, deleteUserAndLogs } from '../utils/auth';
import { Users, History, Bug, Settings, Image as ImageIcon, X, Upload, Edit, Trash2 } from 'lucide-react';
import { updateBugReportStatus, BugReport, BugStatus, bugStatusClass, fetchBugReport, fetchBugReports } from '../utils/bugReport';
import { fetchMaintenance, setMaintenance as simpanMaintenance } from '../utils/settings';
import { useDivisions } from '../utils/masterData';
import { ApiError } from '../utils/api';
// removed getLogs
import { LogActivity } from '../types';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../utils/firebase';

interface AdminPanelProps {
  onSuccessImport?: (msg: string) => void;
  onRefreshLogs?: () => void;
  currentUser: User;
}

// --- GLOBAL PERSISTENCE FOR ADMIN PANEL ---
// These variables survive component unmounts but reset on browser refresh
let pActiveTab: 'users' | 'audit' | 'bugs' | 'settings' = 'users';
let pFilterRole: 'all' | 'karyawan' | 'atasan' | 'admin' = 'all';
let pFilterUserId: string = 'all';
let pFilterDivisiUsers: string = 'all';
let pAuditPage: number = 1;
const initialTodayStr = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
let pAuditStartDate: string = initialTodayStr;
let pAuditEndDate: string = initialTodayStr;

export default function AdminPanel({ onSuccessImport, onRefreshLogs, currentUser }: AdminPanelProps) {
  const [activeTab, _setActiveTab] = useState<'users' | 'audit' | 'bugs' | 'settings'>(pActiveTab);
  const setActiveTab = (val: 'users' | 'audit' | 'bugs' | 'settings') => { pActiveTab = val; _setActiveTab(val); };

  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [bugReports, setBugReports] = useState<BugReport[]>([]);
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [selectedBugInfo, setSelectedBugInfo] = useState<BugReport | null>(null);

  // User editing and deleting state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editNik, setEditNik] = useState('');
  const [editDivisi, setEditDivisi] = useState('');
  const [editNikError, setEditNikError] = useState('');
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  // Tanpa nilai awal yang berarti: admin harus memilih. Backend pun menolak
  // permintaan hapus tanpa mode, dan itu disengaja.
  const [deleteMode, setDeleteMode] = useState<DeleteMode | ''>('');

  // Daftar divisi dari /api/master/divisions, menggantikan dua salinan <option>
  // yang sebelumnya ditulis tetap di berkas ini. Diambil dari provider, bukan
  // fetch sendiri, supaya satu kali buka aplikasi tetap satu kali request.
  const divisions = useDivisions();

  // Filtering state
  const [filterRole, _setFilterRole] = useState<'all' | 'karyawan' | 'atasan' | 'admin'>(pFilterRole);
  const setFilterRole = (val: 'all' | 'karyawan' | 'atasan' | 'admin') => { pFilterRole = val; _setFilterRole(val); };

  const [filterUserId, _setFilterUserId] = useState<string>(pFilterUserId);
  const setFilterUserId = (val: string) => { pFilterUserId = val; _setFilterUserId(val); };

  const [filterDivisiUsers, _setFilterDivisiUsers] = useState<string>(pFilterDivisiUsers);
  const setFilterDivisiUsers = (val: string) => { pFilterDivisiUsers = val; _setFilterDivisiUsers(val); };

  const todayStr = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const [auditStartDate, _setAuditStartDate] = useState<string>(pAuditStartDate);
  const setAuditStartDate = (val: string) => { pAuditStartDate = val; _setAuditStartDate(val); };

  const [auditEndDate, _setAuditEndDate] = useState<string>(pAuditEndDate);
  const setAuditEndDate = (val: string) => { pAuditEndDate = val; _setAuditEndDate(val); };
  
  // Pagination state for audit logs
  const [auditPage, _setAuditPage] = useState(pAuditPage);
  const setAuditPage = (val: number) => { pAuditPage = val; _setAuditPage(val); };

  const AUDIT_ITEMS_PER_PAGE = 40;

  // Import CSV states
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportCsv = (file: File) => {
    setImporting(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const importedData = results.data as any[];
          const newLogs: LogActivity[] = [];

          importedData.forEach((row, index) => {
            let rawTanggal = String(row['Tanggal'] || new Date().toISOString().split('T')[0]);
            // If it's DD/MM/YYYY or DD-MM-YYYY, convert to YYYY-MM-DD
            if (rawTanggal.includes('/')) {
              const parts = rawTanggal.split('/');
              if (parts.length === 3) {
                 rawTanggal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
              }
            } else if (rawTanggal.match(/^\d{2}-\d{2}-\d{4}$/)) {
              const parts = rawTanggal.split('-');
              rawTanggal = `${parts[2]}-${parts[1]}-${parts[0]}`;
            }

            const log: LogActivity = {
              id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${index}`,
              created_at: new Date().toISOString(),
              tanggal: rawTanggal,
              nama_technician: String(row['Nama Technician'] || '').trim(),
              nik: String(row['NIK'] || '').trim(),
              supervisor: String(row['Supervisor'] || '').trim(),
              shift: String(row['Shift'] || 'Pagi').trim() as any,
              wo_notif: String(row['WO/Notif'] || '').trim(),
              asset_tag: String(row['Asset/Tag'] || '').trim(),
              party: String(row['Party'] || '').trim(),
              sn: String(row['SN'] || '').trim(),
              deskripsi_pekerjaan: String(row['Deskripsi Pekerjaan'] || '').trim(),
              kategori_code: String(row['Kategori (Code)'] || '').trim().toUpperCase(),
              start_time: String(row['Start (hh:mm)'] || '').trim(),
              finish_time: String(row['Finish (hh:mm)'] || '').trim(),
              duration_minutes: (parseFloat(String(row['Durasi (jam)'] || '0').replace(',', '.')) || 0) * 60,
              status: String(row['Status'] || '-').trim() as any,
              delay_code: String(row['Delay Code'] || '').trim().toUpperCase(),
              output_qty: parseFloat(String(row['Output Qty'] || '0').replace(',', '.')) || 0,
              catatan: String(row['Catatan'] || '').trim()
            };
            // Clean undefined so no firebase complains
            Object.keys(log).forEach(key => {
              if (log[key as keyof LogActivity] === undefined) {
                delete log[key as keyof LogActivity];
              }
            });
            newLogs.push(log);
          });

          if (importMode === 'replace') {
            try {
               await import('../utils/storage').then(m => m.clearLogs());
            } catch(e) {
               console.error(e);
            }
          }

          try {
            const chunkSize = 500;
            for (let i = 0; i < newLogs.length; i += chunkSize) {
              const batch = writeBatch(db);
              const chunk = newLogs.slice(i, i + chunkSize);
              chunk.forEach(log => {
                const docRef = doc(db, 'tech_logs', log.id);
                batch.set(docRef, log, { merge: true });
              });
              await batch.commit();
            }
          } catch(firebaseError) {
            console.error("Firebase import error: ", firebaseError);
            alert("Sebagian data gagal disinkronkan ke server Firebase. Cek koneksi atau izin.");
          }

          setImporting(false);
          
          if (onRefreshLogs) onRefreshLogs();
          if (onSuccessImport) onSuccessImport(`Berhasil menginjeksi ${newLogs.length} baris data CSV ke dalam sistem.`);
          if (fileInputRef.current) fileInputRef.current.value = '';

        } catch (error) {
          console.error(error);
          alert('Terjadi kesalahan saat mapping data CSV. Pastikan format kolom sesuai.');
          setImporting(false);
        }
      },
      error: (error) => {
        console.error(error);
        alert('Gagal memparsing file CSV.');
        setImporting(false);
      }
    });
  };

  // Tidak ada lagi cadangan ke daftar user contoh. Kegagalan mengambil daftar
  // sekarang menghasilkan tabel kosong, bukan empat nama karangan yang terlihat
  // seperti data sungguhan.
  const fetchUsers = async () => {
    setUsers(await fetchUsersApi());
  };

  useEffect(() => {
    fetchUsers();
    fetchMaintenance().then(setIsMaintenance);
  }, []);

  const muatAuditLogs = () => {
    // Rentang tanggal dan pilihan user dikirim ke server, tidak lagi disaring
    // di browser atas 50 baris terbaru. Dulu memilih rentang tanggal lama
    // selalu berakhir dengan layar kosong: yang disaring cuma 50 baris
    // terakhir, dan tak satu pun masuk rentang yang diminta.
    fetchAuditLogs({
      userId: filterUserId !== 'all' ? filterUserId : undefined,
      startDate: auditStartDate || undefined,
      endDate: auditEndDate || undefined,
    }).then(logs => {
      setAuditLogs(logs);
      setAuditPage(1);
    });
  };

  const muatBugReports = () => {
    fetchBugReports().then(reports => {
      reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setBugReports(reports);
    });
  };

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    } else if (activeTab === 'audit') {
      muatAuditLogs();
    } else if (activeTab === 'bugs') {
      muatBugReports();
    }
  }, [activeTab]);

  // Penyaringan audit terjadi di server, jadi perubahannya harus memicu
  // pengambilan ulang -- bukan sekadar menyaring ulang yang sudah di memori.
  useEffect(() => {
    if (activeTab === 'audit') {
      muatAuditLogs();
    }
  }, [auditStartDate, auditEndDate, filterUserId]);

  const handleRoleChange = async (u: User, newRole: 'karyawan' | 'atasan' | 'admin') => {
    if (u.email === 'leahcimtwis@gmail.com' && currentUser.email !== 'leahcimtwis@gmail.com') {
      alert('Tidak bisa mengubah role super admin');
      return;
    }
    // Backend menolak sendiri perubahan pada akun super admin oleh admin lain;
    // pemeriksaan di atas hanya supaya tombolnya tidak sempat terkirim.
    try {
      await updateUserRole(u.id, newRole);
      fetchUsers();
    } catch (e: any) {
      alert(e?.message || 'Gagal mengubah role user.');
      fetchUsers();
    }
  };

  const handleEditUser = (u: User) => {
    setEditingUser(u);
    setEditName(u.name);
    setEditNik(u.nik || '');
    setEditDivisi(u.divisi || '-');
    setEditNikError('');
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    if (editingUser.email === 'leahcimtwis@gmail.com' && currentUser.email !== 'leahcimtwis@gmail.com') {
      alert('Tidak bisa mengedit super admin');
      setEditingUser(null);
      return;
    }

    setEditNikError('');

    try {
      await updateUserProfileByAdmin(editingUser.id, { name: editName, nik: editNik, divisi: editDivisi });
      setEditingUser(null);
      fetchUsers();
    } catch (e: any) {
      // NIK yang dipakai user lain dijawab 422 dengan errors.nik. Ditempel di
      // bawah inputnya dan modalnya sengaja dibiarkan terbuka -- menutupnya
      // membuang seluruh isian hanya karena satu field salah. NIK milik user
      // yang sedang diedit sendiri tidak dihitung bentrok oleh backend.
      if (e instanceof ApiError && e.field('nik')) {
        setEditNikError(e.field('nik') as string);
        alert(e.message);
        return;
      }

      alert(e?.message || 'Gagal mengedit user');
    }
  };

  const handleConfirmDelete = (u: User) => {
    if (u.email === 'leahcimtwis@gmail.com') {
      alert('Tidak bisa menghapus super admin');
      return;
    }
    setDeleteMode('');
    setUserToDelete(u);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete || deleteMode === '') return;
    setIsDeletingUser(true);
    try {
      await deleteUserAndLogs(userToDelete.id, deleteMode);
      setUserToDelete(null);
      setDeleteMode('');
      if (onRefreshLogs) onRefreshLogs();
      fetchUsers();
    } catch (e: any) {
      // Backend menolak beberapa hal dengan alasan yang jelas: menghapus akun
      // sendiri, super admin, akun penampung legacy, atau detach saat akun
      // penampungnya belum dibuat. Pesannya jauh lebih berguna daripada
      // "Gagal menghapus user".
      alert(e?.message || 'Gagal menghapus user');
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleMaintenanceToggle = async () => {
    const newValue = !isMaintenance;
    setIsMaintenance(newValue);

    try {
      await simpanMaintenance(newValue);
    } catch (e: any) {
      // Sakelarnya dikembalikan kalau server menolak; kalau tidak, layar
      // mengaku maintenance menyala padahal tidak ada yang berubah.
      setIsMaintenance(!newValue);
      alert(e?.message || 'Gagal mengubah mode maintenance.');
    }
  };

  const handleBugStatusUpdate = async (id: string, status: BugStatus) => {
    try {
      await updateBugReportStatus(id, status);
    } catch (e: any) {
      alert(e?.message || 'Gagal mengubah status laporan.');
      return;
    }

    muatBugReports();

    if (selectedBugInfo && selectedBugInfo.id === id) {
      setSelectedBugInfo({ ...selectedBugInfo, status });
    }
  };

  /**
   * Gambar baru diambil di sini, bukan saat daftar dimuat.
   *
   * Endpoint daftar tidak membawa imageBase64 -- ratusan KB per baris, dan satu
   * halaman berisi puluhan laporan. Yang ikut di daftar hanya has_image, cukup
   * untuk menampilkan ikon klip.
   */
  const handleOpenBugDetail = async (report: BugReport) => {
    setSelectedBugInfo(report);

    if (!report.has_image) return;

    try {
      setSelectedBugInfo(await fetchBugReport(report.id));
    } catch (e) {
      console.error("Gagal mengambil detail laporan", e);
    }
  };

  // Reset user filter when role filter changes
  useEffect(() => {
     setFilterUserId('all');
     setAuditPage(1);
  }, [filterRole]);

  // Derived state for filtering
  const filteredUsersForDropdown = useMemo(() => {
    if (filterRole === 'all') return [];
    return users.filter(u => u.role === filterRole);
  }, [users, filterRole]);

  const filteredUsersTable = useMemo(() => {
    return users.filter(u => {
      if (filterDivisiUsers !== 'all' && (u.divisi || '-') !== filterDivisiUsers) return false;
      return true;
    });
  }, [users, filterDivisiUsers]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
        if (filterRole === 'all') return true;
        
        // Find user to check their current role
        const logUser = users.find(u => u.id === log.userId);
        if (!logUser || logUser.role !== filterRole) return false;

        if (filterUserId !== 'all' && logUser.id !== filterUserId) return false;

        return true;
    }).filter(log => {
        if (!auditStartDate && !auditEndDate) return true;
        const logDate = log.timestamp.split('T')[0];
        if (auditStartDate && logDate < auditStartDate) return false;
        if (auditEndDate && logDate > auditEndDate) return false;
        return true;
    });
  }, [auditLogs, users, filterRole, filterUserId, auditStartDate, auditEndDate]);

  const totalAuditPages = Math.ceil(filteredAuditLogs.length / AUDIT_ITEMS_PER_PAGE);
  const paginatedAuditLogs = filteredAuditLogs.slice((auditPage - 1) * AUDIT_ITEMS_PER_PAGE, auditPage * AUDIT_ITEMS_PER_PAGE);

  return (
    <div className="flex-1 flex flex-col overflow-hidden max-w-7xl mx-auto w-full">
      <div className="bg-white p-4 sm:p-6 shadow-sm border border-slate-200 mb-4 shrink-0">
        <h2 className="text-xl font-bold text-[#143c68] mb-4">Admin Dashboard</h2>
        <div className="flex gap-2 flex-wrap">
          <button 
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'users' ? 'bg-[#143c68] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Users className="w-4 h-4" /> User Management
          </button>
          <button 
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'audit' ? 'bg-[#143c68] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <History className="w-4 h-4" /> Audit Logs
          </button>
          <button 
            onClick={() => setActiveTab('bugs')}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'bugs' ? 'bg-[#143c68] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Bug className="w-4 h-4" /> Bug Reports
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'settings' ? 'bg-[#143c68] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Settings className="w-4 h-4" /> System Settings
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        {activeTab === 'users' && (
           <div className="flex-1 flex flex-col overflow-hidden">
             <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-4 items-center">
               <div className="flex items-center gap-2">
                 <label className="text-sm font-bold text-slate-700">Filter Divisi:</label>
                 <select 
                   value={filterDivisiUsers}
                   onChange={(e) => setFilterDivisiUsers(e.target.value)}
                   className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none"
                 >
                   <option value="all">Semua Divisi</option>
                   {divisions.map(d => (
                     <option key={d.id} value={d.name}>{d.name}</option>
                   ))}
                 </select>
               </div>
               <div className="ml-auto text-sm font-bold text-[#143c68]">
                 Total: {filteredUsersTable.length} user
               </div>
             </div>
             <div className="flex-1 overflow-y-auto">
               <table className="w-full text-left text-sm">
                <thead className="bg-[#143c68] text-white sticky top-0">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Nama Lengkap</th>
                    <th className="px-4 py-3 font-semibold">Email (ID)</th>
                    <th className="px-4 py-3 font-semibold">NIK</th>
                    <th className="px-4 py-3 font-semibold">Divisi</th>
                    <th className="px-4 py-3 font-semibold">Role</th>
                    <th className="px-4 py-3 font-semibold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredUsersTable.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{u.name}</td>
                      <td className="px-4 py-3 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3 text-slate-600">{u.nik || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{u.divisi || '-'}</td>
                      <td className="px-4 py-3">
                        <select 
                          value={u.role} 
                          onChange={(e) => handleRoleChange(u, e.target.value as any)}
                          disabled={u.email === 'leahcimtwis@gmail.com' && currentUser.email !== 'leahcimtwis@gmail.com'}
                          className="px-2 py-1 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none disabled:opacity-50 disabled:bg-slate-100"
                        >
                          <option value="karyawan">Karyawan</option>
                          <option value="atasan">Atasan</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 flex gap-2 justify-center items-center">
                        <button
                          onClick={() => handleEditUser(u)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleConfirmDelete(u)}
                          className={`p-1.5 rounded ${u.email === 'leahcimtwis@gmail.com' ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'}`}
                          title="Hapus"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredUsersTable.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">Belum ada user.</td>
                    </tr>
                  )}
                </tbody>
             </table>
           </div>
           </div>
        )}

        {activeTab === 'audit' && (
           <div className="flex-1 overflow-hidden flex flex-col">
             <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-4 items-center">
               <div className="flex items-center gap-2">
                 <label className="text-sm font-bold text-slate-700">Filter Role:</label>
                 <select 
                   value={filterRole}
                   onChange={(e) => setFilterRole(e.target.value as any)}
                   className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none"
                 >
                   <option value="all">Semua Role</option>
                   <option value="karyawan">Karyawan</option>
                   <option value="atasan">Atasan</option>
                   <option value="admin">Admin</option>
                 </select>
               </div>
               
               <div className="flex items-center gap-2">
                 <label className="text-sm font-bold text-slate-700">Filter User:</label>
                 <select 
                   value={filterUserId}
                   onChange={(e) => {
                     setFilterUserId(e.target.value);
                     setAuditPage(1);
                   }}
                   disabled={filterRole === 'all'}
                   className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none disabled:bg-slate-100 disabled:text-slate-400"
                 >
                   <option value="all">Semua User</option>
                   {filteredUsersForDropdown.map(u => (
                     <option key={u.id} value={u.id}>{u.name} {u.nik ? `(${u.nik})` : ''}</option>
                   ))}
                 </select>
               </div>
               
               <div className="flex items-center gap-2 border-l border-slate-300 pl-4 ml-2">
                 <input 
                   type="date"
                   value={auditStartDate}
                   onChange={e => { setAuditStartDate(e.target.value); setAuditPage(1); }}
                   className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none"
                 />
                 <span className="text-sm font-bold text-slate-500">s/d</span>
                 <input 
                   type="date"
                   value={auditEndDate}
                   onChange={e => { setAuditEndDate(e.target.value); setAuditPage(1); }}
                   className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none"
                 />
               </div>
               
               <div className="ml-auto text-sm font-bold text-[#143c68]">
                 Total: {filteredAuditLogs.length} logs
               </div>
             </div>

             <div className="flex-1 overflow-y-auto">
               <table className="w-full text-left text-sm">
                  <thead className="bg-[#143c68] text-white sticky top-0">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Timestamp</th>
                      <th className="px-4 py-3 font-semibold">User</th>
                      <th className="px-4 py-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {paginatedAuditLogs.map((log) => {
                      const date = new Date(log.timestamp);
                      const formatted = `${date.toISOString().split('T')[0]} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
                      return (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-slate-500 whitespace-nowrap">{formatted}</td>
                        <td className="px-4 py-2 font-medium text-slate-800">{log.userName}</td>
                        <td className="px-4 py-2 text-slate-600">{log.action}</td>
                      </tr>
                    )})}
                    {paginatedAuditLogs.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-slate-400">Belum ada log.</td>
                      </tr>
                    )}
                  </tbody>
               </table>
             </div>
             
             {totalAuditPages > 1 && (
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                <button
                  onClick={() => setAuditPage(Math.max(1, auditPage - 1))}
                  disabled={auditPage === 1}
                  className="px-4 py-2 border border-slate-300 bg-white rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-600 font-medium">
                  Page {auditPage} of {totalAuditPages}
                </span>
                <button
                  onClick={() => setAuditPage(Math.min(totalAuditPages, auditPage + 1))}
                  disabled={auditPage === totalAuditPages}
                  className="px-4 py-2 border border-slate-300 bg-white rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
           </div>
        )}

        {activeTab === 'bugs' && (
          <div className="flex-1 flex flex-col min-h-0 bg-white">
             {selectedBugInfo ? (
               <div className="p-6 flex-1 overflow-y-auto relative">
                 <button onClick={() => setSelectedBugInfo(null)} className="absolute top-4 right-4 p-2 text-slate-500 hover:bg-slate-100 rounded-full">
                   <X className="w-5 h-5"/>
                 </button>
                 <h3 className="text-xl font-bold text-slate-800 mb-2">{selectedBugInfo.title}</h3>
                 <div className="text-xs text-slate-500 mb-6 flex gap-4">
                   <span>Pelapor: <strong>{selectedBugInfo.userName}</strong> ({selectedBugInfo.role})</span>
                   <span>Status: <strong className={selectedBugInfo.status === 'Open' ? 'text-red-500' : selectedBugInfo.status === 'In Progress' ? 'text-amber-600' : 'text-green-500'}>{selectedBugInfo.status}</strong></span>
                 </div>
                 
                 <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-6">
                   <p className="text-slate-700 whitespace-pre-wrap">{selectedBugInfo.description}</p>
                 </div>

                 {selectedBugInfo.imageBase64 && (
                   <div className="mb-6">
                     <h4 className="text-sm font-bold text-slate-700 mb-2">Attachment</h4>
                     <img src={selectedBugInfo.imageBase64} alt="Bug Request" className="max-w-full rounded-lg border border-slate-200" />
                   </div>
                 )}

                 <div className="flex gap-3">
                    {selectedBugInfo.status === 'Open' ? (
                      <button 
                        onClick={() => handleBugStatusUpdate(selectedBugInfo.id, 'Resolved')}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg font-bold text-sm hover:bg-green-700"
                      >Mark as Resolved</button>
                    ) : (
                      <button 
                         onClick={() => handleBugStatusUpdate(selectedBugInfo.id, 'Open')}
                         className="px-4 py-2 border border-slate-300 rounded-lg font-bold text-sm hover:bg-slate-50"
                      >Re-open Issue</button>
                    )}
                 </div>
               </div>
             ) : (
               <div className="flex-1 overflow-y-auto">
                 <table className="w-full text-left text-sm">
                    <thead className="bg-[#143c68] text-white sticky top-0">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Waktu</th>
                        <th className="px-4 py-3 font-semibold">Pelapor</th>
                        <th className="px-4 py-3 font-semibold">Judul Masalah</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {bugReports.map((report) => {
                        const date = new Date(report.timestamp);
                        const formatted = `${date.toISOString().split('T')[0]} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                        return (
                        <tr key={report.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">{formatted}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{report.userName}</td>
                          <td className="px-4 py-3 text-slate-600 font-medium">
                            <div className="flex items-center gap-2">
                              {/* has_image dari server: penanda ada tidaknya
                                  lampiran, tanpa ikut mengunduh gambarnya. */}
                              {report.has_image && <ImageIcon className="w-4 h-4 text-slate-400" />}
                              {report.title}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${bugStatusClass(report.status)}`}>
                              {report.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                             <button
                               onClick={() => handleOpenBugDetail(report)}
                               className="px-3 py-1 bg-[#143c68] text-white rounded text-xs font-bold hover:bg-[#1a4f8a]"
                             >
                               Lihat Detail
                             </button>
                          </td>
                        </tr>
                      )})}
                      {bugReports.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">Belum ada laporan bug.</td>
                        </tr>
                      )}
                    </tbody>
                 </table>
               </div>
             )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <h3 className="text-xl font-bold text-slate-800 mb-6">System Settings</h3>
            
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 max-w-2xl mb-6">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-[#143c68]" />
                    Maintenance Mode
                  </h4>
                  <p className="text-slate-600 text-sm mt-1">
                    Saat mode ini aktif, Karyawan dan Atasan tidak dapat masuk ke dalam aplikasi dan akan melihat layar "Under Maintenance". 
                    Admin akan tetap bisa mengakses dan melihat seluruh fitur.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input type="checkbox" className="sr-only peer" checked={isMaintenance} onChange={handleMaintenanceToggle} />
                  <div className="w-14 h-7 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
                </label>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 max-w-2xl mb-6">
              <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
                <Upload className="w-5 h-5 text-[#143c68]" />
                Import Data dari CSV (Stress Test)
              </h4>
              <p className="text-slate-600 text-sm mb-4">
                Fitur ini dirancang untuk menginjeksi ribuan baris data log aktivitas ke dalam Database / Firebase. Pastikan format kolom sesuai dengan template export.
              </p>

              {/* Import menulis ke Firestore lewat writeBatch, sementara
                  aplikasi sudah membaca dari MariaDB. Kalau dibiarkan aktif,
                  ribuan baris masuk ke tempat yang tidak dibaca siapa pun dan
                  hilang tanpa pesan error. */}
              <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                Sementara tidak tersedia — menunggu endpoint backend untuk impor massal.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Pilih Mode Import</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input 
                        type="radio" 
                        name="importMode" 
                        value="append" 
                        checked={importMode === 'append'} 
                        onChange={() => setImportMode('append')}
                        className="w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-600"
                      />
                      Tambahkan ke data yang sudah ada (Append)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input 
                        type="radio" 
                        name="importMode" 
                        value="replace" 
                        checked={importMode === 'replace'} 
                        onChange={() => setImportMode('replace')}
                        className="w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-600"
                      />
                      Timpa semua data lama (Replace)
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    accept=".csv"
                    ref={fileInputRef}
                    disabled
                    className="block w-full text-sm text-slate-500
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-md file:border-0
                      file:text-sm file:font-semibold
                      file:bg-[#143c68] file:text-white
                      hover:file:bg-[#1a4f8a]
                      cursor-pointer border border-slate-300 rounded-md bg-white p-1
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={() => fileInputRef.current?.files?.[0] && handleImportCsv(fileInputRef.current.files[0])}
                    disabled
                    title="Sementara tidak tersedia — menunggu endpoint backend"
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap min-w-[120px]"
                  >
                    {importing ? 'Loading...' : 'Mulai Import'}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-2xl">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-red-800 flex items-center gap-2">
                    <X className="w-5 h-5 text-red-600" />
                    Kosongkan Data (Drop Tabel Tech Logs)
                  </h4>
                  <p className="text-red-600 text-sm mt-1 mb-4">
                    Fitur ini akan menghapus <b>semua log aktivitas</b> di database Firebase secara permanen. Sangat berguna setelah selesai melakukan uji coba.
                  </p>

                  {/* Yang paling berisiko dari ketiganya. Versi lamanya
                      menghapus seluruh collection tech_logs di Firestore --
                      setelah migrasi, itu menghapus data di tempat yang sudah
                      tidak dibaca aplikasi sambil melaporkan "berhasil", dan
                      tidak menyentuh satu baris pun di MariaDB. */}
                  <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    Sementara tidak tersedia — menunggu endpoint backend untuk hapus massal.
                  </p>

                  <button
                    onClick={async () => {
                      if (window.confirm("PERINGATAN: Anda yakin ingin mengosongkan semua log aktivitas uji coba secara permanen?")) {
                        await import('../utils/storage').then(m => m.clearLogs());
                        if (onRefreshLogs) onRefreshLogs();
                        if (onSuccessImport) onSuccessImport("Semua log aktivitas berhasil dikosongkan (Tabel di-drop).");
                      }
                    }}
                    disabled
                    title="Sementara tidak tersedia — menunggu endpoint backend"
                    className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
                  >
                    Kosongkan Tabel Sekarang
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {editingUser && (
        <div className="fixed inset-0 min-h-screen flex items-center justify-center bg-black/60 z-[100] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 relative">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Edit Data User</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nama Lengkap</label>
                <input 
                  type="text" 
                  value={editName} 
                  onChange={(e) => setEditName(e.target.value)} 
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">NIK</label>
                <input
                  type="text"
                  value={editNik}
                  onChange={(e) => { setEditNik(e.target.value); if (editNikError) setEditNikError(''); }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm"
                />
                {editNikError && <p className="mt-1 text-sm text-red-600">{editNikError}</p>}
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Divisi</label>
                <select
                  value={editDivisi}
                  onChange={(e) => setEditDivisi(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm"
                >
                  {divisions.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-50"
                >
                  Batal
                </button>
                <button 
                  onClick={handleUpdateUser}
                  className="flex-1 px-4 py-2 bg-[#143c68] text-white rounded-lg font-bold text-sm hover:bg-[#1a4f8a]"
                >
                  Simpan Perubahan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {userToDelete && (
        <div className="fixed inset-0 min-h-screen flex items-center justify-center bg-black/60 z-[100] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 relative">
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <Trash2 className="w-8 h-8" />
              <h3 className="text-xl font-bold">Hapus User</h3>
            </div>
            <p className="text-slate-600 mb-2">
              Anda yakin ingin menghapus user <strong>{userToDelete.name}</strong>?
            </p>
            {/* Dua mode, tanpa nilai awal. Backend pun menolak permintaan hapus
                tanpa mode: menghapus data orang tidak boleh terjadi hanya karena
                satu pilihan terlewat. */}
            <div className="space-y-2 mb-6">
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer bg-red-50 p-3 rounded-lg border border-red-100">
                <input
                  type="radio"
                  name="deleteMode"
                  value="purge"
                  checked={deleteMode === 'purge'}
                  onChange={() => setDeleteMode('purge')}
                  disabled={isDeletingUser}
                  className="w-4 h-4 mt-0.5 shrink-0"
                />
                <span>
                  <strong className="text-red-700">Hapus semuanya</strong>
                  <span className="block text-red-600 text-xs mt-0.5">
                    Log aktivitas, catatan audit, dan laporan bug milik user ini ikut terhapus permanen. Tidak bisa dibatalkan.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer bg-slate-50 p-3 rounded-lg border border-slate-200">
                <input
                  type="radio"
                  name="deleteMode"
                  value="detach"
                  checked={deleteMode === 'detach'}
                  onChange={() => setDeleteMode('detach')}
                  disabled={isDeletingUser}
                  className="w-4 h-4 mt-0.5 shrink-0"
                />
                <span>
                  <strong className="text-slate-800">Hapus profilnya saja</strong>
                  <span className="block text-slate-500 text-xs mt-0.5">
                    Datanya dialihkan ke akun penampung dan tetap tersimpan. Nama teknisi pada histori tidak berubah.
                  </span>
                </span>
              </label>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setUserToDelete(null); setDeleteMode(''); }}
                disabled={isDeletingUser}
                className="flex-1 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={isDeletingUser || deleteMode === ''}
                title={deleteMode === '' ? 'Pilih dulu apa yang terjadi pada datanya' : undefined}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeletingUser ? 'Loading...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
