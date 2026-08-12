'use strict';

/**
 * Test runner seadanya — sengaja tanpa dependency tambahan.
 *
 *     npm test
 *     node tests/run.js firestore-readonly     (jalankan satu berkas saja)
 *
 * Setiap berkas tests/*.test.js mengekspor { nama, tests: { label: fn } }.
 * fn boleh async; gagal = melempar error.
 */

const fs = require('fs');
const path = require('path');

const ESC = String.fromCharCode(27);
const warna = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (warna ? `${ESC}[${code}m${s}${ESC}[0m` : String(s));
const hijau = c('32');
const merah = c('31');
const redup = c('2');
const tebal = c('1');

/** Bantuan assert yang dipakai berkas test. */
const assert = {
  ok(nilai, pesan) {
    if (!nilai) throw new Error(pesan || `diharapkan bernilai benar, dapat ${JSON.stringify(nilai)}`);
  },

  sama(dapat, harap, pesan) {
    if (dapat !== harap) {
      throw new Error(`${pesan || 'nilai tidak sama'}: dapat ${JSON.stringify(dapat)}, harap ${JSON.stringify(harap)}`);
    }
  },

  samaDalam(dapat, harap, pesan) {
    const a = JSON.stringify(dapat);
    const b = JSON.stringify(harap);
    if (a !== b) throw new Error(`${pesan || 'isi tidak sama'}:\n      dapat ${a}\n      harap ${b}`);
  },

  /** fn harus melempar error yang pesannya mengandung `potongan`. */
  melempar(fn, potongan, pesan) {
    let error = null;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    if (!error) throw new Error(`${pesan || 'seharusnya melempar error'}, tapi lolos tanpa error`);
    if (potongan && !String(error.message).includes(potongan)) {
      throw new Error(`${pesan || 'error tidak sesuai'}: pesan "${error.message}" tidak mengandung "${potongan}"`);
    }
    return error;
  },

  /** fn harus JALAN tanpa error — dipakai untuk pembacaan yang wajar. */
  tidakMelempar(fn, pesan) {
    try {
      return fn();
    } catch (e) {
      throw new Error(`${pesan || 'seharusnya tidak melempar error'}, tapi dapat: ${e.message}`);
    }
  },
};

async function main() {
  const dir = __dirname;
  const filter = process.argv[2] || null;

  const berkas = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => !filter || f.includes(filter))
    .sort();

  if (!berkas.length) {
    console.error(merah('Tidak ada berkas test yang cocok.'));
    return 1;
  }

  let lolos = 0;
  const gagal = [];

  for (const f of berkas) {
    const modul = require(path.join(dir, f));
    console.log(`\n${tebal(modul.nama || f)}`);

    for (const [label, fn] of Object.entries(modul.tests)) {
      try {
        await fn(assert);
        lolos += 1;
        console.log(`  ${hijau('lolos')}  ${label}`);
      } catch (e) {
        gagal.push({ berkas: f, label, error: e });
        console.log(`  ${merah('GAGAL')}  ${label}`);
        console.log(`         ${redup(e.message.replace(/\n/g, '\n         '))}`);
      }
    }
  }

  console.log('');
  if (gagal.length) {
    console.log(merah(`${gagal.length} gagal`) + redup(`, ${lolos} lolos`));
    return 1;
  }

  console.log(hijau(`Semua lolos (${lolos} pengujian).`));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(merah(`Runner error: ${e.stack}`));
    process.exit(1);
  });
