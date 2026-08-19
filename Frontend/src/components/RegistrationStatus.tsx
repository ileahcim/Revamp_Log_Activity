import React, { useState } from 'react';
import { Hourglass, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { RegistrationInfo, User, getStatus } from '../utils/auth';
import { formatWaktu } from '../utils/waktu';

/**
 * Layar untuk akun yang sudah mendaftar tapi belum boleh masuk.
 *
 * Dua keadaan, satu layar: menunggu persetujuan dan ditolak. Keduanya sama-sama
 * TIDAK punya baris di tabel users, jadi tidak ada satu pun endpoint lain yang
 * bisa dipanggil dari sini -- semuanya menjawab 403. Karena itu layar ini berdiri
 * sendiri di depan aplikasi, bukan sebuah tab di dalamnya: memuat dashboard lalu
 * gagal sepotong-sepotong jauh lebih membingungkan.
 *
 * Satu-satunya yang boleh dipanggil adalah GET /api/auth/status, dan itu pun
 * hanya kalau tombolnya ditekan. Tidak ada polling otomatis: persetujuan bisa
 * makan waktu berhari-hari, dan menanyakannya tiap beberapa detik hanya
 * membebani hosting bersama tanpa mempercepat apa pun.
 */
interface RegistrationStatusProps {
  status: 'pending' | 'rejected';
  registration: RegistrationInfo | null;
  /** Sudah disetujui -- lanjut masuk aplikasi. */
  onActive: (user: User, isSuperAdmin: boolean) => void;
  /** Penolakannya dibatalkan admin; yang bersangkutan boleh mendaftar lagi. */
  onUnregistered: () => void;
  onLogout: () => void;
}

export default function RegistrationStatus({
  status: statusAwal,
  registration: registrasiAwal,
  onActive,
  onUnregistered,
  onLogout,
}: RegistrationStatusProps) {
  // Disalin ke state karena tombol "Periksa lagi" bisa mengubahnya: permintaan
  // yang tadinya menunggu bisa saja sudah ditolak sejak layar ini dibuka.
  const [status, setStatus] = useState<'pending' | 'rejected'>(statusAwal);
  const [registrasi, setRegistrasi] = useState<RegistrationInfo | null>(registrasiAwal);

  const [memeriksa, setMemeriksa] = useState(false);
  const [error, setError] = useState('');
  const [diperiksaPada, setDiperiksaPada] = useState<string | null>(null);

  const periksaLagi = async () => {
    setError('');
    setMemeriksa(true);

    try {
      const sesi = await getStatus();

      if (sesi.status === 'active' && sesi.user) {
        onActive(sesi.user, sesi.isSuperAdmin);
        return;
      }

      // Admin membatalkan penolakannya. Kembali ke layar login supaya formulir
      // pendaftaran bisa diisi lagi.
      if (sesi.status === 'unregistered') {
        onUnregistered();
        return;
      }

      setStatus(sesi.status);
      setRegistrasi(sesi.registration);
      setDiperiksaPada(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message || 'Gagal memeriksa status pendaftaran.');
    } finally {
      setMemeriksa(false);
    }
  };

  const ditolak = status === 'rejected';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-md">
        <div className="flex justify-center mb-4">
          <div className={`p-3 rounded-full ${ditolak ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
            {ditolak ? <ShieldAlert className="w-8 h-8" /> : <Hourglass className="w-8 h-8" />}
          </div>
        </div>

        <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">
          {ditolak ? 'Pendaftaran Ditolak' : 'Menunggu Persetujuan'}
        </h2>
        <p className="text-center text-slate-500 mb-6 text-sm">
          {ditolak
            ? 'Hubungi admin bila menurut Anda ini keliru.'
            : 'Pendaftaran Anda sudah terkirim. Admin akan memeriksanya terlebih dahulu.'}
        </p>

        {registrasi && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Nama</span>
              <span className="font-medium text-slate-800 text-right break-words">{registrasi.name || '-'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">NIK</span>
              <span className="font-medium text-slate-800 text-right break-words">{registrasi.nik || '-'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Divisi</span>
              <span className="font-medium text-slate-800 text-right break-words">{registrasi.divisi || '-'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Email</span>
              <span className="font-medium text-slate-800 text-right break-all">{registrasi.email || '-'}</span>
            </div>
            <div className="flex justify-between gap-4 pt-2 border-t border-slate-200">
              <span className="text-slate-500">{ditolak ? 'Ditolak pada' : 'Didaftarkan pada'}</span>
              <span className="font-medium text-slate-800 text-right">
                {formatWaktu(ditolak ? registrasi.rejected_at : registrasi.requested_at)}
              </span>
            </div>
          </div>
        )}

        {ditolak && registrasi?.reason && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 p-3 rounded border border-red-100">
            <span className="font-bold block mb-1">Alasan</span>
            <span className="whitespace-pre-wrap">{registrasi.reason}</span>
          </div>
        )}

        {ditolak && !registrasi?.reason && (
          <div className="mb-4 text-sm text-slate-600 bg-slate-50 p-3 rounded border border-slate-200">
            Admin tidak menuliskan alasannya.
          </div>
        )}

        {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">{error}</div>}

        {diperiksaPada && !error && (
          <div className="mb-4 text-sm text-slate-600 bg-slate-50 p-3 rounded border border-slate-200">
            Belum ada perubahan per {formatWaktu(diperiksaPada)}.
            {!ditolak && ' Anda tidak perlu menunggu di halaman ini — tutup saja, dan coba masuk lagi nanti.'}
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={periksaLagi}
            disabled={memeriksa}
            className="w-full bg-[#143c68] text-white font-bold py-2.5 rounded-lg hover:bg-[#1a4f8a] transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${memeriksa ? 'animate-spin' : ''}`} />
            {memeriksa ? 'Memeriksa...' : 'Periksa lagi'}
          </button>
          <button
            onClick={onLogout}
            disabled={memeriksa}
            className="w-full bg-white border border-slate-300 text-slate-700 font-bold py-2.5 rounded-lg hover:bg-slate-50 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" /> Keluar
          </button>
        </div>
      </div>
    </div>
  );
}
