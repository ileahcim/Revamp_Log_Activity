import React, { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldAlert, TriangleAlert, Undo2, UserCheck, UserX, Users } from 'lucide-react';
import {
  NikCheck,
  RegistrationQueue,
  RegistrationRequest,
  approveRegistration,
  fetchRegistrations,
  forgetRegistration,
  rejectRegistration,
} from '../utils/registrations';
import { formatWaktu } from '../utils/waktu';
import ConfirmDialog from './ConfirmDialog';

/**
 * Tab "Persetujuan" di AdminPanel.
 *
 * Sejak pendaftaran dibatasi, akun Google yang lolos pemeriksaan NIK tidak
 * langsung punya baris di tabel users -- permintaannya masuk antrean di sini
 * dulu. Selama menunggu, yang bersangkutan tidak bisa memanggil satu endpoint
 * pun; daftar di halaman ini adalah satu-satunya jalan masuknya.
 *
 * Karena itu jumlah antrean juga ditampilkan sebagai penanda di judul tab.
 * Tanpa itu tidak ada yang tahu ada orang menunggu, dan orangnya tidak punya
 * cara lain untuk mengingatkan.
 */
interface ApprovalQueueProps {
  /** Menyegarkan penanda jumlah di judul tab. */
  onPendingCountChange: (jumlah: number) => void;
  /** Dipanggil setelah ada yang disetujui, supaya tabel User Management ikut segar. */
  onApproved: () => void;
}

type Role = 'karyawan' | 'atasan' | 'admin';

/**
 * Penanda NIK pada satu baris antrean. Tidak menampilkan apa-apa kalau NIK-nya
 * bersih -- yang bersih adalah keadaan normal, dan menandainya hanya membuat
 * yang bermasalah lebih sulit terlihat.
 *
 * Ada karena Lapis 1 (REGISTRATION_REQUIRE_KNOWN_NIK) dimatikan: NIK apa pun
 * yang belum terpakai sekarang bisa masuk antrean, termasuk salah ketik dan
 * termasuk NIK milik teknisi lama yang belum pernah login. Yang dulu disaring
 * server sekarang disaring mata admin di halaman ini.
 *
 * Ketiganya bisa muncul bersamaan dan urutannya dari yang paling menentukan:
 *
 *   merah    NIK sudah dipakai user aktif. Menyetujuinya akan gagal --
 *            users.nik UNIQUE -- jadi ini praktis selalu berarti tolak.
 *   kuning   NIK kembar dengan pendaftar lain di antrean yang sama. Yang
 *            disetujui duluan menang, yang kedua gagal.
 *   abu-abu  Tidak ada jejaknya di tech_logs maupun daftar izin NIK. Persis
 *            yang dulu ditolak Lapis 1. Bukan kesalahan dengan sendirinya --
 *            karyawan yang benar-benar baru memang belum punya jejak.
 *
 * Semuanya berhenti di sini, di layar admin. Pendaftarnya sendiri tidak pernah
 * diberi tahu apa pun tentang ini; balasan untuknya tetap kalimat netral yang
 * sama. Kalau tidak, formulir pendaftaran berubah jadi alat menebak dan
 * memanen NIK karyawan satu per satu.
 */
