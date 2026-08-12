'use strict';

/**
 * tech_logs (Firestore) -> tech_logs (MariaDB)   << collection terbesar >>
 *
 * Firestore : { id, created_at?, tanggal, nama_technician, nik, supervisor,
 *               shift, wo_notif?, asset_tag?, party?, sn?, deskripsi_pekerjaan,
 *               kategori_code, start_time, finish_time, duration_minutes,
 *               status, delay_code?, output_qty?, catatan? }
 *
 * TIGA HAL YANG PERLU DIINGAT:
 *
 * 1. Tidak ada userId di dokumen ini. user_id direkonstruksi lewat
 *    lib/user-resolver.js (NIK dulu, baru nama). Kalau tidak ketemu, barisnya
 *    diarahkan ke akun penampung 'legacy-unknown' — kolomnya NOT NULL, jadi
 *    NULL bukan pilihan.
 *
 * 2. display_name / nik_snapshot / supervisor adalah SNAPSHOT. Nilainya
 *    diambil dari dokumen Firestore, bukan dari tabel users, sesuai keputusan
 *    ERD: histori lama tidak boleh ikut berubah kalau profil user diubah.
 *
 * 3. Sebelas kolom di tabel ini NOT NULL tanpa DEFAULT. Dokumen lama yang
 *    fieldnya kosong akan ditolak MariaDB, jadi masing-masing punya nilai
 *    pengganti yang tercatat di laporan — lihat PENGGANTI di bawah. Tidak ada
 *    yang diganti diam-diam.
 *
 * PENGGANTI untuk kolom NOT NULL yang datanya kosong:
 *
 *   display_name         "-"
 *   nik_snapshot         ""  (string kosong; backend memperlakukannya sebagai
 *                             "tidak punya NIK" dan tidak ikut dicocokkan)
 *   supervisor           "Belum Ditentukan"  (ada di master_supervisors)
 *   shift                ditebak dari start_time, lihat tebakShift()
 *   kategori_code        "-"  kalau kosong; kode asing dibiarkan apa adanya
 *                             karena kolomnya tidak punya FK dan nilai aslinya
 *                             lebih berguna daripada tanda tanya
 *   start/finish_time    "00:00:00"
 *   duration_minutes     0
 *   status               "-"  (nilai sah di ENUM-nya)
 *   deskripsi_pekerjaan  "-"
 */

const t = require('../lib/transform');
const log = require('../lib/logger');

const VALID_SHIFTS = new Set(['Pagi', 'Siang', 'Malam']);
const VALID_STATUSES = new Set(['Done', 'Ongoing', 'Hold', '-']);

/** DECIMAL(10,2): delapan angka di depan koma, dua di belakang. */
const OUTPUT_QTY_MAX = 99999999.99;

/** Samakan huruf besar/kecil ke bentuk resmi, misal "pagi" -> "Pagi". */
function matchEnum(value, allowed) {
  const s = t.str(value);
  if (s === null) return null;
  if (allowed.has(s)) return s;
  for (const opt of allowed) {
    if (opt.toLowerCase() === s.toLowerCase()) return opt;
  }
  return null;
}

/**
 * Tebak shift dari jam mulai.
 *
 * Kolomnya ENUM NOT NULL tanpa pilihan "tidak diketahui", jadi harus diisi
 * sesuatu. Batasnya mengikuti validasi shift di InputForm.tsx (Pagi mulai
 * 07:00, Malam mulai 17:00). Setiap tebakan dicatat di laporan.
 *
 * `jamAsli` menandai apakah start_time benar-benar ada di dokumennya. Kalau
 * jamnya sendiri hasil pengganti 00:00:00, menebak dari situ akan menghasilkan
 * "Malam" untuk log yang sebetulnya tidak menyebut jam sama sekali -- lebih
 * baik jatuh ke Pagi dan mengakui bahwa ini bukan tebakan berdasar apa pun.
 */
function tebakShift(startTime, jamAsli) {
  if (!jamAsli || !startTime) return 'Pagi';

  const jam = Number(String(startTime).slice(0, 2));

  if (jam >= 17 || jam < 5) return 'Malam';
  if (jam >= 12) return 'Siang';
  return 'Pagi';
}

