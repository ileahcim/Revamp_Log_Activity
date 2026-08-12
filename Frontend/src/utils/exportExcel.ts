import * as XLSX from 'xlsx-js-style';
import { LogActivity } from '../types';
import { User } from './auth';

export const exportToExcel = (headers: string[], rows: any[][], filename: string) => {
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths definition to match the mockup roughly
  const colWidths = [
    { wch: 12 }, // Tanggal
    { wch: 25 }, // Nama Technician (Note: adjust order based on calling function)
    { wch: 15 }, // NIK
    { wch: 20 }, // Supervisor
    { wch: 10 }, // Shift
    { wch: 12 }, // WO/Notif
    { wch: 12 }, // Asset/Tag
    { wch: 12 }, // Party
    { wch: 12 }, // SN
    { wch: 45 }, // Deskripsi Pekerjaan (Wide + Wrap)
    { wch: 12 }, // Kategori
    { wch: 10 }, // Start
    { wch: 10 }, // Finish
    { wch: 12 }, // Durasi
    { wch: 10 }, // Status
    { wch: 12 }, // Delay Code
    { wch: 12 }, // Output
    { wch: 35 }, // Catatan (Wide + Wrap)
  ];
  ws['!cols'] = colWidths;

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const address = XLSX.utils.encode_cell({ c: C, r: R });
      if (!ws[address]) continue;

      if (R === 0) {
        // Header Row Styling
        ws[address].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "143C68" } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: {
             bottom: { style: "thin", color: { auto: 1 } },
             top: { style: "thin", color: { auto: 1 } },
             left: { style: "thin", color: { auto: 1 } },
             right: { style: "thin", color: { auto: 1 } }
          }
        };
      } else {
        // Data Row Styling
        // Column H (Deskripsi, index 7) and P (Catatan, index 15) wrap text
        const shouldWrap = (C === 9 || C === 17); // Fixed index based on new columns
        let style: any = {
          alignment: { 
             vertical: "top", 
             wrapText: shouldWrap 
          },
          border: {
             bottom: { style: "hair", color: { auto: 1 } },
             top: { style: "hair", color: { auto: 1 } },
             left: { style: "hair", color: { auto: 1 } },
             right: { style: "hair", color: { auto: 1 } }
          }
        };
        if (C === 13) style.numFmt = "0.00";
        if (C === 16) style.numFmt = "0";
        ws[address].s = style;
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Log Detail");
  XLSX.writeFile(wb, filename);
};

/**
 * @param kategoriCodes Record<code, name> dari MasterDataProvider -- lihat
 *   catatan yang sama di exportExcelFormula.ts.
 *
 * Belum punya pemanggil sejak handleExportAll dihapus dari App.tsx; tombol
 * "Export All Reports" memakai exportMegaReport lewat GlobalExportModal.
 */
