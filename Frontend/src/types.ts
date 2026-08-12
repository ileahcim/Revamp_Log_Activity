/**
 * Nilainya mengikuti ENUM('Open','In Progress','Resolved') di 01_schema.sql.
 * 'In Progress' sudah ada di database dan diterima backend sejak awal, hanya
 * belum pernah dikenal di sini.
 */
export type BugStatus = 'Open' | 'In Progress' | 'Resolved';

export interface BugReport {
  id: string;
  userId: string;
  userName: string;
  role: string;
  title: string;
  description: string;
  imageBase64?: string;
  has_image?: boolean;
  status: BugStatus;
  timestamp: string;
}

export interface LogActivity {
  id: string;
  created_at?: string; // ISO string 
  tanggal: string; // YYYY-MM-DD
  nama_technician: string;
  nik: string;
  supervisor: string;
  shift: 'Pagi' | 'Siang' | 'Malam';
  wo_notif?: string;
  asset_tag?: string;
  party?: string;
  sn?: string;
  deskripsi_pekerjaan: string;
  kategori_code: string;
  start_time: string; // HH:mm
  finish_time: string; // HH:mm
  duration_minutes: number;
  status: string;
  delay_code?: string;
  output_qty?: number;
  catatan?: string;
}

export const SHIFTS = ['Pagi', 'Siang', 'Malam'];
export const STATUSES = ['Done', 'Ongoing', 'Hold', '-'];

/*
 * KATEGORI_CODES dan DELAY_CODES dihapus dari sini.
 *
 * Keduanya sekarang datang dari /api/master/categories dan
 * /api/master/delay-codes lewat MasterDataProvider di utils/masterData.tsx.
 * Pemakaiannya tidak berubah bentuk -- komponen memanggil useKategoriCodes()
 * atau useDelayCodeNames() dan menerima Record<code, name> yang sama.
 *
 * Sengaja dihapus, bukan dibiarkan sebagai cadangan. Selama salinan tetapnya
 * masih bisa diimpor, cepat atau lambat ada yang memakainya lagi, dan
 * perbaikan master data di database berhenti terlihat di layar tanpa ada yang
 * sadar -- persis keadaan yang baru saja diperbaiki (PR=Permit, AC=Access,
 * OT=Other sudah benar di database sejak 03_align_master_data.sql, tapi layar
 * masih menampilkan nama lama dari daftar di sini).
 *
 * SHIFTS dan STATUSES di atas tetap tinggal: keduanya bukan tabel master,
 * melainkan ENUM di kolom tech_logs yang nilainya dikunci schema V1.0.
 */
