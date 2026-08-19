import React, { useState, useEffect } from 'react';
import { Settings, LogOut, List as ListIcon, LayoutDashboard, Menu, X, BookOpen, FileQuestion, Users, Bug, FileSpreadsheet, Download } from 'lucide-react';
import InputForm from './components/InputForm';
import Dashboard from './components/Dashboard';
import ResumeTab from './components/ResumeTab';
import Login from './components/Login';
import ActivityList from './components/ActivityList';
import Toast from './components/Toast';
import InformationScreens from './components/InformationScreens';
import AdminPanel from './components/AdminPanel';
import BugReportModal from './components/BugReportModal';
import SuccessModal from './components/SuccessModal';
import RegistrationStatus from './components/RegistrationStatus';
import { logout, syncSession, RegistrationInfo, User, fetchUsers } from './utils/auth';
import { fetchMaintenance } from './utils/settings';
import { signOut } from 'firebase/auth';
import { auth } from './utils/firebase';
import { fetchLogs } from './utils/storage';
import { LogActivity } from './types';
import GlobalExportModal from './components/GlobalExportModal';
import { MasterDataProvider } from './utils/masterData';
import { deleteDraft } from './utils/drafts';

/**
 * Akun yang sudah mendaftar tapi belum boleh masuk.
 *
 * Sengaja terpisah dari currentUser dan bukan sekadar "user dengan role
 * kosong": selama menunggu, orangnya tidak punya baris di tabel users sama
 * sekali, jadi tidak satu pun endpoint aplikasi bisa dipanggil. Menyimpannya
 * sebagai user setengah jadi akan membuat seluruh layar memuat lalu gagal
 * sepotong-sepotong.
 */
interface StatusPendaftaran {
  status: 'pending' | 'rejected';
  registration: RegistrationInfo | null;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [statusPendaftaran, setStatusPendaftaran] = useState<StatusPendaftaran | null>(null);

  // Dari /api/auth/sync. Hanya menentukan apa yang ditampilkan di AdminPanel;
  // pengamannya SuperAdminMiddleware di server.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  /** Satu pintu masuk supaya ketiga state di atas tidak pernah saling bertentangan. */
  const masuk = (user: User, superAdmin: boolean) => {
    setStatusPendaftaran(null);
    setIsSuperAdmin(superAdmin);
    setCurrentUser(user);
  };

