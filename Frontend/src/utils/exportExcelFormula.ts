import * as XLSX from 'xlsx-js-style';
import { LogActivity } from '../types';
import { User } from './auth';

/**
 * @param kategoriCodes Record<code, name> dari MasterDataProvider. Dioper
 *   sebagai argumen, bukan diimpor: berkas ini bukan komponen React sehingga
 *   tidak bisa memakai hook, dan mengimpornya kembali dari types.ts akan
 *   menghidupkan lagi daftar tetap yang baru saja dihapus.
 */
export const exportMegaReport = (
  logs: LogActivity[],
  startDate: string,
  endDate: string,
  user: User,
  kategoriCodes: Record<string, string>
) => {
  const KATEGORI_CODES = kategoriCodes;
  const wb = XLSX.utils.book_new();

  // --- 1. SHEET LOG_ACTIVITY ---
  const logHeaders = ['Tanggal', 'Nama Technician', 'NIK', 'Supervisor', 'Shift', 'Party', 'WO/Notif', 'Asset/Tag', 'SN', 'Deskripsi Pekerjaan', 'Kategori (Code)', 'Start', 'Finish', 'Durasi (jam)', 'Status', 'Delay Code', 'Output qty', 'Catatan'];
  
  const sortedData = [...logs].sort((a, b) => {
    const dateCompare = a.tanggal.localeCompare(b.tanggal);
    if (dateCompare !== 0) return dateCompare;
    return a.start_time.localeCompare(b.start_time);
  });
  
  const logRows = sortedData.map(l => {
      const rawDurasi = String(l.duration_minutes || '0').replace(',', '.');
      const durasiJam = Number(rawDurasi) / 60;
      const outputQty = Number(String(l.output_qty || '0').replace(',', '.'));
      
      return [
          l.tanggal, 
          (l.nama_technician || "").trim().toUpperCase(), 
          l.nik, 
          l.supervisor, 
          l.shift, 
          l.party, 
          l.wo_notif, 
          l.asset_tag, 
          l.sn, 
          l.deskripsi_pekerjaan, 
          (l.kategori_code || "").trim().toUpperCase(), 
          l.start_time, 
          l.finish_time, 
          { t: 'n', v: durasiJam }, 
          (l.status || "").trim(), 
          l.delay_code, 
          { t: 'n', v: outputQty }, 
          l.catatan
      ];
  });
  
  const wsLogData = [logHeaders, ...logRows];
  const wsLog = XLSX.utils.aoa_to_sheet(wsLogData);

  wsLog['!cols'] = [
    { wch: 12 }, { wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 45 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 35 }
  ];
  wsLog['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: wsLogData.length - 1, c: logHeaders.length - 1 } }) };

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
  XLSX.utils.book_append_sheet(wb, wsLog, "Log_Activity");

  // --- 2. SHEET SUMMARY_SYSTEM (Dynamic Formula) ---
  const sumRows: any[][] = [];
  
  sumRows.push(['Form Productivity Technician - Harian (Summary)', '', '']);
  sumRows.push([]);
  
  const initialDate = sortedData.length > 0 ? sortedData[0].tanggal : '';
  const initialTech = sortedData.length > 0 ? (sortedData[0].nama_technician || '').trim().toUpperCase() : '';
  const initialShift = sortedData.length > 0 ? sortedData[0].shift : '';
  
  const KATEGORI_ENTRIES = Object.entries(KATEGORI_CODES);

  sumRows.push(['Tanggal', initialDate, '']);
  sumRows.push(['Nama Technician', initialTech, '']);
  sumRows.push(['Shift', initialShift, '']);
  sumRows.push(['Jam Terjadwal', 9, '']);
  sumRows.push(['Break (B) manual', 1.15, '']);
  sumRows.push([]);
  sumRows.push(['Rekap Jam (otomatis dari Sheet Log)', '', '']);
  sumRows.push(['Kategori', 'Jam', '']);
  
  KATEGORI_ENTRIES.forEach(([code, label]) => {
      const f = `IF(OR($B$3="",$B$4=""),"",SUMIFS(Log_Activity!$N:$N,Log_Activity!$A:$A,$B$3,Log_Activity!$B:$B,$B$4,Log_Activity!$K:$K,"${code}"))`;
      sumRows.push([`${code} - ${label}`, { t: 'n', f }, '']);
  });
  
  sumRows.push([]);
  const rekapJamStartRow = 11;
  const rekapJamEndRow = 10 + KATEGORI_ENTRIES.length;
  sumRows.push(['Total jam terlapor (otomatis)', { t: 'n', f: `SUM(B${rekapJamStartRow}:B${rekapJamEndRow})` }, '']);
  sumRows.push(['Total jam efektif (Jam Terjadwal - Break)', { t: 'n', f: `B6-B7` }, '']);
  sumRows.push([]);
  
  sumRows.push(['KPI Harian', '', '']);
  sumRows.push(['KPI', 'Nilai', '']);
  sumRows.push(['Utilization', { t: 'n', f: `IF(B6>0,B23/B6,0)` }, '']);
  sumRows.push(['Wrench Time Ratio', { t: 'n', f: `IF(B23>0,B11/B23,0)` }, '']);
  
  const dStartIndex = KATEGORI_ENTRIES.findIndex(([code]) => code.startsWith('D'));
  let dEndIndex = -1;
  for (let i = KATEGORI_ENTRIES.length - 1; i >= 0; i--) {
    if (KATEGORI_ENTRIES[i][0].startsWith('D')) {
      dEndIndex = i;
      break;
    }
  }
  const delayRowExpr = dStartIndex >= 0 ? `SUM(B${rekapJamStartRow + dStartIndex}:B${rekapJamStartRow + dEndIndex})` : '0';
  
  sumRows.push(['Delay Ratio', { t: 'n', f: `IF(B23>0,${delayRowExpr}/B23,0)` }, '']);
  sumRows.push([]);
  
  sumRows.push(['Output / WO', '', '']);
  sumRows.push(['WO/Job Done (count)', { t: 'n', f: `IF(OR($B$3="",$B$4=""),"",COUNTIFS(Log_Activity!$A:$A,$B$3,Log_Activity!$B:$B,$B$4,Log_Activity!$O:$O,"Done"))` }, '']);
  sumRows.push(['WO/Job Ongoing (count)', { t: 'n', f: `IF(OR($B$3="",$B$4=""),"",COUNTIFS(Log_Activity!$A:$A,$B$3,Log_Activity!$B:$B,$B$4,Log_Activity!$O:$O,"Ongoing"))` }, '']);
  sumRows.push(['WO/Job Hold (count)', { t: 'n', f: `IF(OR($B$3="",$B$4=""),"",COUNTIFS(Log_Activity!$A:$A,$B$3,Log_Activity!$B:$B,$B$4,Log_Activity!$O:$O,"Hold"))` }, '']);
  sumRows.push(['Total Output Qty', { t: 'n', f: `IF(OR($B$3="",$B$4=""),"",SUMIFS(Log_Activity!$Q:$Q,Log_Activity!$A:$A,$B$3,Log_Activity!$B:$B,$B$4))` }, '']);
  sumRows.push(['Output Rate (Qty per jam efektif)', { t: 'n', f: `IF(B23>0,B35/B23,0)` }, '']);
  
  const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
  wsSum['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  wsSum['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 20 }];
  
  const sumRange = XLSX.utils.decode_range(wsSum['!ref'] || 'A1');
  for (let R = sumRange.s.r; R <= sumRange.e.r; ++R) {
    for (let C = sumRange.s.c; C <= sumRange.e.c; ++C) {
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
      else {
         style.border = { top: { style: "hair", color: { auto: 1 } }, bottom: { style: "hair", color: { auto: 1 } }, left: { style: "hair", color: { auto: 1 } }, right: { style: "hair", color: { auto: 1 } } };
      }
      
      if ((R === 26 || R === 27 || R === 28) && C === 1) {
         style.numFmt = "0.00%";
         style.alignment = { horizontal: "right" };
      } else if (typeof wsSum[address].v === 'number' || wsSum[address].f) {
         if (C === 1 && R !== 31 && R !== 32 && R !== 33 && R !== 34) { 
             style.numFmt = "0.00"; 
             style.alignment = { horizontal: "right" };
         } else if (C === 1) {
             style.numFmt = "0";
             style.alignment = { horizontal: "right" };
         }
      }
      
      if (C === 1 && (R === 2 || R === 3 || R === 4 || R === 5 || R === 6 || R >= 38)) {
         style.fill = { fgColor: { rgb: "FFFFCC" } };
      }

      wsSum[address].s = style;
    }
  }

  XLSX.utils.book_append_sheet(wb, wsSum, "Summary_System");

  // --- 3. SHEET RESUME_DAILY ---
  const dateGroups: Record<string, Record<string, Record<string, {
    nama: string;
    categories: Record<string, number>;
  }>>> = {};

  sortedData.forEach(l => {
    const { tanggal, shift, nik, nama_technician, kategori_code, duration_minutes } = l;
    if (!dateGroups[tanggal]) dateGroups[tanggal] = {};
    if (!dateGroups[tanggal][shift]) dateGroups[tanggal][shift] = {};
    
    const techKey = nik || nama_technician.toLowerCase();
    
    if (!dateGroups[tanggal][shift][techKey]) {
      dateGroups[tanggal][shift][techKey] = {
         nama: nama_technician,
         categories: {}
      };
    }
    
    if (!dateGroups[tanggal][shift][techKey].categories[kategori_code]) {
      dateGroups[tanggal][shift][techKey].categories[kategori_code] = 0;
    }
    const safeDuration = parseFloat(String(duration_minutes)) || 0;
    dateGroups[tanggal][shift][techKey].categories[kategori_code] += (safeDuration / 60);
  });

  const resRows: any[][] = [];
  resRows.push(['Form Productivity Technician - Harian (Summary)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  resRows.push([]);
  
  // Header Grouping row
  resRows.push([
     '', '', '', '', 
     'Kategori', '', '', '', '', '', '', '', '', '',
     'KPI', '', '', '', '', ''
  ]);
  
  // Header Columns row
  const headers = ['No', 'Nama', 'Tanggal', 'Shift', 'P1', 'P2', 'P3', 'P4', 'D1', 'D2', 'D3', 'D4', 'D5', 'B', 'Total jam terlapor', 'Total jam efektif', 'Utilization', 'Efektivitas personil', 'Delay Ratio', 'Ket'];
  resRows.push(headers);

  const JAM_TERJADWAL = 9.00;
  const BREAK_MANUAL = 1.15;
  const TOTAL_EFEKTIF = JAM_TERJADWAL - BREAK_MANUAL;

  let rowCount = 1;
  const dates = Object.keys(dateGroups).sort();
  dates.forEach(tanggal => {
      const shiftsArr = Object.keys(dateGroups[tanggal]).sort();
      shiftsArr.forEach((shift) => {
          const techMap = dateGroups[tanggal][shift];
          const techKeys = Object.keys(techMap).sort((a, b) => techMap[a].nama.localeCompare(techMap[b].nama));
          
          techKeys.forEach(key => {
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
             
             const breakManual = 1.15; // fixed
             const totalEfektif = JAM_TERJADWAL - breakManual;
             
             const utilization = JAM_TERJADWAL > 0 ? (totalEfektif / JAM_TERJADWAL) : 0; // ratio
             const efektivitas = totalEfektif > 0 ? (p1 / totalEfektif) : 0; // Wrench Time Ratio
             const delayRatio = totalEfektif > 0 ? ((d1+d2+d3+d4+d5) / totalEfektif) : 0; // ratio
             
             resRows.push([
                rowCount++,
                tech.nama,
                tanggal,
                shift,
                p1, p2, p3, p4,
                d1, d2, d3, d4, d5, b,
                totalTerlapor,
                totalEfektif,
                utilization, // Will be formatted as %
                efektivitas, // Will be formatted as %
                delayRatio,  // Will be formatted as %
                '' // Ket
             ]);
          });
      });
  });

  const wsRes = XLSX.utils.aoa_to_sheet(resRows);
  
  wsRes['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 19 } }, // Form title
    { s: { r: 2, c: 4 }, e: { r: 2, c: 13 } }, // Kategori
    { s: { r: 2, c: 14 }, e: { r: 2, c: 19 } }, // KPI
  ];

  wsRes['!cols'] = [
    { wch: 5 }, { wch: 25 }, { wch: 12 }, { wch: 10 }, 
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 15 }
  ];

  wsRes['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: resRows.length - 1, c: headers.length - 1 } }) };

  const resRange = XLSX.utils.decode_range(wsRes['!ref'] || 'A1');
  for (let R = resRange.s.r; R <= resRange.e.r; ++R) {
    for (let C = resRange.s.c; C <= resRange.e.c; ++C) {
      const address = XLSX.utils.encode_cell({ c: C, r: R });
      if (!wsRes[address]) continue;
      
      let style: any = { font: { name: "Arial", sz: 10 } };
      
      if (R === 0) {
         style.font = { bold: true, color: { rgb: "FFFFFF" }, sz: 14 };
         style.fill = { fgColor: { rgb: "143C68" } };
         style.alignment = { horizontal: "center", vertical: "center" };
      } else if (R === 2) {
         style.font = { bold: true, color: { rgb: "FFFFFF" }, sz: 11 };
         style.fill = { fgColor: { rgb: "143C68" } };
         style.alignment = { horizontal: "center", vertical: "center" };
         style.border = { top: { style: "thin", color: { auto: 1 } }, bottom: { style: "thin", color: { auto: 1 } }, left: { style: "thin", color: { auto: 1 } }, right: { style: "thin", color: { auto: 1 } } };
      } else if (R === 3) {
         style.font = { bold: true, color: { rgb: "FFFFFF" }, sz: 10 };
         if (C >= 4 && C <= 13) {
            style.fill = { fgColor: { rgb: "1E40AF" } }; // Category darker blue
         } else if (C >= 14 && C <= 19) {
            style.fill = { fgColor: { rgb: "1E3A8A" } }; // KPI darkest blue
         } else {
            style.fill = { fgColor: { rgb: "143C68" } };
         }
         style.alignment = { horizontal: "center", vertical: "center", wrapText: true };
         style.border = { top: { style: "thin", color: { auto: 1 } }, bottom: { style: "thin", color: { auto: 1 } }, left: { style: "thin", color: { auto: 1 } }, right: { style: "thin", color: { auto: 1 } } };
      } else if (R > 3) {
         style.border = { top: { style: "hair", color: { auto: 1 } }, bottom: { style: "hair", color: { auto: 1 } }, left: { style: "hair", color: { auto: 1 } }, right: { style: "hair", color: { auto: 1 } } };
         if (C >= 4 && C <= 15) {
             style.numFmt = "0.00";
         } else if (C >= 16 && C <= 18) {
             style.numFmt = "0.00%";
         }
         // Custom formatting to hide zero values or color specific columns
         if (C >= 4 && C <= 19 && C !== 14 && C !== 15 && wsRes[address].v === 0) {
              style.font.color = { rgb: "A0AEC0" }; // Dim zero values
         } else if (C === 4 && wsRes[address].v > 0) { // P1 is success color usually
              style.font.color = { rgb: "047857" };
         } else if (C >= 8 && C <= 12 && wsRes[address].v > 0) { // D1-D5 warning color
              style.font.color = { rgb: "B45309" };
         }
      }
      wsRes[address].s = style;
    }
  }

  XLSX.utils.book_append_sheet(wb, wsRes, "Resume_Daily");

  XLSX.writeFile(wb, `MegaReport_${startDate}_${endDate}.xlsx`);
};