function PenandaNik({ check }: { check?: NikCheck }) {
  if (!check) return null;

  const { taken_by: dipakai, queued_by: kembar, known: dikenal } = check;

  if (!dipakai && kembar.length === 0 && dikenal) return null;

  const dasar =
    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-bold leading-tight';

  return (
    <div className="mt-1.5 flex flex-col gap-1 items-start font-sans">
      {dipakai && (
        <span
          className={`${dasar} bg-red-100 text-red-700 border-red-200`}
          title={`${dipakai.email} — menyetujui pendaftaran ini akan gagal, NIK harus unik.`}
        >
          <ShieldAlert className="w-3 h-3 shrink-0" />
          NIK sudah dipakai &middot; {dipakai.name} ({dipakai.role})
        </span>
      )}

      {kembar.length > 0 && (
        <span
          className={`${dasar} bg-amber-100 text-amber-800 border-amber-200`}
          title={kembar.map((o) => `${o.name} (${o.email})`).join(', ')}
        >
          <Users className="w-3 h-3 shrink-0" />
          NIK kembar di antrean &middot; {kembar[0].name}
          {kembar.length > 1 && ` +${kembar.length - 1} lagi`}
        </span>
      )}

      {!dikenal && (
        <span
          className={`${dasar} bg-slate-100 text-slate-600 border-slate-200`}
          title="Tidak ada di tech_logs maupun daftar izin NIK. Wajar untuk karyawan yang benar-benar baru; curigai kalau bukan."
        >
          <TriangleAlert className="w-3 h-3 shrink-0" />
          NIK tanpa jejak di sistem
        </span>
      )}
    </div>
  );
}