module.exports = {
  name: 'tech_logs',
  collection: 'tech_logs',
  tableKey: 'tech_logs',
  order: 4,

  async prepare(ctx) {
    await ctx.ensureMaster();
    await ctx.ensureUserIndex();

    // Tanpa akun penampung, setiap baris yang tidak ketemu pemiliknya akan
    // ditolak foreign key. Lebih baik ketahuan sekarang daripada setelah
    // ribuan baris masuk.
    if (!ctx.options.dryRun && !ctx.users.legacyUserExists()) {
      ctx.blockers.add({
        collection: 'tech_logs',
        docId: '(persiapan)',
        field: 'user_id',
        message: `akun penampung "${ctx.users.legacyUserId}" tidak ada di tabel users`,
        hint: 'Jalankan Backend/04_legacy_user.sql dulu.',
      });
    }

    this._supervisorAsing = new Set();
  },

  transform(doc, ctx) {
    const d = doc.data || {};
    const report = ctx.report;

    const id = t.str(doc.id) || t.str(d.id);
    if (!id) return { skip: 'tidak punya id' };

    // --- tanggal (wajib) ---------------------------------------------------
    const tanggal = t.toMysqlDate(d.tanggal, ctx.options.tzOffsetMinutes);
    if (!tanggal) return { skip: 'tanggal kosong / tidak valid' };

    // --- jam & durasi ------------------------------------------------------
    let startTime = t.toMysqlTime(d.start_time);
    let finishTime = t.toMysqlTime(d.finish_time);

    const jamAsli = startTime !== null;

    if (!startTime) {
      report.warn(doc.id, 'start_time', `"${d.start_time}" tidak valid, diisi 00:00:00`);
      startTime = '00:00:00';
    }
    if (!finishTime) {
      report.warn(doc.id, 'finish_time', `"${d.finish_time}" tidak valid, diisi 00:00:00`);
      finishTime = '00:00:00';
    }

    const storedDuration = t.int(d.duration_minutes);
    const computedDuration = t.computeDuration(d.start_time, d.finish_time);

    let duration = storedDuration;
    if (duration === null || duration < 0) {
      duration = computedDuration;
      if (duration !== null) {
        report.warn(doc.id, 'duration_minutes', `nilai tersimpan tidak dipakai, dihitung ulang jadi ${duration}`);
      }
    } else if (computedDuration !== null && computedDuration !== duration) {
      // Dicatat saja, nilai aslinya tetap dipertahankan. Selisih biasanya
      // muncul dari log yang pernah diedit manual lewat Batch Update.
      report.warn(
        doc.id,
        'duration_minutes',
        `tersimpan ${duration} menit, hitungan jam ${computedDuration} menit (nilai tersimpan dipakai)`
      );
    }

    if (duration === null) {
      report.warn(doc.id, 'duration_minutes', 'tidak bisa ditentukan, diisi 0 (kolomnya NOT NULL)');
      duration = 0;
    }

    // --- enum ---------------------------------------------------------------
    let shift = matchEnum(d.shift, VALID_SHIFTS);
    if (!shift) {
      shift = tebakShift(startTime, jamAsli);
      report.warn(
        doc.id,
        'shift',
        jamAsli
          ? `"${d.shift ?? ''}" tidak dikenal, ditebak "${shift}" dari jam mulai ${startTime}`
          : `"${d.shift ?? ''}" tidak dikenal dan jam mulai juga kosong, diisi "${shift}"`
      );
    }

    let status = matchEnum(d.status, VALID_STATUSES);
    if (!status) {
      if (d.status) report.warn(doc.id, 'status', `"${d.status}" tidak dikenal, diisi "-"`);
      status = '-';
    }

    // --- kode kategori & delay ----------------------------------------------
    // Keduanya dicocokkan ke master_categories / master_delay_codes yang ada di
    // database, bukan ke daftar yang ditulis tetap di kode. Isi master sudah
    // dibetulkan Backend/03_align_master_data.sql (PR=Permit, AC=Access,
    // OT=Other), jadi mengacu ke database membuat migrasi ikut benar sendiri.
    let kategori = t.str(d.kategori_code);
    if (kategori) {
      kategori = kategori.toUpperCase();
      if (!ctx.master.hasCategory(kategori)) {
        // Kolomnya tidak punya FK, jadi nilai aslinya bisa disimpan apa adanya.
        // Itu lebih jujur daripada menggantinya dengan kode lain.
        report.warn(doc.id, 'kategori_code', `"${kategori}" tidak ada di master_categories, disimpan apa adanya`);
      }
    } else {
      report.warn(doc.id, 'kategori_code', 'kosong, diisi "-" (kolomnya NOT NULL)');
      kategori = '-';
    }

    let delayCode = t.str(d.delay_code);
    if (delayCode) {
      delayCode = delayCode.toUpperCase();
      if (!ctx.master.hasDelayCode(delayCode)) {
        report.warn(doc.id, 'delay_code', `"${delayCode}" tidak ada di master_delay_codes, disimpan NULL`);
        delayCode = null;
      }
    }

    // --- snapshot identitas + lookup user_id --------------------------------
    const rawTech = t.str(d.nama_technician);
    const rawSupervisor = t.str(d.supervisor);

    let displayName = ctx.options.normalizeNames ? t.normalizeName(rawTech || '') : rawTech;
    let supervisor = ctx.options.normalizeNames ? t.normalizeName(rawSupervisor || '') : rawSupervisor;

    if (!displayName) {
      report.warn(doc.id, 'display_name', 'nama technician kosong, diisi "-" (kolomnya NOT NULL)');
      displayName = '-';
    }

    if (!supervisor) {
      report.warn(doc.id, 'supervisor', 'kosong, diisi "Belum Ditentukan" (kolomnya NOT NULL)');
      supervisor = 'Belum Ditentukan';
    } else if (!ctx.master.hasSupervisor(supervisor)) {
      // Kolomnya teks bebas tanpa FK, jadi nilainya tetap dipakai. Cukup
      // dihitung supaya bisa dilaporkan sekali di akhir, bukan ribuan kali.
      this._supervisorAsing.add(supervisor);
    }

    // Kolom NOT NULL, dan string kosong memang cara backend menandai
    // "log ini tidak menyimpan NIK" (lihat TechLogModel::buildFilter).
    const nikSnapshot = t.str(d.nik) ? t.str(d.nik).toUpperCase() : '';

    const { userId, matchedBy } = ctx.users.resolve({ nik: d.nik, name: d.nama_technician });
    if (matchedBy === null) {
      report.warn(
        doc.id,
        'user_id',
        `tidak ketemu user untuk nik="${nikSnapshot || '-'}" nama="${displayName}", ` +
          `diarahkan ke "${userId}"`
      );
    } else if (matchedBy === 'name') {
      report.warn(doc.id, 'user_id', `dicocokkan lewat nama (NIK "${nikSnapshot || '-'}" tidak cocok)`);
    }

    // --- sisanya --------------------------------------------------------------
    let deskripsi = t.str(d.deskripsi_pekerjaan);
    if (!deskripsi) {
      report.warn(doc.id, 'deskripsi_pekerjaan', 'kosong, diisi "-" (kolomnya NOT NULL)');
      deskripsi = '-';
    }

    const qty = t.decimal(d.output_qty, { scale: 2, max: OUTPUT_QTY_MAX });
    if (qty.overflow) {
      report.warn(
        doc.id,
        'output_qty',
        `"${d.output_qty}" melebihi batas DECIMAL(10,2), disimpan NULL`
      );
    }

    // --- waktu dibuat --------------------------------------------------------
    let createdAt = t.toMysqlDateTime(d.created_at, ctx.options.tzOffsetMinutes);
    if (!createdAt) {
      // Dokumen lama sebelum field created_at ditambahkan: pakai tanggal + jam
      // mulai sebagai perkiraan supaya urutan sortir di frontend tetap masuk akal.
      createdAt = `${tanggal} ${startTime}`;
      report.warn(doc.id, 'created_at', `kosong, diisi perkiraan dari tanggal+start_time (${createdAt})`);
    }

    return {
      record: {
        id,
        user_id: userId,
        display_name: displayName,
        nik_snapshot: nikSnapshot,
        supervisor,
        tanggal,
        shift,
        wo_notif: t.str(d.wo_notif),
        asset_tag: t.str(d.asset_tag),
        party: t.str(d.party),
        sn: t.cleanSn(d.sn),
        deskripsi_pekerjaan: deskripsi,
        kategori_code: kategori,
        start_time: startTime,
        finish_time: finishTime,
        duration_minutes: duration,
        status,
        delay_code: delayCode,
        output_qty: qty.value,
        catatan: t.str(d.catatan),
        created_at: createdAt,
      },
    };
  },

  async finalize(ctx) {
    ctx.users.report();

    const asing = this._supervisorAsing;
    if (asing && asing.size) {
      log.warn(`${asing.size} nama supervisor tidak ada di master_supervisors (tetap disimpan apa adanya):`);
      log.detail([...asing].slice(0, 8).join(', ') + (asing.size > 8 ? ', ...' : ''));
    }
  },
};
