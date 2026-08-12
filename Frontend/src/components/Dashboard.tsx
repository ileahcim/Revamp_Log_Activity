import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
// removed getLogs
import { LogActivity } from '../types';
import { useDivisions, useKategoriCodes } from '../utils/masterData';
import { Download, FileSpreadsheet, User as UserIcon, BarChart3, Loader2 } from 'lucide-react';
import { User } from '../utils/auth';

interface DashboardProps {
  user: User;
  users: User[];
  logs: LogActivity[];
  filterNik: string;
  onNikChange: (nik: string) => void;
  filterDate?: string;
  setFilterDate?: (date: string) => void;
  filterDivisi?: string;
  onDivisiChange?: (divisi: string) => void;
}

export default function Dashboard({ user, users, logs, filterNik, onNikChange, filterDate = new Date().toISOString().split('T')[0], setFilterDate = () => {}, filterDivisi = '', onDivisiChange = () => {} }: DashboardProps) {

  // Dulu konstanta di types.ts, sekarang dari /api/master/categories.
  const KATEGORI_CODES = useKategoriCodes();
  const divisions = useDivisions();

  const [showExportModal, setShowExportModal] = useState(false);

  const techniciansMap = useMemo(() => {
    const map = new Map<string, string>();
    logs.forEach(l => {
        const key = l.nik ? String(l.nik).trim() : String(l.nama_technician).toLowerCase().trim();
        
        // Division filter logic
        if (filterDivisi) {
           const techUser = users.find(u => (u.nik && u.nik === key) || u.name.toLowerCase() === key || u.id === key);
           if (!techUser || (techUser.divisi || '-') !== filterDivisi) return;
        }

        if (!map.has(key)) {
            map.set(key, String(l.nama_technician).trim());
        }
    });
    return Array.from(map.entries()).sort((a,b) => a[1].localeCompare(b[1])); 
  }, [logs, filterDivisi, users]);

  const defaultNik = user.role === 'karyawan' ? (user.nik ? String(user.nik).trim() : String(user.name).toLowerCase().trim()) : '';

  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
        if (l.tanggal !== filterDate) return false;

        const key = l.nik ? String(l.nik).trim() : String(l.nama_technician).toLowerCase().trim();
        
        if (user.role === 'karyawan') {
             const userKey = user.nik ? String(user.nik).trim() : String(user.name).toLowerCase().trim();
             return key === userKey;
        }

        if (filterNik === '') return false; // Return no logs if 'none' is selected
        return key === filterNik;
    });
  }, [logs, filterNik, user, filterDate]);

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    Object.keys(KATEGORI_CODES).forEach(k => totals[k] = 0);
    
    filteredLogs.forEach(l => {
      const code = String(l.kategori_code || '').trim().toUpperCase();
      let mins = Number(String(l.duration_minutes || '0').replace(',', '.'));
      
      if (l.start_time && l.finish_time) {
        const startParts = l.start_time.split(':').map(Number);
        const finishParts = l.finish_time.split(':').map(Number);
        if (startParts.length === 2 && finishParts.length === 2 && !isNaN(startParts[0]) && !isNaN(finishParts[0])) {
           let startMins = startParts[0] * 60 + startParts[1];
           let finishMins = finishParts[0] * 60 + finishParts[1];
           if (finishMins <= startMins) finishMins += 24 * 60;
           mins = finishMins - startMins;
        }
      }

      totals[code] = (totals[code] || 0) + mins;
    });
    return totals;
  }, [filteredLogs]);

  const formatHours = (minutes: number) => (minutes / 60).toFixed(2);

  // If viewing "Semua Teknisi" or multiple days, scale the scheduled hours by number of unique technician-days worked
  const uniqueTechDays = useMemo(() => {
    const set = new Set(filteredLogs.map(l => `${l.tanggal}_${l.nik || l.nama_technician}`));
    return set.size;
  }, [filteredLogs]);

  const breakMinutes = categoryTotals['B'] || 0;
  const manualBreakMinutes = uniqueTechDays * 1.15 * 60; // Fixed 1 jam 15 menit per technician
  
  const totalLoggedMinutes: number = (Object.values(categoryTotals) as number[]).reduce((a: number, b: number) => a + b, 0);

  const jamTerjadwalMinutes = uniqueTechDays * 9 * 60;
  
  const totalJamEfektif = jamTerjadwalMinutes - manualBreakMinutes;
  
  const p1Minutes = categoryTotals['P1'] || 0;
  const delayMinutes = Object.entries(categoryTotals)
    .filter(([code]) => code.startsWith('D'))
    .reduce((sum: number, [_, mins]) => sum + (mins as number), 0);

  const utilization = jamTerjadwalMinutes > 0 ? (totalJamEfektif / jamTerjadwalMinutes) * 100 : 0;
  const wrenchTimeRatio = totalJamEfektif > 0 ? (p1Minutes / totalJamEfektif) * 100 : 0;
  const delayRatio = totalJamEfektif > 0 ? (delayMinutes / totalJamEfektif) * 100 : 0;

  const woDone = filteredLogs.filter(l => String(l.status).toLowerCase() === 'done').length;
  const woOngoing = filteredLogs.filter(l => String(l.status).toLowerCase() === 'ongoing').length;
  const woHold = filteredLogs.filter(l => String(l.status).toLowerCase() === 'hold').length;
  const totalOutputQty = filteredLogs.reduce((sum, l) => sum + (parseFloat(String(l.output_qty)) || 0), 0);
  const outputRate = totalJamEfektif > 0 ? totalOutputQty / (totalJamEfektif / 60) : 0;

  const exportSummaryToExcel = (data: any[][], filename: string) => {
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Merged cells
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } } // Merge A1:C1
    ];

    // Auto-width columns
    const colWidths = [{ wch: 45 }, { wch: 20 }, { wch: 20 }];
    ws['!cols'] = colWidths;

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_cell({ c: C, r: R });
        if (!ws[address]) continue;

        const val = String(ws[address].v);
        
        // Default style
        let style: any = { font: { name: "Arial", sz: 11 } };

        if (R === 0) {
          // A1: Title
          style.font = { name: "Arial", sz: 14, bold: true, color: { rgb: "00529B" } };
        } 
        else if (val.includes("Rekap Jam (otomatis") || val === "KPI Harian" || val === "Output / WO") {
          // Section headers
          style.font = { name: "Arial", sz: 11, bold: true, color: { rgb: "00529B" } };
        }
        else if (val === "Kategori" || val === "Jam" || val === "KPI" || val === "Nilai") {
           // Table Headers
           style.font = { name: "Arial", sz: 11, bold: true, color: { rgb: "FFFFFF" } };
           style.fill = { fgColor: { rgb: "143C68" } };
           style.alignment = { horizontal: "center" };
           style.border = {
             top: { style: "thin", color: { auto: 1 } },
             bottom: { style: "thin", color: { auto: 1 } },
             left: { style: "thin", color: { auto: 1 } },
             right: { style: "thin", color: { auto: 1 } }
           };
        } 
        else if ((R >= 10 && R <= 19) || (R >= 26 && R <= 28) || (R >= 31 && R <= 35)) {
           // Standard border for data cells
           style.border = {
             top: { style: "hair", color: { auto: 1 } },
             bottom: { style: "hair", color: { auto: 1 } },
             left: { style: "hair", color: { auto: 1 } },
             right: { style: "hair", color: { auto: 1 } }
           };
           
           // Bold bottom total lines like Total jam terlapor
           if (C === 0 && (val.includes("Total jam") || val.includes("Total Output") || val.includes("Output Rate"))) {
               style.font = { name: "Arial", sz: 11, bold: true };
           }
           if(C === 1 && (R === 26 || R === 27 || R === 28)){
               style.alignment = { horizontal: "right" };
           }
        }
        
        // Specific bold text for certain labels in column 0
        if (C === 0 && (val === "Tanggal" || val === "Nama Technician" || val === "Shift" || val === "Jam Terjadwal" || val === "Break (B) manual" || val.includes("Total jam") || val === "Total Output Qty" || val === "Output Rate (Qty per jam efektif)")) {
           style.font = { name: "Arial", sz: 11, bold: true };
        }

        ws[address].s = style;
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
    XLSX.writeFile(wb, filename);
  };

  const selectedTechName = user.role === 'karyawan' 
    ? user.name 
    : (filterNik === '' ? 'None' : (techniciansMap.find(t => t[0] === filterNik)?.[1] || filterNik));

  const selectedShift = filteredLogs.length > 0 ? filteredLogs[0].shift : '-';

  const handleExportSummary = () => {
    if(!filterNik && user.role !== 'karyawan') {
      alert("Pilih teknisi terlebih dahulu.");
      return;
    }

    const dataToExport = filteredLogs;

    if (dataToExport.length === 0) {
      alert("Tidak ada data untuk diekspor.");
      return;
    }

    const rows: any[][] = [];
    
    rows.push(['Form Productivity Technician - Harian (Summary)', '', '']);
    rows.push([]);
    rows.push(['Tanggal', filterDate]);
    rows.push(['Nama Technician', selectedTechName]);
    rows.push(['Shift', selectedShift]);
    rows.push(['Jam Terjadwal', (jamTerjadwalMinutes / 60).toFixed(2)]);
    rows.push(['Break (B) manual', (manualBreakMinutes / 60).toFixed(2)]);
    rows.push([]);
    
    rows.push(['Rekap Jam (otomatis dari Sheet Log)', '']);
    rows.push(['Kategori', 'Jam']);
    Object.entries(KATEGORI_CODES).forEach(([code, label]) => {
        rows.push([`${code} - ${label}`, formatHours(categoryTotals[code] || 0)]);
    });
    
    rows.push([]);
    rows.push(['Total jam terlapor (otomatis)', formatHours(totalLoggedMinutes)]);
    rows.push(['Total jam efektif (Jam Terjadwal - Break)', formatHours(totalJamEfektif)]);
    rows.push([]);
    
    rows.push(['KPI Harian', '']);
    rows.push(['KPI', 'Nilai']);
    rows.push(['Utilization', `${utilization.toFixed(2)}%`]);
    rows.push(['Wrench Time Ratio', `${wrenchTimeRatio.toFixed(2)}%`]);
    rows.push(['Delay Ratio', `${delayRatio.toFixed(2)}%`]);
    rows.push([]);

    rows.push(['Output / WO', '']);
    rows.push(['WO/Job Done (count)', woDone]);
    rows.push(['WO/Job Ongoing (count)', woOngoing]);
    rows.push(['WO/Job Hold (count)', woHold]);
    rows.push(['Total Output Qty', totalOutputQty]);
    rows.push(['Output Rate (Qty per jam efektif)', outputRate.toFixed(2)]);
    
    exportSummaryToExcel(rows, `Summary_${selectedTechName.replace(/\s+/g,'_')}_All_Time.xlsx`);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto w-full max-w-full">
      <div className="bg-white p-4 sm:p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <h2 className="text-xl font-bold text-[#143c68] flex items-center gap-2">
            Form Productivity Technician - Harian (Summary)
          </h2>
          
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 w-full lg:w-auto">
            <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
              <input 
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-[#143c68] outline-none"
              />

              {user.role !== 'karyawan' && (
                <>
                <select
                  className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-[#143c68] outline-none"
                  value={filterDivisi}
                  onChange={e => {
                    onDivisiChange?.(e.target.value);
                    onNikChange(''); // Reset selected nik when division changes
                  }}
                >
                  <option value="">Semua Divisi</option>
                  {/* Dulu enam <option> tetap, tersalin di lima berkas.
                      Sekarang dari /api/master/divisions. */}
                  {divisions.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
                <select 
                  className="w-full sm:w-auto px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-[#143c68] outline-none"
                  value={filterNik}
                  onChange={e => onNikChange(e.target.value)}
                >
                  <option value="">-- Pilih Teknisi --</option>
                  {techniciansMap.map(([key, name]) => (
                    <option key={key} value={key}>{name} {key !== name.toLowerCase() ? `(${key})` : ''}</option>
                  ))}
                </select>
                </>
              )}

              <button 
                onClick={handleExportSummary}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 text-sm font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-md hover:bg-indigo-700 transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" /> Export Summary
              </button>
            </div>
          </div>
        </div>

        {false ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin text-[#143c68] mb-4" />
            <p>Memuat kalkulasi summary...</p>
          </div>
        ) : (
          <>
            <div className="border border-slate-300">
              <table className="w-full text-sm text-left">
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="py-1.5 px-3 font-bold bg-white w-1/2">Tanggal</td>
                    <td className="py-1.5 px-3 bg-white w-1/2 text-right">{filterDate}</td>
                  </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 font-bold bg-white">Nama Technician</td>
                <td className="py-1.5 px-3 bg-white text-right">{selectedTechName || '-'}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 font-bold bg-white">Shift</td>
                <td className="py-1.5 px-3 bg-white text-right">{selectedShift}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 font-bold bg-white">Jam Terjadwal</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono">{(jamTerjadwalMinutes / 60).toFixed(2).replace('.', ',')}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 font-bold bg-white">Break (B) manual</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono">{(manualBreakMinutes / 60).toFixed(2).replace('.', ',')}</td>
              </tr>
              <tr><td colSpan={2} className="h-4 bg-slate-50"></td></tr>
              <tr>
                <td colSpan={2} className="py-2 px-3 font-bold text-[#143c68] bg-white border-y border-slate-200 text-base">
                  Rekap Jam (otomatis dari Sheet Log)
                </td>
              </tr>
              <tr className="bg-[#143c68] text-white">
                <th className="py-1.5 px-3 font-bold text-center border-r border-[#2d609a]">Kategori</th>
                <th className="py-1.5 px-3 font-bold text-center">Jam</th>
              </tr>
              {Object.entries(KATEGORI_CODES).map(([code, label]) => (
                <tr key={code} className="border-b border-slate-200">
                  <td className="py-1 px-3 bg-white border-r border-slate-200 text-slate-700">{code} - {label}</td>
                  <td className="py-1 px-3 bg-white text-right font-mono text-slate-700">{formatHours(categoryTotals[code] || 0).replace('.', ',')}</td>
                </tr>
              ))}
              <tr><td colSpan={2} className="h-4 bg-slate-50 border-b border-slate-200 border-t border-slate-200"></td></tr>
              <tr className="border-b border-slate-200 bg-white text-slate-800">
                <td className="py-2 px-3 font-bold">Total jam terlapor (otomatis)</td>
                <td className="py-2 px-3 text-right font-mono">{formatHours(totalLoggedMinutes).replace('.', ',')}</td>
              </tr>
              <tr className="border-b border-slate-200 bg-white text-slate-800">
                <td className="py-2 px-3 font-bold">Total jam efektif (Jam Terjadwal - Break)</td>
                <td className="py-2 px-3 text-right font-mono">{formatHours(totalJamEfektif).replace('.', ',')}</td>
              </tr>
              <tr><td colSpan={2} className="h-4 bg-slate-50"></td></tr>
              <tr>
                <td colSpan={2} className="py-2 px-3 font-bold text-[#143c68] bg-white border-y border-slate-200 text-base">
                  KPI Harian
                </td>
              </tr>
              <tr className="bg-[#143c68] text-white">
                <th className="py-1.5 px-3 font-bold text-center border-r border-[#2d609a]">KPI</th>
                <th className="py-1.5 px-3 font-bold text-center">Nilai</th>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 bg-white border-r border-slate-200 font-medium text-slate-700">Utilization</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono text-slate-700">{utilization.toFixed(2).replace('.', ',')}%</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 bg-white border-r border-slate-200 font-medium text-slate-700">Wrench Time Ratio</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono text-slate-700">{wrenchTimeRatio.toFixed(2).replace('.', ',')}%</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 bg-white border-r border-slate-200 font-medium text-slate-700">Delay Ratio</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono text-slate-700">{delayRatio.toFixed(2).replace('.', ',')}%</td>
              </tr>
              <tr><td colSpan={2} className="h-4 bg-slate-50"></td></tr>
              <tr>
                <td colSpan={2} className="py-2 px-3 font-bold text-[#143c68] bg-white border-y border-slate-200 text-base">
                  Output / WO
                </td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 bg-white border-r border-slate-200 font-medium text-slate-700">WO/Job Done (count)</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono text-slate-700">{woDone}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 bg-white border-r border-slate-200 font-medium text-slate-700">WO/Job Ongoing (count)</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono text-slate-700">{woOngoing}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 bg-white border-r border-slate-200 font-medium text-slate-700">WO/Job Hold (count)</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono text-slate-700">{woHold}</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 px-3 bg-white border-r border-slate-200 font-medium text-slate-700">Total Output Qty</td>
                <td className="py-1.5 px-3 bg-white text-right font-mono text-slate-700">{totalOutputQty}</td>
              </tr>
              <tr className="border-b border-slate-200 bg-white">
                <td className="py-1.5 px-3 border-r border-slate-200 font-medium text-slate-700">Output Rate (Qty per jam efektif)</td>
                <td className="py-1.5 px-3 text-right font-mono text-slate-700">{outputRate.toFixed(2).replace('.', ',')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
