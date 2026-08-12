import React, { useState, useRef, useEffect } from 'react';
import { X, Bug, Upload, Image as ImageIcon, History, CheckCircle2, AlertCircle } from 'lucide-react';
import { compressImage, saveBugReport, BugReport, bugStatusClass, fetchBugReports } from '../utils/bugReport';
import { User } from '../utils/auth';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSuccess: () => void; // still prop for external but we handle internal modal too
}

export default function BugReportModal({ isOpen, onClose, user, onSuccess }: BugReportModalProps) {
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');
  const [showSuccess, setShowSuccess] = useState(false);
  const [myHistory, setMyHistory] = useState<BugReport[]>([]);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageBase64, setImageBase64] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab === 'history') {
      // Penyaringan ganda (di sini dan di server) sengaja dipertahankan; yang
      // di server-lah yang mengikat, yang di sini tidak merugikan.
      fetchBugReports(user.role === 'admin' ? undefined : (user.id || user.nik || 'unknown')).then(reports => {
        const filtered = reports.filter(r => user.role === 'admin' || r.userId === (user.id || user.nik || 'unknown'));
        filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setMyHistory(filtered);
      });
    }
  }, [activeTab, user]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("Ukuran gambar terlalu besar. Maksimal 5MB.");
        return;
      }
      try {
        const compressed = await compressImage(file);
        setImageBase64(compressed);
      } catch (error) {
        console.error("Gagal memproses gambar:", error);
        alert("Gagal memproses gambar.");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      alert("Judul dan deskripsi wajib diisi.");
      return;
    }
    
    setIsSubmitting(true);
    try {
      await saveBugReport({
        userId: user.id || user.nik || 'unknown',
        userName: user.name,
        role: user.role,
        title,
        description,
        imageBase64
      });
      // Instead of closing, show success view
      setShowSuccess(true);
      // Reset form
      setTitle('');
      setDescription('');
      setImageBase64(undefined);
    } catch (error) {
      alert("Gagal mengirim laporan. Coba lagi.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (showSuccess) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center animate-in zoom-in duration-300">
          <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Sukses!</h2>
          <p className="text-slate-600 mb-8">Laporan bug Anda berhasil dikirim ke Admin. Terima kasih atas masukan Anda!</p>
          <button 
            onClick={() => { setShowSuccess(false); setActiveTab('history'); }} 
            className="w-full bg-[#143c68] text-white py-3 rounded-xl font-bold hover:bg-[#1a4f8a] transition shadow-md"
          >
            Lihat Riwayat Laporan Saya
          </button>
          <button 
            onClick={() => { setShowSuccess(false); onClose(); }} 
            className="w-full mt-3 text-slate-500 hover:text-slate-700 py-2 font-medium"
          >
            Tutup Layar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh]">
        <div className="p-4 border-b border-white/20 flex justify-between items-center bg-[#143c68] text-white shrink-0">
          <h3 className="font-bold flex items-center gap-2">
            <Bug className="w-5 h-5 opacity-80" />
            Bantuan & Laporan
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex bg-slate-100 border-b border-slate-200 shrink-0">
          <button 
            onClick={() => setActiveTab('form')}
            className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'form' ? 'bg-white border-[#143c68] text-[#143c68]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Buat Laporan Baru
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'history' ? 'bg-white border-[#143c68] text-[#143c68]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <History className="w-4 h-4" /> Riwayat Saya
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'form' ? (
            <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
              <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-lg flex gap-3 text-sm text-indigo-800 mb-2">
                <AlertCircle className="w-5 h-5 shrink-0 text-indigo-500" />
                <p>Gunakan form ini untuk melaporkan jika menemukan kendala error pada sistem, fitur tidak berfungsi, atau masukan pengembangan.</p>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Judul Masalah *</label>
                <input 
                  type="text" 
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#143c68] outline-none"
                  placeholder="Contoh: Gagal Export Excel di My Day"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Deskripsi Detail *</label>
                <textarea 
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#143c68] outline-none min-h-[100px]"
                  placeholder="Ceritakan sedetail mungkin bagaimana kendala ini muncul, apa yang Anda lakukan sebelum error..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Screenshot (Opsional)</label>
                {imageBase64 ? (
                  <div className="relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                    <img src={imageBase64} alt="Preview" className="w-full object-contain max-h-[150px]" />
                    <button 
                      type="button"
                      onClick={() => setImageBase64(undefined)}
                      className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-full hover:bg-red-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-slate-50 transition"
                  >
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                    <span className="text-xs text-slate-500 font-medium">Klik untuk upload gambar</span>
                  </div>
                )}
                <input 
                  type="file" 
                  accept="image/*"
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
              </div>

              <div className="mt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors text-sm"
                  disabled={isSubmitting}
                >
                  Batal
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-[2] py-2.5 px-4 bg-[#143c68] text-white rounded-xl font-bold hover:bg-[#1a4f8a] transition-colors text-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Mengirim...' : 'Kirim Laporan'}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-0">
              {myHistory.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <History className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Anda belum pernah mengirim laporan bug.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {myHistory.map(report => {
                    const d = new Date(report.timestamp);
                    const formattedDate = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                    return (
                      <div key={report.id} className="p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-bold text-slate-800 text-sm">{report.title}</h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${bugStatusClass(report.status)}`}>
                            {report.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mb-2 line-clamp-2">{report.description}</p>
                        <div className="text-[10px] text-slate-400 font-medium">Dikirim pada: {formattedDate}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
