import React, { useState } from 'react';
import { X, Calendar, Download } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (startDate: string, endDate: string) => void;
  title: string;
}

export default function ExportModal({ isOpen, onClose, onExport, title }: ExportModalProps) {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  if (!isOpen) return null;

  const handleQuickSelect = (days: number, type: 'days' | 'month') => {
    const end = new Date();
    let start = new Date();
    
    if (type === 'days') {
      start.setDate(end.getDate() - days);
    } else if (type === 'month') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    }
    
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const handleExport = () => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    if (diffDays > 31) {
      alert("Rentang waktu maksimal untuk export adalah 31 hari.");
      return;
    }
    if (start > end) {
      alert("Tanggal mulai tidak boleh lebih besar dari tanggal akhir.");
      return;
    }

    onExport(startDate, endDate);
    onClose();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-[#143c68] text-white">
          <h3 className="font-bold flex items-center gap-2">
            <Download className="w-4 h-4" />
            {title}
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="mb-6 space-y-2">
            <label className="block text-sm font-bold text-slate-700">Quick Select</label>
            <div className="flex gap-2 flex-wrap">
              <button 
                onClick={() => handleQuickSelect(0, 'days')}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
              >
                Hari Ini
              </button>
              <button 
                onClick={() => handleQuickSelect(6, 'days')}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
              >
                7 Hari Terakhir
              </button>
              <button 
                onClick={() => handleQuickSelect(0, 'month')}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
              >
                Bulan Ini
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Start Date</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar className="h-4 w-4 text-slate-400" />
                </div>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#143c68] outline-none"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">End Date</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar className="h-4 w-4 text-slate-400" />
                </div>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#143c68] outline-none"
                />
              </div>
            </div>
          </div>
          
          <div className="mt-8 flex gap-3">
            <button 
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors text-sm"
            >
              Batal
            </button>
            <button 
              onClick={handleExport}
              className="flex-1 py-2 px-4 bg-[#143c68] text-white rounded-lg font-bold hover:bg-[#1a4f8a] transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" /> Proses Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
