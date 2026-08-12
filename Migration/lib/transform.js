'use strict';

/**
 * Helper konversi nilai Firestore -> nilai yang aman untuk MariaDB.
 */

/**
 * Rapikan nama orang.
 *
 * Ini SALINAN PERSIS dari normalizeName() di
 * Frontend/src/utils/storage.ts. Frontend menjalankannya saat menampilkan
 * data (bukan saat menyimpan), jadi data mentah di Firestore masih berantakan
 * ("  pak  BUDI  santoso "). Kalau tidak dinormalisasi saat migrasi, satu
 * technician bisa terpecah jadi beberapa nama berbeda di MariaDB dan lookup
 * user_id akan meleset.
 *
 * Jangan diubah tanpa mengubah frontend juga.
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') {
    return typeof name === 'string' ? name : String(name || '');
  }
  let clean = name.replace(/\s+/g, ' ').trim().toLowerCase();
  clean = clean.replace(/^(pak|bapak)\s+/, '');
  return clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Kunci pencocokan NIK: buang spasi, samakan huruf besar. */
function nikKey(nik) {
  if (nik === null || nik === undefined) return '';
  return String(nik).replace(/\s+/g, '').toUpperCase();
}

/** Kunci pencocokan nama: hasil normalizeName di-lowercase. */
function nameKey(name) {
  return normalizeName(name).toLowerCase().trim();
}

/**
 * Ubah apa pun bentuk waktunya jadi objek Date.
 * Menangani: Firestore Timestamp, {_seconds}, Date, epoch, string ISO,
 * dan string "YYYY-MM-DD HH:mm:ss".
 */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Firestore Timestamp
  if (typeof value.toDate === 'function') {
    try {
      const d = value.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch (e) {
      return null;
    }
  }

  // Bentuk mentah Timestamp saat sudah lewat JSON
  if (typeof value === 'object') {
    const secs = value._seconds ?? value.seconds;
    if (typeof secs === 'number') return new Date(secs * 1000);
    return null;
  }

  if (typeof value === 'number') {
    // Angka 10 digit = detik, 13 digit = milidetik.
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    // "YYYY-MM-DD HH:mm:ss" tanpa zona -> anggap sudah waktu lokal
    const plain = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(s);
    if (plain) {
      const d = new Date(s.replace(' ', 'T') + 'Z');
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Date -> "YYYY-MM-DD HH:mm:ss" pada offset tertentu.
 * offsetMinutes 420 = WIB. Lihat TZ_OFFSET_MINUTES di .env.
 */
function toMysqlDateTime(value, offsetMinutes = 0) {
  const d = toDate(value);
  if (!d) return null;
  const shifted = new Date(d.getTime() + offsetMinutes * 60000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

/**
 * -> "YYYY-MM-DD".
 * Kalau input sudah berupa "YYYY-MM-DD" (kasus field `tanggal`, diisi manual
 * oleh user dalam waktu lokal), dipakai apa adanya tanpa konversi timezone —
 * mengubahnya justru bisa menggeser tanggal kerja ke hari sebelumnya.
 */
function toMysqlDate(value, offsetMinutes = 0) {
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const dt = toMysqlDateTime(value, offsetMinutes);
  return dt ? dt.slice(0, 10) : null;
}

/** "8:5" / "08:05" / "08:05:30" -> "08:05:00". Selain itu null. */
function toMysqlTime(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;

  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] || 0);
  if (h > 23 || min > 59 || sec > 59) return null;

  return `${pad(h)}:${pad(min)}:${pad(sec)}`;
}

/**
 * Hitung durasi menit dari jam mulai & selesai.
 * Salinan logika saveLog() di frontend, termasuk penanganan shift Malam
 * yang melewati tengah malam.
 */
function computeDuration(startTime, finishTime) {
  const s = toMysqlTime(startTime);
  const f = toMysqlTime(finishTime);
  if (!s || !f) return null;

  const [sh, sm] = s.split(':').map(Number);
  const [fh, fm] = f.split(':').map(Number);

  const startMinutes = sh * 60 + sm;
  let finishMinutes = fh * 60 + fm;
  if (finishMinutes < startMinutes) finishMinutes += 24 * 60;

  return finishMinutes - startMinutes;
}

/** String bersih; kosong -> null. */
function str(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Sama seperti str() tapi tidak pernah null (untuk kolom NOT NULL). */
function strOr(value, fallback = '') {
  const s = str(value);
  return s === null ? fallback : s;
}

function int(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Angka pecahan untuk kolom DECIMAL.
 *
 * output_qty bertipe DECIMAL(10,2), bukan INT. Versi lama memakai int() dan
 * diam-diam membuang angka di belakang koma -- 2.5 jerigen jadi 2.
 *
 * @param {*} value
 * @param {{ scale?: number, max?: number }} opts
 * @returns {{ value: number|null, overflow: boolean }}
 */
function decimal(value, opts = {}) {
  const scale = opts.scale ?? 2;

  if (value === null || value === undefined || value === '') {
    return { value: null, overflow: false };
  }

  const n = Number(value);
  if (!Number.isFinite(n)) return { value: null, overflow: false };

  const rounded = Number(n.toFixed(scale));

  if (opts.max !== undefined && Math.abs(rounded) > opts.max) {
    return { value: null, overflow: true };
  }

  return { value: rounded, overflow: false };
}

/**
 * Rapikan blok serial number: samakan line ending, buang spasi di ujung tiap
 * baris, dan hapus baris kosong berlebih. Isi & urutannya tidak diubah.
 */
function cleanSn(value) {
  const s = str(value);
  if (s === null) return null;
  const lines = s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines.length ? lines.join('\n') : null;
}

/**
 * Potong string yang melebihi panjang kolom.
 * @returns {{ value: string|null, truncated: boolean }}
 */
function truncate(value, maxLength) {
  if (value === null || value === undefined) return { value: null, truncated: false };
  const s = String(value);
  if (!maxLength || s.length <= maxLength) return { value: s, truncated: false };
  return { value: s.slice(0, maxLength), truncated: true };
}

module.exports = {
  normalizeName,
  nikKey,
  nameKey,
  toDate,
  toMysqlDateTime,
  toMysqlDate,
  toMysqlTime,
  computeDuration,
  str,
  strOr,
  int,
  decimal,
  cleanSn,
  truncate,
};
