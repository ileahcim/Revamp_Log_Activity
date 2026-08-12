import React, { useState } from 'react';
import { User, addAuditLog, registerProfile, syncSession } from '../utils/auth';
import { Division, fetchDivisions } from '../utils/master';
import { ApiError } from '../utils/api';
import { Lock, Mail, ChevronLeft, User as UserIcon, LogIn } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../utils/firebase';

interface LoginProps {
  onLogin: (user: User) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [view, setView] = useState<'login' | 'register'>('login');

  // Registration Form State
  const [regEmail, setRegEmail] = useState('');
  const [regName, setRegName] = useState('');
  const [regNik, setRegNik] = useState('');
  const [regDivisi, setRegDivisi] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [error, setError] = useState('');
  const [nikError, setNikError] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * Login tetap lewat Firebase; yang berubah hanya apa yang terjadi setelahnya.
   *
   * Dulu: baca sendiri dokumen users di Firestore, dan naikkan role jadi admin
   * dari sisi browser kalau emailnya cocok. Sekarang keduanya dikerjakan
   * /api/auth/sync di server, berdasarkan SUPER_ADMIN_EMAIL di .env -- kode
   * yang berjalan di browser tidak bisa dipercaya untuk memberi hak akses.
   */
  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);

      const sesi = await syncSession();

      if (sesi.registered && sesi.user) {
        addAuditLog(sesi.user, 'Login/Sync');
        onLogin(sesi.user);
        return;
      }

      // Belum terdaftar. Daftar divisi diambil sekarang, sebelum pindah layar,
      // supaya dropdownnya tidak sempat terlihat kosong.
      const daftarDivisi = await fetchDivisions();

      if (daftarDivisi.length === 0) {
        setError('Daftar divisi kosong di database, jadi profil belum bisa dibuat. Hubungi admin.');
        return;
      }

      setDivisions(daftarDivisi);
      // Mempertahankan pilihan awal yang selama ini terpasang. Kalau divisi itu
      // dihapus atau diganti nama di database, jatuh ke pilihan pertama.
      setRegDivisi(daftarDivisi.some(d => d.name === 'Mekanik') ? 'Mekanik' : daftarDivisi[0].name);
      setRegEmail(sesi.prefill?.email || '');
      setRegName(sesi.prefill?.name || '');
      setNikError('');
      setView('register');
    } catch (e: any) {
      setError(e?.message || 'Gagal login via Google.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNikError('');

    if (!regName.trim() || !regNik.trim()) {
      setError('Nama dan NIK wajib diisi.');
      return;
    }

    setLoading(true);
    try {
      // id, email, dan role tidak dikirim: ketiganya diambil server dari token.
      const newUser = await registerProfile({
        name: regName.trim(),
        nik: regNik.trim(),
        divisi: regDivisi,
      });

      addAuditLog(newUser, 'Login/Sync');
      onLogin(newUser);
    } catch (e: any) {
      if (e instanceof ApiError) {
        // NIK yang sudah dipakai user lain dijawab 422 dengan errors.nik.
        // Yang ringkas ditempel di bawah input supaya jelas field mana yang
        // salah; penjelasan panjangnya tetap di kotak atas. Isian form sengaja
        // tidak dikosongkan -- yang perlu diperbaiki cuma NIK-nya.
        setNikError(e.field('nik') || '');
        setError(e.message);
      } else {
        setError('Gagal menyimpan profil: ' + (e?.message || 'kesalahan tidak dikenal'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (view === 'register') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-sm">
          <button 
            onClick={() => setView('login')}
            className="flex items-center text-sm text-slate-500 hover:text-slate-800 mb-6 disabled:opacity-50"
            disabled={loading}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Batal
          </button>
          
          <div className="flex justify-center mb-4">
            <div className="bg-emerald-100 p-3 rounded-full text-emerald-600">
              <UserIcon className="w-8 h-8" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">Lengkapi Profil</h2>
          <p className="text-center text-slate-500 mb-6 text-sm">Masukan data diri untuk pertama kalinya</p>
          
          {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">{error}</div>}

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input 
                type="email" 
                value={regEmail}
                disabled
                className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nama Lengkap</label>
              <input 
                type="text" 
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#143c68] outline-none transition" 
                placeholder="Masukkan nama sesuai ID"
                required
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">NIK</label>
              <input
                type="text"
                value={regNik}
                onChange={(e) => { setRegNik(e.target.value); if (nikError) setNikError(''); }}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#143c68] outline-none transition"
                placeholder="Contoh: TS-1234"
                required
                disabled={loading}
              />
              {nikError && <p className="mt-1 text-sm text-red-600">{nikError}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Divisi</label>
              <select 
                value={regDivisi}
                onChange={(e) => setRegDivisi(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#143c68] outline-none transition bg-white"
                disabled={loading}
              >
                {/* Dulu daftar ini ditulis tetap di sini. Sekarang dari
                    /api/master/divisions, jadi divisi yang ditambah atau
                    dinonaktifkan di database langsung terlihat di form ini. */}
                {divisions.map(d => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            
            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-[#143c68] text-white font-bold py-2.5 rounded-lg hover:bg-[#1a4f8a] transition flex items-center justify-center gap-2 mt-4 disabled:opacity-50"
            >
              {loading ? 'Menyimpan...' : <><LogIn className="w-4 h-4" /> Daftar & Masuk</>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="bg-indigo-100 p-3 rounded-full text-indigo-600">
            <Lock className="w-8 h-8" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">TechLog Pro</h2>
        <p className="text-center text-slate-500 mb-8 text-sm">Masuk melalui Akun Google untuk melanjutkan</p>
        
        {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">{error}</div>}

        <button 
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-white border border-slate-300 text-slate-700 font-bold py-2.5 px-4 rounded-lg hover:bg-slate-50 transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
        >
          <Mail className="w-5 h-5 text-rose-500" />
          {loading ? 'Memproses...' : 'Masuk dengan Akun Google'}
        </button>
        
      </div>
    </div>
  );
}