export const exportAllReportsToExcel = (
  logs: LogActivity[],
  user: User,
  targetNik: string,
  summaryDate: string,
  kategoriCodes: Record<string, string>,
  onShowToast?: (m:string)=>void
) => {
  const KATEGORI_CODES = kategoriCodes;
  if (logs.length === 0) {
    if(onShowToast) onShowToast("Tidak ada data untuk diekspor");
    return;
  }

  const wb = XLSX.utils.book_new();

  // --- 1. SHEET LOG ---
  const headers = ['Tanggal', 'Nama Technician', 'NIK', 'Supervisor', 'Shift', 'Party', 'WO/Notif', 'Asset/Tag', 'SN', 'Deskripsi Pekerjaan', 'Kategori (Code)', 'Start', 'Finish', 'Durasi (jam)', 'Status', 'Delay Code', 'Output qty', 'Catatan'];
  const sortedData = [...logs].sort((a, b) => {
    const dateCompare = a.tanggal.localeCompare(b.tanggal);
    if (dateCompare !== 0) return dateCompare;
    return a.start_time.localeCompare(b.start_time);
  });
  const logRows = sortedData.map(l => [
      l.tanggal, l.nama_technician, l.nik, l.supervisor, l.shift, l.party, l.wo_notif, l.asset_tag, l.sn, l.deskripsi_pekerjaan, l.kategori_code, l.start_time, l.finish_time, l.duration_minutes / 60, l.status, l.delay_code, l.output_qty, l.catatan
  ]);
  const wsLogData = [headers, ...logRows];
  const wsLog = XLSX.utils.aoa_to_sheet(wsLogData);

  wsLog['!cols'] = [
    { wch: 12 }, { wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 45 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 35 }
  ];
  wsLog['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: wsLogData.length - 1, c: headers.length - 1 } }) };

  const rangeLog = XLSX.utils.decode_range(wsLog['!ref'] || 'A1');
  for (let R = rangeLog.s.r; R <= rangeLog.e.r; ++R) {
    for (let C = rangeLog.s.c; C <= rangeLog.e.c; ++C) {
      const address = XLSX.utils.encode_cell({ c: C, r: R });
      if (!wsLog[address]) continue;
      if (R === 0) {
        wsLog[address].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "143C68" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: { bottom: { style: "thin", color: { auto: 1 } }, top: { style: "thin", color: { auto: 1 } }, left: { style: "thin", color: { auto: 1 } }, right: { style: "thin", color: { auto: 1 } } } };
      } else {
        const shouldWrap = (C === 9 || C === 17);
        let style: any = { alignment: { vertical: "top", wrapText: shouldWrap }, border: { bottom: { style: "hair", color: { auto: 1 } }, top: { style: "hair", color: { auto: 1 } }, left: { style: "hair", color: { auto: 1 } }, right: { style: "hair", color: { auto: 1 } } } };
        if (C === 13) style.numFmt = "0.00";
        if (C === 16) style.numFmt = "0";
        wsLog[address].s = style;
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, wsLog, "Log");

  // --- 2. SHEET SUMMARY ---
  const filteredForSummary = logs.filter(l => {
     if (l.tanggal !== summaryDate) return false;
     
     if (user.role === 'karyawan') {
        const key = l.nik || l.nama_technician.toLowerCase();
        return key === (user.nik || user.name.toLowerCase());
     }
     if (targetNik === '') return true;
     const key = l.nik || l.nama_technician.toLowerCase();
     return key === targetNik;
  });

  const categoryTotals: Record<string, number> = {};
  Object.keys(KATEGORI_CODES).forEach(k => categoryTotals[k] = 0);
  filteredForSummary.forEach(l => { categoryTotals[l.kategori_code] = (categoryTotals[l.kategori_code] || 0) + l.duration_minutes; });

  const formatHours = (minutes: number) => Number((minutes / 60).toFixed(2));
  const breakMinutes = categoryTotals['B'] || 0;
  const totalLoggedMinutes = (Object.values(categoryTotals) as number[]).reduce((a, b) => a + b, 0);

  const uniqueTechDays = new Set(filteredForSummary.map(l => `${l.tanggal}_${l.nik || l.nama_technician}`)).size;
  const manualBreakMinutes = uniqueTechDays * 1.15 * 60; // Fixed 1.15 hrs
  const jamTerjadwalMinutes = uniqueTechDays * 9 * 60;
  const totalJamEfektif = jamTerjadwalMinutes - manualBreakMinutes;
  const p1Minutes = categoryTotals['P1'] || 0;
  const delayMinutes = Object.entries(categoryTotals).filter(([code]) => code.startsWith('D')).reduce((sum, [_, mins]) => sum + (mins as number), 0);

  const utilization = jamTerjadwalMinutes > 0 ? (totalJamEfektif / jamTerjadwalMinutes) * 100 : 0;
  const wrenchTimeRatio = totalJamEfektif > 0 ? (p1Minutes / totalJamEfektif) * 100 : 0;
  const delayRatio = totalJamEfektif > 0 ? (delayMinutes / totalJamEfektif) * 100 : 0;

  const woDone = filteredForSummary.filter(l => l.status?.toLowerCase() === 'done').length;
  const woOngoing = filteredForSummary.filter(l => l.status?.toLowerCase() === 'ongoing').length;
  const woHold = filteredForSummary.filter(l => l.status?.toLowerCase() === 'hold').length;
  const totalOutputQty = filteredForSummary.reduce((sum, l) => sum + (l.output_qty || 0), 0);
  const outputRate = totalJamEfektif > 0 ? totalOutputQty / (totalJamEfektif / 60) : 0;

  let selectedTechName = 'None';
  if(user.role === 'karyawan') {
     selectedTechName = user.name;
  } else if (targetNik !== '') {
     const t = logs.find(l => (l.nik || l.nama_technician.toLowerCase()) === targetNik);
     if(t) selectedTechName = t.nama_technician;
     else selectedTechName = targetNik;
  }

  const selectedShift = filteredForSummary.length > 0 ? filteredForSummary[0].shift : '-';

  const sumRows: any[][] = [];
  sumRows.push(['Form Productivity Technician - Harian (Summary)', '', '']);
  sumRows.push([]);
  sumRows.push(['Tanggal', summaryDate, '']);
  sumRows.push(['Nama Technician', selectedTechName, '']);
  sumRows.push(['Shift', selectedShift, '']);
  sumRows.push(['Jam Terjadwal', Number((jamTerjadwalMinutes / 60).toFixed(2)), '']);
  sumRows.push(['Break (B) manual', Number((manualBreakMinutes / 60).toFixed(2)), '']);
  sumRows.push([]);
  sumRows.push(['Rekap Jam (otomatis dari Sheet Log)', '', '']);
  sumRows.push(['Kategori', 'Jam', '']);
  Object.entries(KATEGORI_CODES).forEach(([code, label]) => {
      sumRows.push([`${code} - ${label}`, formatHours(categoryTotals[code] || 0), '']);
  });
  sumRows.push([]);
  sumRows.push(['Total jam terlapor (otomatis)', formatHours(totalLoggedMinutes), '']);
  sumRows.push(['Total jam efektif (Jam Terjadwal - Break)', formatHours(totalJamEfektif), '']);
  sumRows.push([]);
  sumRows.push(['KPI Harian', '', '']);
  sumRows.push(['KPI', 'Nilai', '']);
  sumRows.push(['Utilization', `${utilization.toFixed(2)}%`, '']);
  sumRows.push(['Wrench Time Ratio', `${wrenchTimeRatio.toFixed(2)}%`, '']);
  sumRows.push(['Delay Ratio', `${delayRatio.toFixed(2)}%`, '']);
  sumRows.push([]);
  sumRows.push(['Output / WO', '', '']);
  sumRows.push(['WO/Job Done (count)', woDone, '']);
  sumRows.push(['WO/Job Ongoing (count)', woOngoing, '']);
  sumRows.push(['WO/Job Hold (count)', woHold, '']);
  sumRows.push(['Total Output Qty', totalOutputQty, '']);
  sumRows.push(['Output Rate (Qty per jam efektif)', Number(outputRate.toFixed(2)), '']);

  const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
  wsSum['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  wsSum['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 20 }];
  
  const rangeSum = XLSX.utils.decode_range(wsSum['!ref'] || 'A1');
  for (let R = rangeSum.s.r; R <= rangeSum.e.r; ++R) {
    for (let C = rangeSum.s.c; C <= rangeSum.e.c; ++C) {
      const address = XLSX.utils.encode_cell({ c: C, r: R });
      if (!wsSum[address]) continue;
      const val = String(wsSum[address].v);
      let style: any = { font: { name: "Arial", sz: 11 } };
      if (R === 0) { style.font = { name: "Arial", sz: 14, bold: true, color: { rgb: "00529B" } }; } 
      else if (val.includes("Rekap Jam (otomatis") || val === "KPI Harian" || val === "Output / WO") { style.font = { name: "Arial", sz: 11, bold: true, color: { rgb: "00529B" } }; }
      else if (val === "Kategori" || val === "Jam" || val === "KPI" || val === "Nilai") {
         style.font = { name: "Arial", sz: 11, bold: true, color: { rgb: "FFFFFF" } }; style.fill = { fgColor: { rgb: "143C68" } }; style.alignment = { horizontal: "center" };
         style.border = { top: { style: "thin", color: { auto: 1 } }, bottom: { style: "thin", color: { auto: 1 } }, left: { style: "thin", color: { auto: 1 } }, right: { style: "thin", color: { auto: 1 } } };
      } 
      else if ((R >= 10 && R <= 19) || (R >= 26 && R <= 28) || (R >= 31 && R <= 35) || R === 23 || R === 24 || R === 38 || R === 39) {
         style.border = { top: { style: "hair", color: { auto: 1 } }, bottom: { style: "hair", color: { auto: 1 } }, left: { style: "hair", color: { auto: 1 } }, right: { style: "hair", color: { auto: 1 } } };
         if (C === 0 && (val.includes("Total jam") || val.includes("Total Output") || val.includes("Output Rate"))) { style.font = { name: "Arial", sz: 11, bold: true }; }
         if(C === 1 && (R === 26 || R === 27 || R === 28)){ style.alignment = { horizontal: "right" }; }
      }
      if (C === 0 && (val === "Tanggal" || val === "Nama Technician" || val === "Shift" || val === "Jam Terjadwal" || val === "Break (B) manual" || val.includes("Total jam") || val === "Total Output Qty" || val === "Output Rate (Qty per jam efektif)" || val === "Safety Score" || val === "Quality Score")) {
         style.font = { name: "Arial", sz: 11, bold: true };
      }
      wsSum[address].s = style;
    }
  }
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  // --- 3. SHEET RESUME ---
  const groups: Record<string, { tanggal: string; shift: string; uniqueMeds: Set<string>; wrenchTimeMins: number; delayTimeMins: number; breakTimeMins: number; }> = {};
  logs.forEach(log => {
      const { tanggal, shift, nik, nama_technician, kategori_code, duration_minutes } = log;
      const key = `${tanggal}_${shift}`;
      if (!groups[key]) { groups[key] = { tanggal, shift, uniqueMeds: new Set(), wrenchTimeMins: 0, delayTimeMins: 0, breakTimeMins: 0 }; }
      const techKey = nik || nama_technician.toLowerCase();
      groups[key].uniqueMeds.add(techKey);
      if (kategori_code === 'P1') { groups[key].wrenchTimeMins += duration_minutes; } 
      else if (kategori_code.startsWith('D')) { groups[key].delayTimeMins += duration_minutes; }
      else if (kategori_code === 'B') { groups[key].breakTimeMins += duration_minutes; }
  });

  const resumeData = Object.values(groups).map(group => {
      const jamTerjadwalMins = group.uniqueMeds.size * 9 * 60;
      const manualBreakMins = group.uniqueMeds.size * 1.15 * 60;
      const totalAvailableMins = jamTerjadwalMins - manualBreakMins;
      
      const totalLoggedMins = group.wrenchTimeMins + group.delayTimeMins + group.breakTimeMins;
      const wrenchRatio = totalAvailableMins > 0 ? (group.wrenchTimeMins / totalAvailableMins) * 100 : 0;
      const delayRatio = totalAvailableMins > 0 ? (group.delayTimeMins / totalAvailableMins) * 100 : 0;
      return {
        tanggal: group.tanggal, shift: group.shift, wrenchTime: Number((group.wrenchTimeMins / 60).toFixed(2)),
        delayTime: Number((group.delayTimeMins / 60).toFixed(2)), availableTime: Number((totalAvailableMins / 60).toFixed(2)),
        wrenchRatio: Number(wrenchRatio.toFixed(2)), delayRatio: Number(delayRatio.toFixed(2)), mechanicsCount: group.uniqueMeds.size,
      };
  }).sort((a, b) => {
      if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
      return a.shift.localeCompare(b.shift);
  });

  const resRows: any[][] = [];
  const resHeaders = ['Tanggal', 'Shift', 'Wrench Time (P1)', 'Delay Time (D1-D5)', 'Total Available Time', 'Wrench Time Ratio (%)', 'Waste/Delay Time Ratio (%)'];
  resRows.push(['Resume Daily Activity', '', '', '', '', '', '']);
  resRows.push([]);
  resRows.push(resHeaders);
  resumeData.forEach(r => {
      resRows.push([ r.tanggal, r.shift, r.wrenchTime, r.delayTime, r.availableTime, r.wrenchRatio, r.delayRatio ]);
  });

  const wsRes = XLSX.utils.aoa_to_sheet(resRows);
  wsRes['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
  wsRes['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 25 }, { wch: 25 }, { wch: 30 }];
  wsRes['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: resRows.length - 1, c: resHeaders.length - 1 } }) };

  const rangeRes = XLSX.utils.decode_range(wsRes['!ref'] || 'A1');
  for (let R = rangeRes.s.r; R <= rangeRes.e.r; ++R) {
    for (let C = rangeRes.s.c; C <= rangeRes.e.c; ++C) {
      const address = XLSX.utils.encode_cell({ c: C, r: R });
      if (!wsRes[address]) continue;
      if (R === 2) {
         wsRes[address].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "143C68" } }, alignment: { horizontal: "center" }, border: { top: { style: "thin", color: { auto: 1 } }, bottom: { style: "thin", color: { auto: 1 } }, left: { style: "thin", color: { auto: 1 } }, right: { style: "thin", color: { auto: 1 } } } };
      } else if (R > 2) {
         wsRes[address].s = { border: { top: { style: "hair", color: { auto: 1 } }, bottom: { style: "hair", color: { auto: 1 } }, left: { style: "hair", color: { auto: 1 } }, right: { style: "hair", color: { auto: 1 } } } };
      } else if (R === 0) {
         wsRes[address].s = { font: { bold: true, sz: 14 } };
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, wsRes, "Resume");

  XLSX.writeFile(wb, "TechLog_All_Reports.xlsx");
  if(onShowToast) onShowToast("Export 3 Sheet Berhasil Dibuat");
};