  useEffect(() => {
    const unsub = import('firebase/auth').then(({ onAuthStateChanged }) => {
      const unsubscribeFunction = onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
          setCurrentUser(null);
          setStatusPendaftaran(null);
          setIsSuperAdmin(false);
          setAuthLoading(false);
          return;
        }

        // Menggantikan getDoc(doc(db, 'users', uid)). Akun yang belum terdaftar
        // menjawab 200 dengan registered = false, bukan error -- dan sengaja
        // tidak di-signOut, supaya Login bisa melanjutkan ke form pendaftaran.
        try {
          const sesi = await syncSession();

          if (sesi.status === 'active' && sesi.user) {
            masuk(sesi.user, sesi.isSuperAdmin);
          } else if (sesi.status === 'pending' || sesi.status === 'rejected') {
            // Sudah mendaftar, belum boleh masuk. Layar tunggu yang muncul,
            // bukan form pendaftaran -- mengisinya lagi hanya akan dijawab 409.
            setCurrentUser(null);
            setIsSuperAdmin(false);
            setStatusPendaftaran({ status: sesi.status, registration: sesi.registration });
          } else {
            setCurrentUser(null);
            setIsSuperAdmin(false);
            setStatusPendaftaran(null);
          }
        } catch (e) {
          // Backend mati atau token ditolak. Diperlakukan sebagai belum login;
          // layar Login yang muncul, bukan halaman kosong tanpa penjelasan.
          console.error("Gagal memeriksa sesi ke backend", e);
          setCurrentUser(null);
          setIsSuperAdmin(false);
          setStatusPendaftaran(null);
        } finally {
          setAuthLoading(false);
        }
      });
      return unsubscribeFunction;
    });

    return () => {
      unsub.then(fn => fn());
    };
  }, []);
  const [activeTab, setActiveTab] = useState<'list' | 'input' | 'dashboard' | 'resume' | 'lists' | 'howto' | 'admin'>('dashboard');

  const [isFormDirty, setIsFormDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [showDraftsModal, setShowDraftsModal] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (activeTab === 'input' && isFormDirty) {
        const message = "Perubahan belum disimpan. Apakah Anda yakin ingin keluar?";
        e.returnValue = message;
        return message;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeTab, isFormDirty]);

  const requestNavigation = (action: () => void) => {
    if (activeTab === 'input' && isFormDirty) {
      setPendingNavigation(() => action);
    } else {
      action();
    }
  };

  const today = new Date();
  const todayStr = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(today.getTime() - today.getTimezoneOffset() * 60000 - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const [listStartDate, setListStartDate] = useState(todayStr);
  const [listEndDate, setListEndDate] = useState(todayStr);
  const [resumeStartDate, setResumeStartDate] = useState(todayStr);
  const [resumeEndDate, setResumeEndDate] = useState(todayStr);
  const [dashboardDate, setDashboardDate] = useState(todayStr);
  
  const [globalNik, setGlobalNik] = useState<string>('');
  const [globalDivisi, setGlobalDivisi] = useState<string>('');
  const [logs, setLogs] = useState<LogActivity[]>([]);
  const [editingLog, setEditingLog] = useState<LogActivity | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [showGlobalExport, setShowGlobalExport] = useState(false);
  const [successModal, setSuccessModal] = useState<{isOpen: boolean, title: string, message: string}>({ isOpen: false, title: '', message: '' });

  const [logsLoading, setLogsLoading] = useState(true);

  useEffect(() => {
    // Dulu onSnapshot ke Firestore, jadi perubahannya langsung terasa di semua
    // browser yang sedang terbuka. Lewat REST tidak ada yang setara: nilainya
    // dibaca sekali saat aplikasi dimuat. Admin yang menyalakan maintenance
    // tidak lagi langsung mengusir user yang halamannya sudah terbuka -- mereka
    // baru melihatnya setelah memuat ulang. Diterima apa adanya; polling ke
    // hosting bersama harganya lebih mahal daripada masalah yang dipecahkannya.
    //
    // Endpointnya terbuka tanpa autentikasi, karena layar "Under Maintenance"
    // juga harus tampil di halaman login -- sebelum ada yang masuk.
    fetchMaintenance()
      .then(setIsMaintenance)
      .catch((e) => console.error("Gagal membaca status maintenance", e));
  }, []);

  const [allUsers, setAllUsers] = useState<User[]>([]);

  const refreshLogs = async () => {
    console.count("refreshLogs");
    setLogsLoading(true);
    const minD = [listStartDate, resumeStartDate, dashboardDate].reduce((a, b) => a < b ? a : b);
    const maxD = [listEndDate, resumeEndDate, dashboardDate].reduce((a, b) => a > b ? a : b);
    
    console.log("refreshLogs", {
        startDate: minD,
        endDate: maxD,
        time: new Date().toISOString()
    });

    const fetched = await fetchLogs(minD, maxD);
    setLogs(fetched);
    setLogsLoading(false);
  };

  useEffect(() => {
    if (currentUser) {
      setActiveTab('dashboard');
      fetchUsers().then((res) => {
         setAllUsers(res);
      });
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      refreshLogs();
    }
  }, [currentUser, listStartDate, listEndDate, resumeStartDate, resumeEndDate, dashboardDate]);

  const handleLogout = async () => {
    // logout() hanya menulis catatan audit kalau ada user; pendaftar yang masih
    // menunggu memang tidak punya baris users, dan endpoint audit akan
    // menolaknya 403. Karena itu currentUser dioper apa adanya, bukan dipaksa.
    await logout(currentUser);
    try {
      await signOut(auth);
    } catch(e) {
      console.error(e);
    }
    setCurrentUser(null);
    setStatusPendaftaran(null);
    setIsSuperAdmin(false);
  };

  const handleDeleteSuccess = (id: string) => {
    setLogs(prev => prev.filter(log => log.id !== id));
  };

  const handleInputSuccess = (savedLog?: LogActivity, isEdit?: boolean) => {
    if (savedLog) {
      setLogs(prev => {
        if (isEdit) {
          return prev.map(log => log.id === savedLog.id ? savedLog : log);
        } else {
          return [savedLog, ...prev];
        }
      });
    }
    setActiveTab('list');
    setEditingLog(null);
  };

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const TIMEOUT_MS = 120 * 60 * 1000; // 120 minutes

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (currentUser) {
        timeoutId = setTimeout(() => {
          handleLogout();
          alert('Sesi Anda telah berakhir karena tidak ada aktivitas selama 120 menit. Silakan login kembali.');
        }, TIMEOUT_MS);
      }
    };

    if (currentUser) {
      resetTimer();
      window.addEventListener('mousemove', resetTimer);
      window.addEventListener('keydown', resetTimer);
      window.addEventListener('mousedown', resetTimer);
      window.addEventListener('touchstart', resetTimer);
      window.addEventListener('scroll', resetTimer);
      window.addEventListener('paste', resetTimer);
      window.addEventListener('focusin', resetTimer);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('mousedown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      window.removeEventListener('scroll', resetTimer);
      window.removeEventListener('paste', resetTimer);
      window.removeEventListener('focusin', resetTimer);
    };
  }, [currentUser]);

  const showToast = (message: string) => {
    setToastMessage(message);
  };

  // handleExportAll dihapus: tidak pernah dirujuk dari JSX mana pun. Tombol
  // "Export All Reports" di sidebar membuka GlobalExportModal, yang memakai
  // exportMegaReport. Dibiarkan hidup, ia jadi satu-satunya pemanggil
  // exportAllReportsToExcel dan harus ikut dioper data master padahal berada di
  // luar MasterDataProvider.

  const handleNewActivity = () => {
    setEditingLog(null);
    setCurrentDraftId(Date.now().toString());
    setActiveTab('input');
  };

  const handleResumeDraft = (draftId: string) => {
    setEditingLog(null);
    setCurrentDraftId(draftId);
    setActiveTab('input');
  };

  const handleEditActivity = (log: LogActivity) => {
    setEditingLog(log);
    setCurrentDraftId(null);
    setActiveTab('input');
  };

  if (authLoading) {
    return (
      <div className="flex h-screen w-full bg-slate-50 items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-slate-500">
           <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#143c68] animate-spin" />
           <p className="font-semibold text-sm">Menghubungkan ke Server...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    if (isMaintenance) {
      return (
        <div className="flex h-screen w-full bg-slate-50 items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
            <Settings className="w-16 h-16 text-[#143c68] mx-auto mb-4 animate-spin-slow" />
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Under Maintenance</h1>
            <p className="text-slate-600 mb-6">Sistem sedang dalam perbaikan rutin. Silakan kembali lagi nanti.</p>
          </div>
        </div>
      );
    }

    // Sudah mendaftar, tinggal menunggu (atau ditolak). Berdiri sendiri di
    // depan aplikasi: tidak ada endpoint lain yang bisa dipanggil dari sini.
    if (statusPendaftaran) {
      return (
        <RegistrationStatus
          status={statusPendaftaran.status}
          registration={statusPendaftaran.registration}
          onActive={masuk}
          onUnregistered={() => setStatusPendaftaran(null)}
          onLogout={handleLogout}
        />
      );
    }

    return <Login onLogin={masuk} onPending={setStatusPendaftaran} />;
  }

  const activeMaintenance = isMaintenance;
  // Force maintenance overlay for non-admins if active
  if (activeMaintenance && currentUser.role !== 'admin') {
    return (
      <div className="flex h-screen w-full bg-slate-50 items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
          <Settings className="w-16 h-16 text-[#143c68] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Under Maintenance</h1>
          <p className="text-slate-600 mb-6">Sistem sedang dalam perbaikan rutin. Silakan kembali lagi nanti.</p>
          <button 
            onClick={handleLogout} 
            className="w-full flex justify-center items-center gap-2 bg-[#143c68] text-white py-2 px-4 rounded-lg font-bold hover:bg-[#1a4f8a] transition"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </div>
    );
  }

  const canSeeInput = currentUser.role === 'karyawan' || currentUser.role === 'admin' || currentUser.role === 'atasan';
  const canSeeDashboard = true; // Everyone can see dashboard now
  
  let visibleLogs = logs;
  if (currentUser.role === 'karyawan') {
    visibleLogs = logs.filter(l => l.nik === currentUser.nik);
  }

  return (
    /* Dipasang di sini, bukan di main.tsx: ketiga endpoint master mensyaratkan
       baris di tabel users, jadi baru boleh diambil setelah user terdaftar
       masuk. Provider tidak menghasilkan elemen DOM apa pun. */
    <MasterDataProvider>
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden relative">
      {/* Toast Notification */}
      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}

      {/* Mobile Sidebar Overlay */}
      {showSidebar && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Success Modal */}
      <SuccessModal 
        isOpen={successModal.isOpen} 
        title={successModal.title} 
        message={successModal.message} 
        onClose={() => setSuccessModal({ ...successModal, isOpen: false })} 
      />

      {/* Global Export Modal */}
      <GlobalExportModal
        logs={visibleLogs}
        users={allUsers}
        isOpen={showGlobalExport}
        onClose={() => setShowGlobalExport(false)}
        user={currentUser!}
        onSuccess={(msg) => setSuccessModal({ isOpen: true, title: 'Export Berhasil', message: msg })}
      />

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-200 ease-in-out flex flex-col ${
        showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[#143c68] p-2 rounded-lg">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[#143c68]">
              TechLog Pro
            </h1>
          </div>
          <button onClick={() => setShowSidebar(false)} className="lg:hidden p-1 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Profile moved to Sidebar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-[#143c68] flex items-center justify-center font-bold text-white shrink-0">
            {currentUser.name.substring(0, 2).toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-bold text-slate-800 truncate">{currentUser.name}</p>
            <p className="text-[10px] font-bold text-[#143c68] uppercase tracking-wider truncate">{currentUser.role}</p>
            {currentUser.divisi && currentUser.divisi !== '-' && (
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider truncate">Divisi: {currentUser.divisi}</p>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Menu Utama</div>
          {canSeeDashboard && (
            <button
              onClick={() => requestNavigation(() => { setActiveTab('dashboard'); setShowSidebar(false); })}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'dashboard' 
                  ? 'bg-blue-50 text-[#143c68]' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard Summary</span>
            </button>
          )}

          {currentUser.role !== 'karyawan' && (
            <button
              onClick={() => requestNavigation(() => { setActiveTab('resume'); setShowSidebar(false); })}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'resume' 
                  ? 'bg-blue-50 text-[#143c68]' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Resume Daily Activity</span>
            </button>
          )}

          {canSeeInput && (
            <button
              onClick={() => requestNavigation(() => { setActiveTab('list'); setEditingLog(null); setShowSidebar(false); })}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                (activeTab === 'list' || activeTab === 'input')
                  ? 'bg-blue-50 text-[#143c68]' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <ListIcon className="w-4 h-4" />
              <span>{currentUser.role === 'karyawan' ? 'My Day (Logs)' : 'Detail Aktivitas'}</span>
            </button>
          )}

          {currentUser.role !== 'karyawan' && (
            <>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-6 mb-2 ml-2">Laporan & Ekspor</div>
              <button
                onClick={() => requestNavigation(() => { setShowGlobalExport(true); setShowSidebar(false); })}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
              >
                <Download className="w-4 h-4" />
                <span>Export All Reports</span>
              </button>
            </>
          )}

          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-6 mb-2 ml-2">Informasi</div>
          <button
            onClick={() => requestNavigation(() => { setActiveTab('lists'); setShowSidebar(false); })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'lists' 
                ? 'bg-blue-50 text-[#143c68]' 
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Data & Categories</span>
          </button>
          <button
            onClick={() => requestNavigation(() => { setActiveTab('howto'); setShowSidebar(false); })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'howto' 
                ? 'bg-blue-50 text-[#143c68]' 
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileQuestion className="w-4 h-4" />
            <span>How to Use</span>
          </button>

          {currentUser.role === 'admin' && (
            <>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-6 mb-2 ml-2">Admin</div>
              <button
                onClick={() => requestNavigation(() => { setActiveTab('admin'); setShowSidebar(false); })}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'admin' 
                    ? 'bg-blue-50 text-[#143c68]' 
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Admin Panel</span>
              </button>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2">
          {currentUser.role !== 'admin' && (
            <button 
              onClick={() => requestNavigation(() => { setShowBugReport(true); setShowSidebar(false); })} 
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition"
            >
              <Bug className="w-4 h-4" />
              <span>Report Bug</span>
            </button>
          )}
          <button 
            onClick={handleLogout} 
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSidebar(true)} className="p-1 -ml-1 text-slate-600 hover:bg-slate-100 rounded">
              <Menu className="w-6 h-6" />
            </button>
            <h1 className="text-lg font-bold tracking-tight text-[#143c68]">TechLog Pro</h1>
          </div>
          <div className="flex items-center gap-3">
            {currentUser.role !== 'admin' && (
              <button onClick={() => setShowBugReport(true)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition" title="Report Bug">
                <Bug className="w-5 h-5" />
              </button>
            )}
            <div className="h-8 w-8 rounded-full bg-[#143c68] flex items-center justify-center font-bold text-white text-xs">
              {currentUser.name.substring(0, 2).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-hidden flex flex-col relative z-0">
          {logsLoading && (
            <div className="absolute inset-0 z-50 bg-slate-50/80 flex items-center justify-center p-4">
              <div className="flex flex-col items-center gap-4 text-slate-500">
                 <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#143c68] animate-spin" />
                 <p className="font-semibold text-sm">Memuat Data...</p>
              </div>
            </div>
          )}
          {showBugReport && (
            <BugReportModal 
              isOpen={showBugReport} 
              onClose={() => setShowBugReport(false)}
              user={currentUser}
              onSuccess={() => showToast('Bug report berhasil dikirim!')}
            />
          )}

          {pendingNavigation && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 text-center">
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Konfirmasi Keluar</h3>
                  <p className="text-sm text-slate-600 mb-6 whitespace-pre-wrap">Perubahan belum disimpan.{"\n"}Apakah Anda yakin ingin keluar?</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        const action = pendingNavigation;
                        setPendingNavigation(null);
                        setIsFormDirty(false);
                        if (currentDraftId && !editingLog) {
                          deleteDraft(currentDraftId);
                        }
                        action();
                      }}
                      className="flex-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
                    >
                      Keluar
                    </button>
                    <button
                      onClick={() => setPendingNavigation(null)}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
                    >
                      Tetap di Halaman
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {canSeeInput && activeTab === 'list' && (
            <div className="w-full max-w-4xl mx-auto h-full flex flex-col">
              <ActivityList 
                logs={visibleLogs} 
                users={allUsers}
                user={currentUser}
                onNewActivity={handleNewActivity} 
                onEditActivity={handleEditActivity} 
                onDeleteSuccess={handleDeleteSuccess}
                filterStartDate={listStartDate}
                onStartDateChange={setListStartDate}
                filterEndDate={listEndDate}
                onEndDateChange={setListEndDate}
                filterNik={globalNik}
                onNikChange={setGlobalNik}
                filterDivisi={globalDivisi}
                onDivisiChange={setGlobalDivisi}
                onRefreshLogs={refreshLogs}
                onResumeDraft={handleResumeDraft}
              />
            </div>
          )}

          {canSeeInput && activeTab === 'input' && (() => {
            let defaultName = '';
            let defaultNik = '';
            if (currentUser.role !== 'karyawan' && globalNik) {
              const tech = logs.find(l => (l.nik || l.nama_technician.toLowerCase()) === globalNik);
              if (tech) {
                defaultName = tech.nama_technician;
                defaultNik = tech.nik || '';
              } else {
                defaultNik = globalNik;
              }
            }
            return (
            <div className="w-full max-w-2xl mx-auto h-full flex flex-col">
              <InputForm 
                onSuccess={handleInputSuccess} 
                user={currentUser} 
                initialData={editingLog}
                onShowToast={showToast}
                defaultName={defaultName}
                defaultNik={defaultNik}
                isFormDirty={isFormDirty}
                setIsFormDirty={setIsFormDirty}
                onCancel={() => requestNavigation(() => { setActiveTab('list'); setEditingLog(null); })}
                draftId={currentDraftId}
              />
            </div>
            );
          })()}

          {canSeeDashboard && activeTab === 'dashboard' && (
            <div className="w-full h-full flex flex-col overflow-hidden max-w-7xl mx-auto">
              <Dashboard 
                logs={visibleLogs}
                users={allUsers}
                user={currentUser} 
                filterNik={globalNik}
                onNikChange={setGlobalNik}
                filterDate={dashboardDate}
                setFilterDate={setDashboardDate}
                filterDivisi={globalDivisi}
                onDivisiChange={setGlobalDivisi}
              />
            </div>
          )}

          {currentUser.role !== 'karyawan' && activeTab === 'resume' && (
            <div className="w-full h-full flex flex-col overflow-hidden max-w-7xl mx-auto">
              <ResumeTab 
                logs={visibleLogs}
                users={allUsers}
                filterStartDate={resumeStartDate}
                onStartDateChange={setResumeStartDate}
                filterEndDate={resumeEndDate}
                onEndDateChange={setResumeEndDate}
                filterDivisi={globalDivisi}
                onDivisiChange={setGlobalDivisi}
              />
            </div>
          )}

          {activeTab === 'lists' && (
             <InformationScreens type="lists" />
          )}

          {activeTab === 'howto' && (
             <InformationScreens type="howto" />
          )}

          {currentUser.role === 'admin' && activeTab === 'admin' && (
             <AdminPanel
               onRefreshLogs={refreshLogs}
               currentUser={currentUser}
               isSuperAdmin={isSuperAdmin}
               onSuperAdminChange={setIsSuperAdmin}
             />
          )}
        </main>
      </div>
    </div>
    </MasterDataProvider>
  );
}
