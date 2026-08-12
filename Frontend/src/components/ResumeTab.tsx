import React, { useMemo, useState, useEffect } from 'react';
// removed getLogs
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { LogActivity } from '../types';
import { useDivisions } from '../utils/masterData';

interface ResumeTabProps {
  logs: LogActivity[];
  users: any[];
  filterStartDate: string;
  onStartDateChange: (date: string) => void;
  filterEndDate: string;
  onEndDateChange: (date: string) => void;
  filterDivisi?: string;
  onDivisiChange?: (divisi: string) => void;
}

export default function ResumeTab({ logs, users, filterStartDate, onStartDateChange, filterEndDate, onEndDateChange, filterDivisi = '', onDivisiChange = () => {} }: ResumeTabProps) {

  const divisions = useDivisions();

  const { groupedByDate } = useMemo(() => {
    // 1. Filter logs
    const filteredLogs = logs.filter(l => l.tanggal >= filterStartDate && l.tanggal <= filterEndDate);

    // 2. Group by Date -> Shift -> Technician
    const dateGroups: Record<string, Record<string, Record<string, {
      nama: string;
      categories: Record<string, number>;
    }>>> = {};

    filteredLogs.forEach(log => {
      const { tanggal, shift, nik, nama_technician, kategori_code, duration_minutes } = log;
      
      const techKey = nik ? String(nik).trim() : String(nama_technician).toLowerCase().trim();

      if (filterDivisi) {
         const techUser = users.find(u => (u.nik && u.nik === techKey) || u.name.toLowerCase() === techKey || u.id === techKey);
         if (!techUser || (techUser.divisi || '-') !== filterDivisi) return;
      }

      if (!dateGroups[tanggal]) dateGroups[tanggal] = {};
      if (!dateGroups[tanggal][shift]) dateGroups[tanggal][shift] = {};
      
      if (!dateGroups[tanggal][shift][techKey]) {
        dateGroups[tanggal][shift][techKey] = {
           nama: String(nama_technician).trim(),
           categories: {}
        };
      }
      
      const catCode = String(kategori_code || '').trim().toUpperCase();
      let mins = Number(String(duration_minutes || '0').replace(',', '.'));
      
      if (log.start_time && log.finish_time) {
        const startParts = log.start_time.split(':').map(Number);
        const finishParts = log.finish_time.split(':').map(Number);
        if (startParts.length === 2 && finishParts.length === 2 && !isNaN(startParts[0]) && !isNaN(finishParts[0])) {
           let startMins = startParts[0] * 60 + startParts[1];
           let finishMins = finishParts[0] * 60 + finishParts[1];
           if (finishMins <= startMins) finishMins += 24 * 60;
           mins = finishMins - startMins;
        }
      }

      if (!dateGroups[tanggal][shift][techKey].categories[catCode]) {
        dateGroups[tanggal][shift][techKey].categories[catCode] = 0;
      }
      dateGroups[tanggal][shift][techKey].categories[catCode] += mins / 60;
    });

    const dates = Object.keys(dateGroups).sort();
    
    const result: {
       tanggal: string;
       shifts: {
          shift: string;
          technicians: {
             id: string;
             nama: string;
             p1: number; p2: number; p3: number; p4: number;
             d1: number; d2: number; d3: number; d4: number; d5: number;
             b: number;
             totalTerlapor: number;
             totalEfektif: number;
             utilization: number;
             efektivitas: number;
             delayRatio: number;
          }[];
       }[];
    }[] = [];

    // Magic Numbers from Excel
    const JAM_TERJADWAL = 9.00;
    const BREAK_MANUAL = 1.15;
    const TOTAL_EFEKTIF = JAM_TERJADWAL - BREAK_MANUAL; // 7.85

    dates.forEach(tanggal => {
       const shiftKeys = Object.keys(dateGroups[tanggal]).sort();
       
       const shifts = shiftKeys.map(shift => {
          const techMap = dateGroups[tanggal][shift];
          const techKeys = Object.keys(techMap).sort((a, b) => techMap[a].nama.localeCompare(techMap[b].nama));
          
          const technicians = techKeys.map(key => {
             const tech = techMap[key];
             const cat = tech.categories;
             
             const p1 = cat['P1'] || 0;
             const p2 = cat['P2'] || 0;
             const p3 = cat['P3'] || 0;
             const p4 = cat['P4'] || 0;
             
             const d1 = cat['D1'] || 0;
             const d2 = cat['D2'] || 0;
             const d3 = cat['D3'] || 0;
             const d4 = cat['D4'] || 0;
             const d5 = cat['D5'] || 0;
             
             const b = cat['B'] || 0;
             
             const totalTerlapor = p1 + p2 + p3 + p4 + d1 + d2 + d3 + d4 + d5 + b;
             
             // Calculations based on the Excel logic
             const utilization = (TOTAL_EFEKTIF / JAM_TERJADWAL) * 100; // In the image it's always 87.22% assuming 7.85/9.0
             const efektivitas = (p1 / TOTAL_EFEKTIF) * 100;
             const delayRatio = ((d1+d2+d3+d4+d5+b) / TOTAL_EFEKTIF) * 100;
             
             return {
                id: key,
                nama: tech.nama,
                p1, p2, p3, p4,
                d1, d2, d3, d4, d5,
                b,
                totalTerlapor,
                totalEfektif: TOTAL_EFEKTIF,
                utilization,
                efektivitas,
                delayRatio
             };
          });
          
          return { shift, technicians };
       });

       result.push({ tanggal, shifts });
    });

    return { groupedByDate: result };
  }, [logs, filterStartDate, filterEndDate, filterDivisi, users]);

  const handleExport = () => {
    if (groupedByDate.length === 0) {
      alert("Tidak ada data resume untuk diekspor.");
      return;
    }

    const rows: any[][] = [];
    rows.push(['Resume Daily Activity - Detailed', '', '', '', '', '', '']);
    rows.push([]);
    rows.push(['Tanggal', 'Shift', 'Nama Technician', 'P1', 'P2', 'P3', 'P4', 'D1', 'D2', 'D3', 'D4', 'D5', 'B', 'Total Terlapor', 'Total Efektif', 'Utilization (%)', 'Efektivitas (%)', 'Delay Ratio (%)']);

    groupedByDate.forEach(dateGroup => {
       dateGroup.shifts.forEach((s) => {
          s.technicians.forEach((tech, tIdx) => {
              rows.push([
                 tIdx === 0 ? dateGroup.tanggal : '', 
                 tIdx === 0 ? s.shift : '',
                 tech.nama,
                 tech.p1 > 0 ? tech.p1.toFixed(2) : '0.00',
                 tech.p2 > 0 ? tech.p2.toFixed(2) : '0.00',
                 tech.p3 > 0 ? tech.p3.toFixed(2) : '0.00',
                 tech.p4 > 0 ? tech.p4.toFixed(2) : '0.00',
                 tech.d1 > 0 ? tech.d1.toFixed(2) : '0.00',
                 tech.d2 > 0 ? tech.d2.toFixed(2) : '0.00',
                 tech.d3 > 0 ? tech.d3.toFixed(2) : '0.00',
                 tech.d4 > 0 ? tech.d4.toFixed(2) : '0.00',
                 tech.d5 > 0 ? tech.d5.toFixed(2) : '0.00',
                 tech.b > 0 ? tech.b.toFixed(2) : '0.00',
                 tech.totalTerlapor.toFixed(2),
                 tech.totalEfektif.toFixed(2),
                 tech.utilization.toFixed(2) + '%',
                 tech.efektivitas.toFixed(2) + '%',
                 tech.delayRatio.toFixed(2) + '%'
              ]);
          });
       });
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 15 }, { wch: 10 }, { wch: 25 }, 
      { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, 
      { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
    ];

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_cell({ c: C, r: R });
        if (!ws[address]) continue;
        
        if (R === 2) {
           ws[address].s = { 
               font: { bold: true, color: { rgb: "FFFFFF" } },
               fill: { fgColor: { rgb: "143C68" } },
               alignment: { horizontal: "center", vertical: "center", wrapText: true },
               border: { top: { style: "thin", color: { auto: 1 } }, bottom: { style: "thin", color: { auto: 1 } }, left: { style: "thin", color: { auto: 1 } }, right: { style: "thin", color: { auto: 1 } } }
           };
        } else if (R > 2) {
           ws[address].s = {
               border: { top: { style: "hair", color: { auto: 1 } }, bottom: { style: "hair", color: { auto: 1 } }, left: { style: "hair", color: { auto: 1 } }, right: { style: "hair", color: { auto: 1 } } }
           };
           // Align numbers to the right
           if (C >= 3) {
             if (ws[address].s) ws[address].s.alignment = { horizontal: "right" };
           }
        }
        
        if (R === 0) ws[address].s = { font: { bold: true, sz: 14 } };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resume");
    XLSX.writeFile(wb, `Resume_Daily_Activity_${filterStartDate}_${filterEndDate}.xlsx`);
  };

  return (
    <div className="flex-1 flex flex-col items-center overflow-y-auto w-full max-w-full p-4 lg:p-6">
      <div className="bg-white w-full max-w-[1400px] rounded-lg shadow-sm border border-slate-200">
        <div className="p-4 sm:p-6 border-b border-slate-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-[#143c68] flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6" /> Resume Daily Activity
            </h2>
            
            <button 
              onClick={handleExport}
              className="flex items-center justify-center gap-2 text-sm font-bold text-white bg-indigo-600 px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors shadow-sm w-full sm:w-auto"
            >
              <Download className="w-4 h-4" /> Export Resume
            </button>
          </div>
          
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 w-full mb-2">
              <div className="flex items-center gap-2 w-full lg:w-auto">
                <select
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-[#143c68] outline-none"
                  value={filterDivisi}
                  onChange={e => onDivisiChange?.(e.target.value)}
                >
                  <option value="">Semua Divisi</option>
                  {/* Dulu enam <option> tetap, tersalin di lima berkas.
                      Sekarang dari /api/master/divisions. */}
                  {divisions.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
                <input 
                  type="date" 
                  value={filterStartDate}
                  onChange={(e) => {
                    const newStartDate = e.target.value;
                    const start = new Date(newStartDate);
                    const maxEnd = new Date(start);
                    maxEnd.setDate(start.getDate() + 31);
                    const currentEnd = new Date(filterEndDate);
                    
                    if (currentEnd > maxEnd) {
                      onEndDateChange(maxEnd.toISOString().split('T')[0]);
                    } else if (currentEnd < start) {
                      onEndDateChange(newStartDate);
                    }
                    onStartDateChange(newStartDate);
                  }}
                  className="flex-1 lg:flex-none px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium focus:ring-2 focus:ring-[#143c68] outline-none cursor-pointer min-w-0"
                />
                <span className="text-sm font-bold text-slate-500 shrink-0">s/d</span>
                <input 
                  type="date" 
                  value={filterEndDate}
                  min={filterStartDate}
                  onChange={(e) => {
                    const newEndDate = e.target.value;
                    const start = new Date(filterStartDate);
                    const end = new Date(newEndDate);
                    const maxEnd = new Date(start);
                    maxEnd.setDate(start.getDate() + 31);
                    
                    if (end > maxEnd) {
                      alert("Maksimal rentang waktu adalah 31 hari.");
                      return;
                    }
                    onEndDateChange(newEndDate);
                  }}
                  className="flex-1 lg:flex-none px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium focus:ring-2 focus:ring-[#143c68] outline-none cursor-pointer min-w-0"
                />
              </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-x-auto w-full">
          <table className="w-full text-xs text-left border-collapse border border-slate-300 rounded-md whitespace-nowrap min-w-[1200px]">
            <thead className="text-[10px] text-slate-700 uppercase bg-slate-100 border-b border-slate-300">
              <tr>
                <th className="px-3 py-2 border border-slate-300 font-bold text-slate-800 text-center" rowSpan={2}>Tanggal</th>
                <th className="px-3 py-2 border border-slate-300 font-bold text-slate-800 text-center" rowSpan={2}>Shift</th>
                <th className="px-3 py-2 border border-slate-300 font-bold text-slate-800 text-center" rowSpan={2}>Nama Technician</th>
                <th className="px-3 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50" colSpan={10}>Kategori</th>
                <th className="px-3 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-emerald-50" colSpan={5}>KPI</th>
              </tr>
              <tr>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">P1</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">P2</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">P3</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">P4</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">D1</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">D2</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">D3</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">D4</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-blue-50/50">D5</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-slate-200">B</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-emerald-50/50">Total Jam<br/>Terlapor</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-emerald-50/50">Total Jam<br/>Efektif</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-emerald-50/50">Utilization</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-emerald-50/50">Efektivitas<br/>Personil</th>
                <th className="px-2 py-2 border border-slate-300 font-bold text-slate-800 text-center bg-emerald-50/50">Delay Ratio</th>
              </tr>
            </thead>
            <tbody>
              {false ? (
                <tr>
                  <td colSpan={18} className="py-8 text-center bg-white">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Loader2 className="w-8 h-8 animate-spin text-[#143c68] mb-4" />
                      <p>Memuat resume aktivitas...</p>
                    </div>
                  </td>
                </tr>
              ) : groupedByDate.length === 0 ? (
                <tr>
                  <td colSpan={18} className="py-8 text-center text-slate-500 border border-slate-300 bg-white">
                    Tidak ada data aktivitas untuk rentang tanggal ini.
                  </td>
                </tr>
              ) : (
                <>
                  {groupedByDate.map((dateGroup, dateIdx) => {
                     // Count total technicians in this date to rowspan the Date column
                     const totalTechsInDate = dateGroup.shifts.reduce((acc, s) => acc + s.technicians.length, 0);
                     
                     return dateGroup.shifts.map((s, shiftIdx) => {
                        return s.technicians.map((tech, tIdx) => {
                           const isFirstOfDate = (shiftIdx === 0 && tIdx === 0);
                           const isFirstOfShift = (tIdx === 0);

                           const getColorClass = (val: number) => val > 0 ? 'text-emerald-700 font-medium' : 'text-slate-400';
                           const getDelayColorClass = (val: number) => val > 0 ? 'text-amber-700 font-medium' : 'text-slate-400';

                           return (
                             <tr key={`${dateGroup.tanggal}_${s.shift}_${tech.id}_${dateIdx}_${shiftIdx}_${tIdx}`} className="border-b border-slate-300 bg-white hover:bg-slate-50 transition-colors">
                               {isFirstOfDate && (
                                  <td rowSpan={totalTechsInDate} className="px-3 py-2 font-medium text-slate-900 border border-slate-300 align-top bg-white whitespace-nowrap">
                                     {dateGroup.tanggal}
                                  </td>
                               )}
                               {isFirstOfShift && (
                                  <td rowSpan={s.technicians.length} className="px-3 py-2 border border-slate-300 font-medium text-slate-700 align-top bg-white whitespace-nowrap">
                                     {s.shift}
                                  </td>
                               )}
                               <td className="px-3 py-2 border border-slate-300 text-slate-700 whitespace-nowrap">{tech.nama}</td>
                               
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getColorClass(tech.p1)}`}>{tech.p1 > 0 ? tech.p1.toFixed(2) : '0,00'}</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getColorClass(tech.p2)}`}>{tech.p2 > 0 ? tech.p2.toFixed(2) : '0,00'}</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getColorClass(tech.p3)}`}>{tech.p3 > 0 ? tech.p3.toFixed(2) : '0,00'}</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getColorClass(tech.p4)}`}>{tech.p4 > 0 ? tech.p4.toFixed(2) : '0,00'}</td>
                               
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getDelayColorClass(tech.d1)}`}>{tech.d1 > 0 ? tech.d1.toFixed(2) : '0,00'}</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getDelayColorClass(tech.d2)}`}>{tech.d2 > 0 ? tech.d2.toFixed(2) : '0,00'}</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getDelayColorClass(tech.d3)}`}>{tech.d3 > 0 ? tech.d3.toFixed(2) : '0,00'}</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getDelayColorClass(tech.d4)}`}>{tech.d4 > 0 ? tech.d4.toFixed(2) : '0,00'}</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono ${getDelayColorClass(tech.d5)}`}>{tech.d5 > 0 ? tech.d5.toFixed(2) : '0,00'}</td>
                               
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono bg-slate-50 ${getColorClass(tech.b)}`}>{tech.b > 0 ? tech.b.toFixed(2) : '0,00'}</td>
                               
                               <td className="px-2 py-2 text-right border border-slate-300 font-mono font-medium text-slate-800">{tech.totalTerlapor.toFixed(2)}</td>
                               <td className="px-2 py-2 text-right border border-slate-300 font-mono font-medium text-slate-800">{tech.totalEfektif.toFixed(2)}</td>
                               
                               <td className="px-2 py-2 text-right border border-slate-300 font-mono font-medium text-[#143c68]">{tech.utilization.toFixed(2)}%</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono font-medium ${tech.efektivitas >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>{tech.efektivitas.toFixed(2)}%</td>
                               <td className={`px-2 py-2 text-right border border-slate-300 font-mono font-medium ${tech.delayRatio > 20 ? 'text-rose-600' : 'text-slate-700'}`}>{tech.delayRatio.toFixed(2)}%</td>
                             </tr>
                           );
                        });
                     });
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

