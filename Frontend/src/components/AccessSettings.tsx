import React, { useEffect, useState } from 'react';
import { CheckCircle2, IdCard, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  AllowedNik,
  SuperAdminEntry,
  addAllowedNik,
  demoteSuperAdmin,
  fetchAllowedNiks,
  fetchSuperAdmins,
  promoteSuperAdmin,
  removeAllowedNik,
} from '../utils/registrations';
import { ApiError } from '../utils/api';
import { formatWaktu } from '../utils/waktu';
import ConfirmDialog from './ConfirmDialog';

/**
 * Dua kartu tambahan di tab System Settings.
 *
 *   DAFTAR IZIN NIK   jalan masuk untuk atasan dan admin baru. NIK mereka tidak
 *                     ada di tech_logs mana pun -- tidak pernah mengerjakan log
 *                     aktivitas -- jadi tanpa daftar ini mereka tidak akan
 *                     pernah lolos Lapis 1, berapa kali pun mencoba.
 *
 *   SUPER ADMIN       hanya tampil untuk super admin. Ini yang membuat jabatan
 *                     itu bisa diserahkan tanpa menyunting .env di server.
 *
 * Keduanya cuma tampilan; pengamannya ada di server. Menyembunyikan kartu super
 * admin dari admin biasa adalah kerapian, bukan pembatasan -- SuperAdminMiddleware
 * yang menolaknya.
 */
interface AccessSettingsProps {
  isSuperAdmin: boolean;
  currentUserEmail: string;
  /** Dipanggil kalau super admin menurunkan dirinya sendiri. */
  onSuperAdminChange: (masihSuperAdmin: boolean) => void;
}

