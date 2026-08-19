import React from 'react';

/**
 * Kotak konfirmasi, disalin dari modal "Hapus User" di AdminPanel.
 *
 * Sengaja bukan confirm() bawaan browser: tidak ada satu pun di aplikasi ini
 * yang memakainya, dan kotak abu-abu bawaan sistem di tengah tampilan yang
 * sudah punya gayanya sendiri terlihat seperti sesuatu yang salah, bukan
 * seperti pertanyaan yang disengaja.
 */
interface ConfirmDialogProps {
  title: string;
  /** Boleh berisi elemen, misalnya nama yang ditebalkan. */
  message: React.ReactNode;
  confirmLabel: string;
  /** Merah untuk yang menghapus atau mencabut hak; biru untuk sisanya. */
  tone?: 'danger' | 'primary';
  busy?: boolean;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  tone = 'danger',
  busy = false,
  icon,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const warnaTombol = tone === 'danger'
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-[#143c68] hover:bg-[#1a4f8a]';

  return (
    <div className="fixed inset-0 min-h-screen flex items-center justify-center bg-black/60 z-[100] px-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 relative">
        <div className={`flex items-center gap-3 mb-4 ${tone === 'danger' ? 'text-red-600' : 'text-[#143c68]'}`}>
          {icon}
          <h3 className="text-xl font-bold text-slate-800">{title}</h3>
        </div>

        <div className="text-slate-600 text-sm mb-6">{message}</div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 px-4 py-2 text-white rounded-lg font-bold text-sm disabled:opacity-50 ${warnaTombol}`}
          >
            {busy ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
