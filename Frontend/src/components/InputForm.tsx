import React, { useState, useEffect, useRef } from 'react';
import { Save, Clock, Info, ArrowLeft, Camera, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { SHIFTS, STATUSES, LogActivity } from '../types';
import { useDelayCodeNames, useKategoriCodes, useSupervisors } from '../utils/masterData';
import { fetchLogs, normalizeName, saveLog, updateLog } from '../utils/storage';
import { ApiError } from '../utils/api';
import { User, addAuditLog } from '../utils/auth';
import BarcodeScanner from './BarcodeScanner';
import { saveDraft, deleteDraft, getDrafts } from '../utils/drafts';

export default function InputForm({ 
  onSuccess, 
  user,
  initialData,
  onShowToast,
  defaultName,
  defaultNik,
  isFormDirty,
  setIsFormDirty,
  onCancel,
  draftId
}: { 
  onSuccess: (savedLog?: LogActivity, isEdit?: boolean) => void, 
  user: User,
  initialData?: LogActivity | null,
  onShowToast: (message: string) => void,
  defaultName?: string,
  defaultNik?: string,
  isFormDirty?: boolean,
  setIsFormDirty?: (dirty: boolean) => void,
  onCancel?: () => void,
  draftId?: string | null
}) {
  // Dulu konstanta di types.ts dan <option> tetap di berkas ini; sekarang dari
  // /api/master/* lewat MasterDataProvider.
  const KATEGORI_CODES = useKategoriCodes();
  const DELAY_CODES = useDelayCodeNames();
  const supervisors = useSupervisors();

  const getInitialState = () => ({
    tanggal: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0],
    nama_technician: defaultName || user?.name || '',
    nik: defaultNik || user?.nik || '',
    supervisor: '',
    shift: 'Pagi',
    wo_notif: '',
    asset_tag: '',
    party: '',
    sn: '',
    deskripsi_pekerjaan: '',
    kategori_code: 'P1',
    start_time: '',
    finish_time: '',
    status: 'Done',
    delay_code: '',
    output_qty: '',
    catatan: '',
  });

  const [formData, setFormData] = useState(getInitialState());
  const [isSaving, setIsSavingState] = useState(false);
  const isSavingRef = useRef(false);
  const setIsSaving = (val: boolean) => { isSavingRef.current = val; setIsSavingState(val); };

  const [errorMsg, setErrorMsg] = useState('');
  const [showOverlapDialog, setShowOverlapDialog] = useState(false);
  const [showShiftDialog, setShowShiftDialog] = useState(false);

  
  
  
  const [searchSn, setSearchSn] = useState('');
  const [isSnExpanded, setIsSnExpanded] = useState(false);
  const snTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [searchMatchLine, setSearchMatchLine] = useState<number | null>(null);

  const [showScanner, setShowScanner] = useState(false);
  const [scannerPaused, setScannerPaused] = useState(false);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [isDuplicateScan, setIsDuplicateScan] = useState(false);

  const handleScan = (decodedText: string) => {
    setScannerPaused(true);
    const existingSns = formData.sn.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const isDuplicate = existingSns.includes(decodedText);
    setIsDuplicateScan(isDuplicate);
    setScannedCode(decodedText);
  };

  const handleConfirmScan = () => {
    const newSn = formData.sn ? `${formData.sn}\n${scannedCode}` : scannedCode;
    setFormData(prev => ({ ...prev, sn: newSn || '' }));
    setShowScanner(false);
    setScannerPaused(false);
    setScannedCode(null);
    onShowToast(isDuplicateScan ? '⚠️ Serial Number digunakan kembali pada Activity ini.' : '✅ Barcode berhasil dipindai.');
  };

  const handleRetakeScan = () => {
    setScannedCode(null);
    setIsDuplicateScan(false);
    setScannerPaused(false);
  };

  const proceedSave = async () => {
    if (isSavingRef.current) return;
    setIsSaving(true);

    // normalizeName dipakai bersama utils/storage.ts. Dulu ada dua salinan --
    // satu di sini, satu di storage.ts -- padahal keduanya harus selalu sepakat:
    // yang di sini menentukan bentuk nama yang disimpan, yang di sana menentukan
    // bentuk nama yang dibandingkan saat mencari tumpang-tindih jam.
    const payload = {
      ...formData,
      supervisor: normalizeName(formData.supervisor),
      nama_technician: normalizeName(formData.nama_technician),
      shift: formData.shift as any,
      output_qty: formData.output_qty ? Number(formData.output_qty) : undefined,
      sn: formData.sn.split('\n').map(s => s.trim()).filter(Boolean).join(', ')
    };

    const saveTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), 15000);
    });

    const saveLogic = async () => {
      let savedLogResult: LogActivity | undefined;
      if (initialData) {
        savedLogResult = await updateLog(initialData.id, payload);
        addAuditLog(user, `Mengedit log aktivitas (ID: ${initialData.id})`);
      } else {
        savedLogResult = await saveLog(payload);
        addAuditLog(user, 'Menambahkan log aktivitas baru');
      }
      return savedLogResult;
    };

    try {
      const savedLogResult = await Promise.race([saveLogic(), saveTimeout]) as LogActivity;
      
      if (initialData) {
        onShowToast('Log berhasil diupdate!');
      } else {
        onShowToast('Log berhasil disimpan!');
        if (draftId) deleteDraft(draftId);
        setFormData(getInitialState());
      }
      
      onSuccess(savedLogResult, !!initialData);
    } catch (error: any) {
      console.error("Error saving log:", error);
      if (error.message === 'TIMEOUT') {
        setErrorMsg('Proses simpan terlalu lama (timeout). Silakan coba lagi.');
      } else if (error instanceof ApiError) {
        // Pesan dari server dipakai apa adanya. Isinya menyebut persis apa yang
        // salah -- kode kategori yang tidak ada di master, atau karyawan yang
        // mencatat untuk tanggal selain hari ini -- sementara kalimat umum di
        // bawah tidak memberi tahu apa pun yang bisa ditindaklanjuti.
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Terjadi kesalahan saat menyimpan data. Silakan coba lagi.');
      }
    } finally {
      setIsSaving(false);
    }
  };


  useEffect(() => {
    if (initialData) {
      setFormData({
        tanggal: initialData.tanggal,
        nama_technician: initialData.nama_technician,
        nik: initialData.nik,
        supervisor: initialData.supervisor,
        shift: initialData.shift,
        wo_notif: initialData.wo_notif || '',
        asset_tag: initialData.asset_tag || '',
        party: initialData.party || '',
        sn: initialData.sn ? initialData.sn.replace(/,\s*/g, '\n') : '',
        deskripsi_pekerjaan: initialData.deskripsi_pekerjaan,
        kategori_code: initialData.kategori_code,
        start_time: initialData.start_time,
        finish_time: initialData.finish_time,
        status: initialData.status,
        delay_code: initialData.delay_code || '',
        output_qty: initialData.output_qty?.toString() || '',
        catatan: initialData.catatan || '',
      });
    } else {
      setFormData(prev => ({
        ...prev,
        nama_technician: defaultName || user?.name || '',
        nik: defaultNik || user?.nik || ''
      }));
      
      if (draftId && !initialData) {
        const drafts = getDrafts();
        const existing = drafts.find(d => d.id === draftId);
        if (existing) {
          setFormData(existing.data);
          if (setIsFormDirty) setIsFormDirty(true);
        }
      }
    }
  }, [initialData, user, defaultName, defaultNik, draftId]);



  const hasMeaningfulData = (data: any) => {
    return !!(
      data.wo_notif || 
      data.asset_tag || 
      data.party || 
      data.sn || 
      data.deskripsi_pekerjaan || 
      data.start_time || 
      data.finish_time || 
      data.output_qty || 
      data.catatan || 
      data.delay_code
    );
  };

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!initialData && draftId) {
      if (hasMeaningfulData(formData)) {
        saveDraft(draftId, formData);
      } else {
        deleteDraft(draftId);
      }
    }
  }, [formData, initialData, draftId]);

  useEffect(() => {
    if (searchSn && snTextareaRef.current) {
      const lines = formData.sn.split('\n');
      const idx = lines.findIndex(line => line.toLowerCase().includes(searchSn.toLowerCase()));
      if (idx !== -1) {
        const lineHeight = 20; 
        snTextareaRef.current.scrollTop = idx * lineHeight;
        setSearchMatchLine(idx + 1);
      } else {
        setSearchMatchLine(null);
      }
    } else {
      setSearchMatchLine(null);
    }
  }, [searchSn, formData.sn]);

  const snList = formData.sn.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const duplicateSns = [...new Set(snList.filter((item, index) => snList.indexOf(item) !== index))];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (setIsFormDirty) {
      // Check if the changed field is considered a meaningful draft field
      if (['wo_notif', 'asset_tag', 'party', 'sn', 'deskripsi_pekerjaan', 'output_qty', 'catatan', 'delay_code'].includes(name) ||
          (['start_time', 'finish_time'].includes(name) && value !== '')) {
         setIsFormDirty(true);
      }
    }
  };

  const proceedCheckOverlap = async () => {
    if (isSavingRef.current) return;
    setIsSaving(true);
    
    const checkTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), 15000);
    });

    const checkLogic = async () => {
      // Diambil satu hari itu saja, lalu nama teknisinya dicocokkan di memori.
      // Backend tidak punya filter nama_technician; yang tersedia `search`,
      // dan itu LIKE ke banyak kolom sekaligus (termasuk deskripsi pekerjaan)
      // sehingga bisa ikut menarik baris milik orang lain.
      //
      // Untuk karyawan, server sudah membatasi ke log miliknya sendiri, jadi
      // yang terambil memang cuma hari itu miliknya.
      const sehari = await fetchLogs(formData.tanggal, formData.tanggal);

      const namaDicari = normalizeName(formData.nama_technician);
      const existingLogs = sehari.filter(l => normalizeName(l.nama_technician) === namaDicari);

      // Calculate new log minutes
      const startParts = formData.start_time.split(':').map(Number);
      const finishParts = formData.finish_time.split(':').map(Number);
      let startMins = startParts[0] * 60 + startParts[1];
      let finishMins = finishParts[0] * 60 + finishParts[1];
      if (finishMins <= startMins) finishMins += 24 * 60;
      
      const hasOverlap = existingLogs.some(log => {
        if (initialData && log.id === initialData.id) return false; // Ignore self when editing
        
        const lsParts = log.start_time.split(':').map(Number);
        const lfParts = log.finish_time.split(':').map(Number);
        let lsMins = lsParts[0] * 60 + lsParts[1];
        let lfMins = lfParts[0] * 60 + lfParts[1];
        if (lfMins <= lsMins) lfMins += 24 * 60;
        
        // Check overlap condition: Time ranges [startA, endA) and [startB, endB) overlap if:
        // startA < endB AND startB < endA
        return startMins < lfMins && lsMins < finishMins;
      });
      
      if (hasOverlap) {
        if (user.role === 'admin' || user.role === 'atasan') {
           throw new Error('DIALOG_SHOWN');
        } else {
           throw new Error('VALIDATION_FAILED');
        }
      }
      return true;
    };

    try {
      await Promise.race([checkLogic(), checkTimeout]);
      setIsSaving(false);
      proceedSave();
    } catch (error: any) {
      setIsSaving(false);
      if (error.message === 'DIALOG_SHOWN') {
        setShowOverlapDialog(true);
      } else if (error.message === 'VALIDATION_FAILED') {
        setErrorMsg('❌ Gagal disimpan! Anda sudah memiliki aktivitas lain pada rentang jam tersebut. Harap pisahkan waktu Anda.');
      } else if (error.message === 'TIMEOUT') {
        setErrorMsg('Proses validasi terlalu lama (timeout). Silakan coba lagi.');
      } else {
        console.error("Error validating overlap:", error);
        setErrorMsg('Terjadi kesalahan saat validasi. Silakan coba lagi.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingRef.current) return;

    
    setErrorMsg('');

    // Validasi Jam Berdasarkan Shift
    const start = formData.start_time;
    let shiftError = "";
    if (formData.shift === 'Pagi') {
      if (start < '07:00' || start > '20:00') {
        shiftError = "Jam yang dipilih tidak sesuai dengan rentang waktu Shift Pagi (07:00 - 20:00).";
      }
    } else if (formData.shift === 'Siang') {
      if (start < '07:00' || start > '23:59') {
        shiftError = "Jam yang dipilih tidak sesuai dengan rentang waktu Shift Siang (07:00 - 23:59).";
      }
    } else if (formData.shift === 'Malam') {
      if (start < '17:00' || start > '23:59') {
        shiftError = "Jam yang dipilih tidak sesuai dengan rentang waktu Shift Malam (17:00 - 23:59).";
      }
    }

    if (shiftError) {
      if (user.role === 'admin' || user.role === 'atasan') {
        setShowShiftDialog(true);
        return;
      } else {
        setErrorMsg(shiftError);
        return;
      }
    }

    proceedCheckOverlap();
  };

  const isDelay = formData.kategori_code.startsWith('D');

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 shrink-0 flex justify-between items-center">
        <div>
          <h2 className="font-bold text-slate-700 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            {initialData ? 'Edit Activity' : 'Log New Activity'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">Record daily tasks and duration</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <form id="log-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tanggal *</label>
              <input required type="date" name="tanggal" value={formData.tanggal} onChange={handleChange} min={user.role === 'karyawan' ? new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0] : undefined} max={user.role === 'karyawan' ? new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0] : undefined} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow bg-white" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Shift *</label>
              <select required name="shift" value={formData.shift} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow">
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nama Technician *</label>
              <input required type="text" name="nama_technician" value={formData.nama_technician} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" placeholder="Contoh: Budi Santoso" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">NIK</label>
              <input type="text" name="nik" value={formData.nik} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" placeholder="TS-0001" />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Supervisor *</label>
              <select required name="supervisor" value={formData.supervisor} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow">
                <option value="">Pilih Supervisor</option>
                {/* Dulu enam <option> tetap di sini. Sekarang dari
                    /api/master/supervisors, hanya yang is_active = TRUE. */}
                {supervisors.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Status Pekerjaan *</label>
              <select required name="status" value={formData.status} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Start Time (hh:mm) *</label>
              <input required type="time" name="start_time" value={formData.start_time} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Finish Time (hh:mm) *</label>
              <input required type="time" name="finish_time" value={formData.finish_time} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-bold text-slate-500 uppercase">Kategori (Code) *</label>
            </div>
            <select required name="kategori_code" value={formData.kategori_code} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow">
              {Object.entries(KATEGORI_CODES).map(([code, label]) => (
                <option key={code} value={code}>{code} - {label}</option>
              ))}
            </select>
            
            {/* Legend / Info */}
            <div className="mt-2 bg-indigo-50/50 p-2 rounded-lg border border-indigo-100 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
              <div className="text-[10px] text-slate-600 space-y-1">
                <p><strong className="text-emerald-700">P1-P4</strong>: Tipe kerja produktif (contoh P1: Wrench Time).</p>
                <p><strong className="text-amber-700">D1-D5</strong>: Waktu tertunda/wasted (wajib isi Delay Code).</p>
                <p><strong className="text-slate-700">B</strong>: Break / Istirahat / Personal time.</p>
              </div>
            </div>
          </div>

          {isDelay && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-md animate-in fade-in zoom-in-95 duration-200">
              <label className="block text-[10px] font-bold text-amber-700 uppercase mb-1">Delay Code *</label>
              <select required={isDelay} name="delay_code" value={formData.delay_code} onChange={handleChange} className="w-full px-3 py-2 border border-amber-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-amber-500 outline-none transition-shadow">
                <option value="">-- Pilih Delay Code --</option>
                {Object.entries(DELAY_CODES).map(([code, label]) => (
                  <option key={code} value={code}>{code} - {label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Work Order / Asset Tag (Optional)</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input type="text" name="wo_notif" value={formData.wo_notif} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition" placeholder="WO/Notif" />
              <input type="text" name="asset_tag" value={formData.asset_tag} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition" placeholder="Asset/Tag" />
            </div>
            
            <div className="mb-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Party (Optional)</label>
              <input type="text" name="party" value={formData.party} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition" placeholder="Party" />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-bold text-slate-500 uppercase">Serial Number (Optional)</label>
                <div className="relative w-[140px] sm:w-[200px]">
                  <input type="text" value={searchSn} onChange={(e) => setSearchSn(e.target.value)} className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-md text-xs focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Cari SN..." />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  {searchMatchLine && (
                    <div className="absolute right-0 top-full mt-1 text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 whitespace-nowrap z-10">
                      Baris ke-{searchMatchLine}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="relative">
                <textarea 
                  ref={snTextareaRef}
                  name="sn" 
                  value={formData.sn} 
                  onChange={handleChange} 
                  rows={isSnExpanded ? 15 : 6} 
                  className={`w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none ${isSnExpanded ? 'overflow-y-auto' : 'overflow-hidden'} pr-10 whitespace-pre-wrap`} 
                  placeholder="Scan atau ketik SN (satu per baris)..." 
                />
                <button type="button" onClick={() => setShowScanner(true)} className="absolute right-2 top-2 text-slate-500 hover:text-indigo-600 transition p-1.5 bg-white rounded shadow-sm border border-slate-200">
                  <Camera className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md">Total Scan: {formData.sn.split('\n').filter(s => s.trim()).length} Serial Number</span>
                <button type="button" onClick={() => setIsSnExpanded(!isSnExpanded)} className="text-xs font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors bg-slate-50 px-2 py-1 rounded-md border border-slate-200">
                  {isSnExpanded ? (
                    <>Less <ChevronUp className="w-3.5 h-3.5" /></>
                  ) : (
                    <>More <ChevronDown className="w-3.5 h-3.5" /></>
                  )}
                </button>
              </div>
              {duplicateSns.length > 0 && (
                <div className="text-xs font-bold text-red-600 bg-red-50 p-2 rounded-md border border-red-200 mt-1">
                  ⚠️ SN Duplikat ditemukan: {duplicateSns.join(', ')}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Deskripsi Pekerjaan *</label>
            <textarea required name="deskripsi_pekerjaan" value={formData.deskripsi_pekerjaan} onChange={handleChange} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" placeholder="Brief description of tasks..."></textarea>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
               <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Output Qty</label>
               <input type="number" name="output_qty" value={formData.output_qty} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" placeholder="0" />
            </div>
            <div className="col-span-2">
               <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Catatan / Temuan</label>
               <input type="text" name="catatan" value={formData.catatan} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" placeholder="Additional info..." />
            </div>
          </div>
        </form>
      </div>

      <div className="p-4 border-t border-slate-100 bg-white shrink-0 flex flex-col sm:flex-row gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10 w-full relative">
        <button 
          type="button"
          onClick={() => onCancel ? onCancel() : onSuccess()} 
          disabled={isSaving}
          className="w-full sm:w-1/3 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 text-slate-700 font-bold py-3 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {initialData ? 'Batal' : 'Kembali'}
        </button>
        <button form="log-form" type="submit" disabled={isSaving} className="w-full sm:w-2/3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg shadow-md transition-colors flex items-center justify-center gap-2">
          {isSaving ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isSaving ? (initialData ? 'Updating...' : 'Menyimpan...') : (initialData ? 'Update Log' : 'Simpan Activity Log')}
        </button>
      </div>

      {showShiftDialog && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">Peringatan</h3>
              <p className="text-sm text-slate-600 mb-6 text-center leading-relaxed">
                Jam yang dipilih berada di luar rentang waktu Shift yang dipilih.
                <br/><br/>
                Sebagai Admin atau Atasan Anda dapat tetap menyimpan perubahan apabila memang diperlukan.
                <br/><br/>
                Apakah Anda yakin ingin melanjutkan?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowShiftDialog(false)}
                  className="flex-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    setShowShiftDialog(false);
                    proceedCheckOverlap();
                  }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
                >
                  Ya, Tetap Simpan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showOverlapDialog && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">Peringatan</h3>
              <p className="text-sm text-slate-600 mb-6 text-center leading-relaxed">
                Sudah terdapat aktivitas lain pada rentang waktu yang sama.
                <br/><br/>
                Apakah Anda yakin ingin tetap menyimpan perubahan? Perubahan ini dapat menyebabkan dua aktivitas berada pada waktu yang sama.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowOverlapDialog(false)}
                  className="flex-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    setShowOverlapDialog(false);
                    proceedSave();
                  }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
                >
                  Ya, Tetap Simpan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Info className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Peringatan</h3>
              <p className="text-sm text-slate-600 mb-6">{errorMsg}</p>
              <button
                onClick={() => setErrorMsg('')}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-lg transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}



      {showScanner && (
        <BarcodeScanner
          isOpen={showScanner}
          onClose={() => setShowScanner(false)}
          onScan={handleScan}
          paused={scannerPaused}
        />
      )}

      {scannedCode && (
        <div className="fixed inset-0 z-[110] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              {isDuplicateScan ? 'Serial Number Duplikat' : 'Barcode Berhasil Dipindai'}
            </h3>
            
            {isDuplicateScan ? (
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                Serial Number <strong>"{scannedCode}"</strong> sudah pernah dipindai pada Activity ini.
                <br/><br/>
                Apakah tetap ingin menggunakan Serial Number tersebut?
              </p>
            ) : (
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                Barcode yang ditemukan:
                <br/>
                <strong>{scannedCode}</strong>
                <br/><br/>
                Apakah ingin menggunakan Serial Number ini?
              </p>
            )}
            
            <div className="flex gap-3">
              <button 
                onClick={handleRetakeScan}
                className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors text-sm"
              >
                Scan Ulang
              </button>
              <button 
                onClick={handleConfirmScan}
                className="flex-1 py-2.5 px-4 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors text-sm"
              >
                {isDuplicateScan ? 'Tetap Gunakan' : 'Gunakan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
