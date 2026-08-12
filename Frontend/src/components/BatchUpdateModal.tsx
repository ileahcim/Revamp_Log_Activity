import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, writeBatch, doc, query, where } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { LogActivity } from '../types';

interface BatchUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

const OFFICIAL_SUPERVISORS = [
  'Kustono',
  'M. Endin Herdiana',
  'Muhammad Agus M',
  'Puji Slamet Susilo',
  'Sujaryoto',
  'Supono'
];

export default function BatchUpdateModal({ isOpen, onClose, onSuccess }: BatchUpdateModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [oldSupervisorStats, setOldSupervisorStats] = useState<[string, number][]>([]);
  
  const [selectedOldSupervisors, setSelectedOldSupervisors] = useState<string[]>([]);
  const [newSupervisor, setNewSupervisor] = useState(OFFICIAL_SUPERVISORS[0]);
  const [showConfirm, setShowConfirm] = useState(false);

  const [previewLogs, setPreviewLogs] = useState<LogActivity[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
      setSelectedOldSupervisors([]);
      setShowConfirm(false);
      setPreviewLogs([]);
    }
  }, [isOpen]);

  // Initial Full Scan: Still necessary because Firestore does not have DISTINCT or projection queries
  const fetchData = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'tech_logs'));
      const stats = new Map<string, number>();
      snap.forEach(d => {
        const sv = d.data().supervisor || '-';
        stats.set(sv, (stats.get(sv) || 0) + 1);
      });
      // Sort alphabetically
      const sortedStats = Array.from(stats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      setOldSupervisorStats(sortedStats);
    } catch (err) {
      console.error("Error fetching logs for batch update:", err);
      alert("Gagal mengambil data supervisor.");
    } finally {
      setLoading(false);
    }
  };

  const officialStats = useMemo(() => {
    return oldSupervisorStats.filter(([name]) => OFFICIAL_SUPERVISORS.includes(name));
  }, [oldSupervisorStats]);

  const unofficialStats = useMemo(() => {
    return oldSupervisorStats.filter(([name]) => !OFFICIAL_SUPERVISORS.includes(name));
  }, [oldSupervisorStats]);

  const toggleSupervisor = (name: string) => {
    setSelectedOldSupervisors(prev => 
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  // Optimized query: Only read documents matching the selected supervisor
  useEffect(() => {
    const fetchPreview = async () => {
      if (selectedOldSupervisors.length === 0) {
        setPreviewLogs([]);
        return;
      }
      setLoadingPreview(true);
      try {
        let allLogs: LogActivity[] = [];
        
        // Loop sequentially or concurrently
        const promises = selectedOldSupervisors.map(name => 
          getDocs(query(collection(db, 'tech_logs'), where('supervisor', '==', name)))
        );
        const snaps = await Promise.all(promises);
        
        snaps.forEach(snap => {
          const logs = snap.docs.map(d => ({ ...d.data(), id: d.id } as LogActivity));
          allLogs = [...allLogs, ...logs];
        });

        allLogs.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
        setPreviewLogs(allLogs);
      } catch (err) {
        console.error("Error fetching preview data:", err);
      } finally {
        setLoadingPreview(false);
      }
    };
    
    fetchPreview();
  }, [selectedOldSupervisors]);

  const previewData = useMemo(() => {
    if (previewLogs.length === 0) return null;
    const count = previewLogs.length;
    const earliestDate = previewLogs[0].tanggal;
    const latestDate = previewLogs[previewLogs.length - 1].tanggal;
    return { count, earliestDate, latestDate, matchingLogs: previewLogs };
  }, [previewLogs]);

  const handleUpdate = async () => {
    if (!previewData || previewData.count === 0) return;
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      previewData.matchingLogs.forEach(log => {
        const ref = doc(db, 'tech_logs', log.id);
        batch.update(ref, { supervisor: newSupervisor });
      });

      await batch.commit();
      onSuccess(previewData.count);
    } catch (err) {
      console.error("Error updating batch:", err);
      alert("Terjadi kesalahan saat mengupdate data.");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  if (!isOpen) return null;

  if (showConfirm && previewData) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Konfirmasi Update</h3>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Anda akan mengubah <strong>{previewData.count} Activity</strong> dari {selectedOldSupervisors.length} variasi Supervisor menjadi <strong>'{newSupervisor}'</strong>.
            <br/><br/>
            Proses ini tidak dapat dibatalkan.
            <br/><br/>
            Apakah Anda yakin?
          </p>
          <div className="flex gap-3">
            <button 
              onClick={() => setShowConfirm(false)}
              disabled={loading}
              className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors text-sm disabled:opacity-50"
            >
              Batal
            </button>
            <button 
              onClick={handleUpdate}
              disabled={loading}
              className="flex-1 py-2.5 px-4 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors text-sm disabled:opacity-50 flex justify-center items-center"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Update'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Batch Update</h2>
        </div>
        
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {loading && oldSupervisorStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-indigo-600 animate-spin mb-4" />
              <p className="text-sm text-slate-500 font-medium">Scanning database...</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Supervisor Lama (Pilih Variasi)</label>
                <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col max-h-[250px]">
                  <div className="overflow-y-auto p-2 space-y-1">
                    {/* Official Supervisors */}
                    {officialStats.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[10px] font-bold text-emerald-600 uppercase mb-1 px-2">Nama Resmi</div>
                        {officialStats.map(([name, count]) => (
                          <label key={name} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={selectedOldSupervisors.includes(name)}
                              onChange={() => toggleSupervisor(name)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm font-medium text-slate-700 flex-1">{name}</span>
                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {/* Unofficial Supervisors */}
                    {unofficialStats.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1 px-2">Variasi Nama / Typo</div>
                        {unofficialStats.map(([name, count]) => (
                          <label key={name} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={selectedOldSupervisors.includes(name)}
                              onChange={() => toggleSupervisor(name)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-slate-600 flex-1">{name}</span>
                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1">Pilih satu atau lebih nama yang ingin diubah.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supervisor Tujuan</label>
                <select 
                  value={newSupervisor} 
                  onChange={e => setNewSupervisor(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                >
                  {OFFICIAL_SUPERVISORS.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Daftar nama supervisor resmi.</p>
              </div>

              {loadingPreview ? (
                <div className="flex justify-center py-6">
                   <div className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-indigo-600 animate-spin" />
                </div>
              ) : previewData ? (
                <div className="mt-6 bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                  <h4 className="text-sm font-bold text-indigo-900 mb-3">Preview Perubahan</h4>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between border-b border-indigo-100 pb-1">
                      <span className="text-indigo-600/80">Variasi yang dipilih</span>
                      <ul className="text-right font-semibold text-indigo-900">
                        {selectedOldSupervisors.map(name => {
                          const count = oldSupervisorStats.find(s => s[0] === name)?.[1] || 0;
                          return <li key={name}>{name} ({count})</li>;
                        })}
                      </ul>
                    </div>
                    <div className="flex justify-between border-b border-indigo-100 pb-1">
                      <span className="text-indigo-600/80">Supervisor Tujuan</span>
                      <span className="font-semibold text-indigo-900">{newSupervisor}</span>
                    </div>
                    <div className="flex justify-between border-b border-indigo-100 pb-1">
                      <span className="text-indigo-600/80">Total Activity</span>
                      <span className="font-semibold text-indigo-900">{previewData.count}</span>
                    </div>
                    <div className="flex flex-col border-b border-indigo-100 pb-1">
                      <span className="text-indigo-600/80 mb-1">Rentang Tanggal</span>
                      <span className="font-semibold text-indigo-900">{formatDate(previewData.earliestDate)} sampai {formatDate(previewData.latestDate)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
          <button 
            onClick={onClose}
            className="flex-1 py-2 px-4 border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-100 transition-colors text-sm"
          >
            Batal
          </button>
          <button 
            onClick={() => setShowConfirm(true)}
            disabled={!previewData || loading || loadingPreview}
            className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors text-sm disabled:opacity-50"
          >
            Batch Update
          </button>
        </div>
      </div>
    </div>
  );
}