export default function AccessSettings({
  isSuperAdmin,
  currentUserEmail,
  onSuperAdminChange,
}: AccessSettingsProps) {
  // --- Daftar izin NIK ---
  const [niks, setNiks] = useState<AllowedNik[]>([]);
  const [nikBaru, setNikBaru] = useState('');
  const [catatanBaru, setCatatanBaru] = useState('');
  const [nikError, setNikError] = useState('');
  const [nikPesan, setNikPesan] = useState('');
  const [nikSibuk, setNikSibuk] = useState(false);
  const [nikDihapus, setNikDihapus] = useState<AllowedNik | null>(null);

  // --- Super admin ---
  const [superAdmins, setSuperAdmins] = useState<SuperAdminEntry[]>([]);
  const [emailBaru, setEmailBaru] = useState('');
  const [saError, setSaError] = useState('');
  const [saPesan, setSaPesan] = useState('');
  const [saSibuk, setSaSibuk] = useState(false);
  const [saDiturunkan, setSaDiturunkan] = useState<SuperAdminEntry | null>(null);

  const muatNiks = async () => {
    try {
      setNiks(await fetchAllowedNiks());
    } catch (e: any) {
      setNikError(e?.message || 'Gagal mengambil daftar izin NIK.');
    }
  };

  const muatSuperAdmins = async () => {
    try {
      setSuperAdmins(await fetchSuperAdmins());
    } catch (e: any) {
      setSaError(e?.message || 'Gagal mengambil daftar super admin.');
    }
  };

  useEffect(() => {
    muatNiks();
    if (isSuperAdmin) muatSuperAdmins();
  }, [isSuperAdmin]);

  /**
   * Perbarui daftar setelah pengangkatan atau penurunan, dan kabarkan kalau
   * pemakai layar ini sendiri yang barusan turun.
   *
   * Backend mengizinkan super admin menurunkan dirinya sendiri selama masih ada
   * yang lain. Kalau itu terjadi, kartu ini harus langsung hilang -- bukan
   * bertahan sampai halaman dimuat ulang lalu semua tombolnya dijawab 403.
   *
   * Daftarnya diambil ulang, bukan memakai jawaban promote/demote apa adanya:
   * jawaban itu tidak memuat nama dan penanda "sudah pernah login" -- keduanya
   * hanya dirakit endpoint daftar. Tanpa pengambilan ulang, seluruh kolom Nama
   * berubah jadi "belum pernah login" setiap kali ada yang diangkat.
   *
   * @return apakah pemakai layar ini masih super admin
   */
  const perbaruiDaftarSuperAdmin = async (daftar: SuperAdminEntry[]): Promise<boolean> => {
    const saya = currentUserEmail.trim().toLowerCase();
    const masih = daftar.some((e) => e.email.toLowerCase() === saya);

    setSuperAdmins(daftar);
    onSuperAdminChange(masih);

    // Kalau sudah bukan super admin, endpoint daftarnya pun akan menjawab 403.
    if (masih) {
      try {
        setSuperAdmins(await fetchSuperAdmins());
      } catch (e) {
        console.error('Gagal menyegarkan daftar super admin', e);
      }
    }

    return masih;
  };

  const handleTambahNik = async (e: React.FormEvent) => {
    e.preventDefault();
    setNikError('');
    setNikPesan('');

    if (nikBaru.trim() === '') {
      setNikError('NIK wajib diisi.');
      return;
    }

    setNikSibuk(true);

    try {
      const hasil = await addAllowedNik(nikBaru.trim(), catatanBaru);
      setNikPesan(hasil.message || 'NIK ditambahkan ke daftar izin.');
      setNikBaru('');
      setCatatanBaru('');
      await muatNiks();
    } catch (err: any) {
      // 409 kalau NIK-nya sudah ada di daftar atau sudah dipakai user aktif.
      // Pesan servernya menyebut siapa pemiliknya; yang membaca sudah pasti
      // admin, jadi tidak ada yang bocor.
      setNikError(err instanceof ApiError ? (err.field('nik') || err.message) : (err?.message || 'Gagal menambah NIK.'));
    } finally {
      setNikSibuk(false);
    }
  };

  const handleHapusNik = async () => {
    if (!nikDihapus) return;

    setNikError('');
    setNikPesan('');
    setNikSibuk(true);

    try {
      const hasil = await removeAllowedNik(nikDihapus.nik);
      setNikPesan(hasil.message || 'NIK dikeluarkan dari daftar izin.');
      setNikDihapus(null);
      await muatNiks();
    } catch (err: any) {
      setNikError(err?.message || 'Gagal menghapus NIK.');
      setNikDihapus(null);
    } finally {
      setNikSibuk(false);
    }
  };

  const handleAngkat = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaError('');
    setSaPesan('');

    if (emailBaru.trim() === '') {
      setSaError('Email wajib diisi.');
      return;
    }

    setSaSibuk(true);

    try {
      const hasil = await promoteSuperAdmin(emailBaru);
      setSaPesan(hasil.message || 'Super admin baru diangkat.');
      setEmailBaru('');
      await perbaruiDaftarSuperAdmin(hasil.data ?? []);
    } catch (err: any) {
      setSaError(err?.message || 'Gagal mengangkat super admin.');
    } finally {
      setSaSibuk(false);
    }
  };

  const handleTurunkan = async () => {
    if (!saDiturunkan) return;

    setSaError('');
    setSaPesan('');
    setSaSibuk(true);

    try {
      const hasil = await demoteSuperAdmin(saDiturunkan.email);
      const masih = await perbaruiDaftarSuperAdmin(hasil.data ?? []);

      // Kalau yang barusan turun adalah dirinya sendiri, kartu ini ikut hilang
      // -- termasuk tempat pesannya ditampilkan. Alert supaya tindakannya tidak
      // berakhir tanpa jawaban apa pun.
      if (masih) {
        setSaPesan(hasil.message || 'Super admin diturunkan.');
      } else {
        alert(hasil.message || 'Anda tidak lagi menjadi super admin. Hak admin biasa Anda tidak berubah.');
      }

      setSaDiturunkan(null);
    } catch (err: any) {
      setSaError(err?.message || 'Gagal menurunkan super admin.');
      setSaDiturunkan(null);
    } finally {
      setSaSibuk(false);
    }
  };

  const menurunkanDiriSendiri =
    saDiturunkan !== null
    && saDiturunkan.email.toLowerCase() === currentUserEmail.trim().toLowerCase();

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Daftar izin NIK                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 max-w-3xl mb-6">
        <h4 className="font-bold text-slate-800 flex items-center gap-2">
          <IdCard className="w-5 h-5 text-[#143c68]" />
          Daftar Izin NIK
        </h4>
        <p className="text-slate-600 text-sm mt-1 mb-4">
          Saat mendaftar, NIK harus sudah dikenal sistem — biasanya karena pernah muncul di log
          aktivitas. Atasan dan admin baru tidak punya jejak itu, jadi NIK mereka harus dimasukkan
          ke sini lebih dulu. Yang diberikan hanya izin <em>mendaftar</em>; pendaftarannya tetap
          masuk antrean persetujuan seperti yang lain.
        </p>

        <form onSubmit={handleTambahNik} className="flex flex-wrap gap-2 items-start mb-4">
          <input
            type="text"
            value={nikBaru}
            onChange={(e) => { setNikBaru(e.target.value); if (nikError) setNikError(''); }}
            placeholder="NIK"
            maxLength={50}
            disabled={nikSibuk}
            className="px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm w-40 disabled:opacity-50"
          />
          <input
            type="text"
            value={catatanBaru}
            onChange={(e) => setCatatanBaru(e.target.value)}
            placeholder="Catatan, misalnya: atasan baru divisi Produksi"
            maxLength={255}
            disabled={nikSibuk}
            className="flex-1 min-w-[12rem] px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={nikSibuk}
            className="px-4 py-2 bg-[#143c68] text-white rounded-md font-bold text-sm hover:bg-[#1a4f8a] flex items-center gap-2 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Tambah
          </button>
        </form>

        {nikError && (
          <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100 mb-4">{nikError}</div>
        )}
        {nikPesan && (
          <div className="text-sm text-emerald-800 bg-emerald-50 p-3 rounded border border-emerald-100 mb-4 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{nikPesan}</span>
          </div>
        )}

        <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#143c68] text-white">
              <tr>
                <th className="px-4 py-2 font-semibold">NIK</th>
                <th className="px-4 py-2 font-semibold">Catatan</th>
                <th className="px-4 py-2 font-semibold">Ditambahkan</th>
                <th className="px-4 py-2 font-semibold text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {niks.map((n) => (
                <tr key={n.nik} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-800">{n.nik}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {n.note || <span className="text-slate-400">-</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                    {formatWaktu(n.added_at)}
                    {n.added_by_email && <span className="block">oleh {n.added_by_email}</span>}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => { setNikPesan(''); setNikError(''); setNikDihapus(n); }}
                      disabled={nikSibuk}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                      title="Keluarkan dari daftar izin"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {niks.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    Belum ada NIK yang diizinkan secara khusus.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Super admin                                                       */}
      {/* ---------------------------------------------------------------- */}
      {isSuperAdmin && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 max-w-3xl mb-6">
          <h4 className="font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#143c68]" />
            Kelola Super Admin
          </h4>
          <p className="text-slate-600 text-sm mt-1 mb-4">
            Super admin selalu bisa masuk, apa pun aturan pendaftarannya, dan hanya sesama super
            admin yang bisa mengangkat atau menurunkannya. Alamat yang berasal dari
            <code className="mx-1 px-1 py-0.5 bg-slate-200 rounded text-xs">.env</code> di server
            sengaja tidak bisa diturunkan dari sini — itu jalan pulang terakhir kalau ada yang
            salah. Alamat yang belum punya akun boleh diangkat; itu justru cara menyiapkan penerus
            sebelum orangnya pernah login.
          </p>

          <form onSubmit={handleAngkat} className="flex flex-wrap gap-2 items-start mb-4">
            <input
              type="email"
              value={emailBaru}
              onChange={(e) => { setEmailBaru(e.target.value); if (saError) setSaError(''); }}
              placeholder="alamat@perusahaan.com"
              maxLength={255}
              disabled={saSibuk}
              className="flex-1 min-w-[14rem] px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={saSibuk}
              className="px-4 py-2 bg-[#143c68] text-white rounded-md font-bold text-sm hover:bg-[#1a4f8a] flex items-center gap-2 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Angkat
            </button>
          </form>

          {saError && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100 mb-4">{saError}</div>
          )}
          {saPesan && (
            <div className="text-sm text-emerald-800 bg-emerald-50 p-3 rounded border border-emerald-100 mb-4 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{saPesan}</span>
            </div>
          )}

          <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#143c68] text-white">
                <tr>
                  <th className="px-4 py-2 font-semibold">Email</th>
                  <th className="px-4 py-2 font-semibold">Nama</th>
                  <th className="px-4 py-2 font-semibold">Asal</th>
                  <th className="px-4 py-2 font-semibold text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {superAdmins.map((s) => (
                  <tr key={s.email} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-800 break-all">{s.email}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {s.registered
                        ? s.name
                        : <span className="text-amber-600">belum pernah login</span>}
                    </td>
                    <td className="px-4 py-2">
                      {s.source === 'env' ? (
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700">
                          .env
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-[#143c68]">
                          diangkat {formatWaktu(s.promoted_at)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {/* Tombolnya dinonaktifkan, bukan disembunyikan: admin
                          perlu tahu alamat itu ADA dan kenapa tidak bisa
                          disentuh dari sini. */}
                      <button
                        onClick={() => { setSaPesan(''); setSaError(''); setSaDiturunkan(s); }}
                        disabled={saSibuk || !s.removable}
                        title={s.removable ? 'Turunkan dari super admin' : 'Berasal dari .env di server, hapus di sana kalau memang harus dicabut'}
                        className={`p-1.5 rounded ${s.removable ? 'text-red-600 hover:bg-red-50 disabled:opacity-50' : 'text-slate-300 cursor-not-allowed'}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {superAdmins.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      Daftar super admin kosong. Periksa SUPER_ADMIN_EMAILS di .env server.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {nikDihapus && (
        <ConfirmDialog
          title="Keluarkan dari Daftar Izin"
          icon={<Trash2 className="w-8 h-8" />}
          confirmLabel="Ya, Keluarkan"
          busy={nikSibuk}
          onCancel={() => setNikDihapus(null)}
          onConfirm={handleHapusNik}
          message={
            <>
              NIK <strong>{nikDihapus.nik}</strong> tidak lagi boleh dipakai mendaftar. User yang
              terlanjur mendaftar dengan NIK ini dan sudah disetujui tidak terpengaruh.
            </>
          }
        />
      )}

      {saDiturunkan && (
        <ConfirmDialog
          title="Turunkan Super Admin"
          icon={<ShieldCheck className="w-8 h-8" />}
          confirmLabel="Ya, Turunkan"
          busy={saSibuk}
          onCancel={() => setSaDiturunkan(null)}
          onConfirm={handleTurunkan}
          message={
            menurunkanDiriSendiri ? (
              <>
                Anda akan menurunkan <strong>diri Anda sendiri</strong> ({saDiturunkan.email}). Hak
                admin biasa Anda tidak berubah, tapi Anda tidak akan bisa mengangkat atau menurunkan
                super admin lagi — termasuk mengangkat diri sendiri kembali.
              </>
            ) : (
              <>
                <strong>{saDiturunkan.email}</strong> tidak lagi menjadi super admin. Role-nya di
                tabel user tidak berubah, jadi kalau dia seorang admin, dia tetap admin.
              </>
            )
          }
        />
      )}
    </>
  );
}
