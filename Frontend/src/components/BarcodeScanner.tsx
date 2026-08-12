import React, { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X } from 'lucide-react';

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
  paused: boolean;
}

export default function BarcodeScanner({ isOpen, onClose, onScan, paused }: BarcodeScannerProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  
  useEffect(() => {
    let mounted = true;

    const startScanner = async () => {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode("reader");
      }
      
      const config = { fps: 10, qrbox: { width: 250, height: 150 } };
      
      try {
        await scannerRef.current.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            if (!paused) {
               onScan(decodedText);
            }
          },
          (errorMessage) => {
            // ignore scan errors
          }
        );
        if (mounted) setHasPermission(true);
      } catch (err: any) {
        console.error(err);
        if (mounted) {
          setHasPermission(false);
          setError(err?.message || "Gagal membuka kamera.");
        }
      }
    };

    if (isOpen) {
      startScanner();
    }

    return () => {
      mounted = false;
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
        scannerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      if (paused) {
        if (scannerRef.current.getState() === 2) { // SCANNING
          scannerRef.current.pause(true);
        }
      } else {
        if (scannerRef.current.getState() === 3) { // PAUSED
          scannerRef.current.resume();
        }
      }
    }
  }, [paused]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col">
      <div className="p-4 flex justify-between items-center bg-black text-white">
        <h3 className="font-bold">Scan Barcode</h3>
        <button onClick={onClose} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 flex flex-col justify-center relative items-center p-4">
        {hasPermission === false && (
          <div className="text-white text-center p-4">
            <p className="text-red-400 mb-2">{error}</p>
            <p>Pastikan Anda telah memberikan izin akses kamera ke browser.</p>
          </div>
        )}
        <div id="reader" className="w-full max-w-sm rounded-lg overflow-hidden bg-black relative z-10"></div>
      </div>
    </div>
  );
}