export default function ApprovalQueue({ onPendingCountChange, onApproved }: ApprovalQueueProps) {
  const [queue, setQueue] = useState<RegistrationQueue>('pending');
  const [rows, setRows] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pesan, setPesan] = useState('');

  // Baris yang sedang dikonfirmasi. Satu per satu; menyetujui orang bukan aksi
  // yang pantas terjadi karena salah klik.
  const [menyetujui, setMenyetujui] = useState<RegistrationRequest | null>(null);
  const [role, setRole] = useState<Role>('karyawan');
  const [menolak, setMenolak] = useState<RegistrationRequest | null>(null);
  const [alasan, setAlasan] = useState('');
  const [membuka, setMembuka] = useState<RegistrationRequest | null>(null);
  const [mengirim, setMengirim] = useState(false);

  const muat = async (target: RegistrationQueue = queue) => {
    setLoading(true);
    setError('');

    try {
      const daftar = await fetchRegistrations(target);
      setRows(daftar);

      // Penanda di judul tab hanya menghitung yang menunggu. Membuka daftar
      // "ditolak" tidak boleh membuat penandanya hilang.
      if (target === 'pending') onPendingCountChange(daftar.length);
    } catch (e: any) {
      setRows([]);
      setError(e?.message || 'Gagal mengambil daftar pendaftaran.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    muat(queue);
  }, [queue]);

  /** Satu tempat penanganan hasil, supaya peringatan audit tidak pernah tertelan. */
  const jalankan = async (aksi: () => Promise<{ message: string | null }>, bawaan: string) => {
    setMengirim(true);
    setError('');
    setPesan('');

    try {
      const hasil = await aksi();

      // Pesan dari server bisa memuat peringatan bahwa audit log gagal ditulis.
      setPesan(hasil.message || bawaan);
      await muat(queue);

      return true;
    } catch (e: any) {
      setError(e?.message || 'Gagal menjalankan tindakan.');
      return false;
    } finally {
      setMengirim(false);
    }
  };

  const handleApprove = async () => {
    if (!menyetujui) return;

    const uid = menyetujui.uid;
    const berhasil = await jalankan(() => approveRegistration(uid, role), 'Pendaftaran disetujui.');

    if (berhasil) {
      setMenyetujui(null);
      onApproved();
    }
  };

  const handleReject = async () => {
    if (!menolak) return;

    const uid = menolak.uid;

    if (await jalankan(() => rejectRegistration(uid, alasan), 'Pendaftaran ditolak.')) {
      setMenolak(null);
      setAlasan('');
    }
  };

  const handleForget = async () => {
    if (!membuka) return;

    const uid = membuka.uid;

    // Ditutup apa pun hasilnya: tidak ada isian yang perlu diselamatkan, dan
    // pesan kegagalannya ada di belakang kotak ini.
    await jalankan(() => forgetRegistration(uid), 'Yang bersangkutan boleh mendaftar lagi.');
    setMembuka(null);
  };

  const menunggu = queue === 'pending';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-bold text-slate-700">Daftar:</label>
          <select
            value={queue}
            onChange={(e) => { setPesan(''); setQueue(e.target.value as RegistrationQueue); }}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none"
          >
            <option value="pending">Menunggu Persetujuan</option>
            <option value="rejected">Pernah Ditolak</option>
          </select>
        </div>

        <button
          onClick={() => muat(queue)}
          disabled={loading}
          className="px-3 py-1.5 text-sm font-bold border border-slate-300 bg-white rounded-md text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
        </button>

        <div className="ml-auto text-sm font-bold text-[#143c68]">
          Total: {rows.length} pendaftaran
        </div>
      </div>

      {(pesan || error) && (
        <div className="px-4 pt-4 shrink-0">
          {pesan && (
            <div className="text-sm text-emerald-800 bg-emerald-50 p-3 rounded border border-emerald-100 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{pesan}</span>
            </div>
          )}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100 mt-2">{error}</div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#143c68] text-white sticky top-0">
            <tr>
              <th className="px-4 py-3 font-semibold">{menunggu ? 'Didaftarkan' : 'Ditolak'}</th>
              <th className="px-4 py-3 font-semibold">Nama Lengkap</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">NIK</th>
              <th className="px-4 py-3 font-semibold">Divisi</th>
              {!menunggu && <th className="px-4 py-3 font-semibold">Alasan</th>}
              <th className="px-4 py-3 font-semibold text-center">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {rows.map((r) => (
              <tr key={r.uid} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap align-top">
                  {formatWaktu(menunggu ? r.requested_at : r.rejected_at)}
                </td>
                <td className="px-4 py-3 font-medium text-slate-800 align-top">{r.name}</td>
                <td className="px-4 py-3 text-slate-600 align-top">{r.email}</td>
                <td className="px-4 py-3 text-slate-600 align-top">
                  <span className="font-mono">{r.nik}</span>
                  <PenandaNik check={r.nik_check} />
                </td>
                <td className="px-4 py-3 text-slate-600 align-top">{r.divisi}</td>
                {!menunggu && (
                  <td className="px-4 py-3 text-slate-600 align-top">
                    {r.reason || <span className="text-slate-400">tidak disebutkan</span>}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-center items-center">
                    {menunggu ? (
                      <>
                        <button
                          onClick={() => { setPesan(''); setError(''); setRole('karyawan'); setMenyetujui(r); }}
                          className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-bold hover:bg-emerald-700 flex items-center gap-1"
                        >
                          <UserCheck className="w-3.5 h-3.5" /> Setujui
                        </button>
                        <button
                          onClick={() => { setPesan(''); setError(''); setAlasan(''); setMenolak(r); }}
                          className="px-3 py-1 bg-white border border-red-300 text-red-600 rounded text-xs font-bold hover:bg-red-50 flex items-center gap-1"
                        >
                          <UserX className="w-3.5 h-3.5" /> Tolak
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setPesan(''); setError(''); setMembuka(r); }}
                        disabled={mengirim}
                        className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded text-xs font-bold hover:bg-slate-50 flex items-center gap-1 disabled:opacity-50"
                      >
                        <Undo2 className="w-3.5 h-3.5" /> Boleh Daftar Lagi
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={menunggu ? 6 : 7} className="px-4 py-8 text-center text-slate-400">
                  {loading
                    ? 'Memuat...'
                    : menunggu
                      ? 'Tidak ada pendaftaran yang menunggu.'
                      : 'Belum ada pendaftaran yang ditolak.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {menyetujui && (
        <div className="fixed inset-0 min-h-screen flex items-center justify-center bg-black/60 z-[100] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 relative">
            <div className="flex items-center gap-3 mb-4 text-emerald-600">
              <UserCheck className="w-8 h-8" />
              <h3 className="text-xl font-bold text-slate-800">Setujui Pendaftaran</h3>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 text-sm space-y-1">
              <p className="font-bold text-slate-800">{menyetujui.name}</p>
              <p className="text-slate-600">{menyetujui.email}</p>
              <p className="text-slate-600">NIK {menyetujui.nik} &middot; Divisi {menyetujui.divisi}</p>

              {/* Diulang di sini, bukan hanya di barisnya. Inilah detik
                  terakhir sebelum orangnya punya baris users, dan tombol
                  hijau di bawah gampang ditekan tanpa membaca ulang. */}
              <PenandaNik check={menyetujui.nik_check} />
            </div>

            <label className="block text-sm font-bold text-slate-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={mengirim}
              className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm"
            >
              <option value="karyawan">Karyawan</option>
              <option value="atasan">Atasan</option>
              <option value="admin">Admin</option>
            </select>
            <p className="text-xs text-slate-500 mt-2">
              Role bisa diubah kapan saja lewat tab User Management. Pilih di sini supaya atasan baru
              tidak perlu disetujui dulu sebagai karyawan.
            </p>

            {/* Ditampilkan di dalam kotak, bukan hanya di belakangnya. Server
                memeriksa ulang semuanya saat menyetujui, jadi penolakan di sini
                wajar: NIK-nya bisa saja sudah dipakai orang lain sejak dia
                mendaftar, atau divisinya sudah dinonaktifkan. */}
            {error && (
              <div className="mt-4 text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">{error}</div>
            )}

            <div className="pt-5 flex gap-3">
              <button
                onClick={() => setMenyetujui(null)}
                disabled={mengirim}
                className="flex-1 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleApprove}
                disabled={mengirim}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {mengirim ? 'Memproses...' : 'Ya, Setujui'}
              </button>
            </div>
          </div>
        </div>
      )}

      {menolak && (
        <div className="fixed inset-0 min-h-screen flex items-center justify-center bg-black/60 z-[100] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 relative">
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <UserX className="w-8 h-8" />
              <h3 className="text-xl font-bold text-slate-800">Tolak Pendaftaran</h3>
            </div>

            <p className="text-slate-600 text-sm mb-4">
              Pendaftaran <strong>{menolak.name}</strong> ({menolak.email}) akan ditolak. Alasannya
              ikut ditampilkan kepada yang bersangkutan, jadi sebaiknya diisi.
            </p>

            <label className="block text-sm font-bold text-slate-700 mb-1">Alasan (opsional)</label>
            <textarea
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              maxLength={500}
              rows={3}
              disabled={mengirim}
              placeholder="Contoh: NIK tidak sesuai dengan data kepegawaian."
              className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-[#143c68] outline-none text-sm resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">{alasan.length}/500 karakter</p>

            {error && (
              <div className="mt-4 text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">{error}</div>
            )}

            <div className="pt-5 flex gap-3">
              <button
                onClick={() => { setMenolak(null); setAlasan(''); }}
                disabled={mengirim}
                className="flex-1 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleReject}
                disabled={mengirim}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {mengirim ? 'Memproses...' : 'Ya, Tolak'}
              </button>
            </div>
          </div>
        </div>
      )}

      {membuka && (
        <ConfirmDialog
          title="Boleh Mendaftar Lagi"
          icon={<Undo2 className="w-8 h-8" />}
          tone="primary"
          confirmLabel="Ya, Izinkan"
          busy={mengirim}
          onCancel={() => setMembuka(null)}
          onConfirm={handleForget}
          message={
            <>
              Catatan penolakan untuk <strong>{membuka.name}</strong> ({membuka.email}) akan dihapus,
              sehingga yang bersangkutan boleh mengisi formulir pendaftaran lagi. Pendaftaran barunya
              tetap harus disetujui di halaman ini.
            </>
          }
        />
      )}
    </div>
  );
}
