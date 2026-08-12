'use strict';

/**
 * Checkpoint migrasi.
 *
 * Setiap batch yang berhasil ditulis mencatat id dokumen Firestore terakhir.
 * Kalau koneksi Hostinger putus di tengah jalan (sering terjadi di shared
 * hosting), migrasi bisa dilanjutkan dengan `--resume` tanpa mengulang dari nol.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.migration-state.json');

function read() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function write(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getCheckpoint(name) {
  const state = read();
  return state[name] || null;
}

function setCheckpoint(name, data) {
  const state = read();
  state[name] = { ...data, updatedAt: new Date().toISOString() };
  write(state);
}

function clearCheckpoint(name) {
  const state = read();
  delete state[name];
  write(state);
}

function clearAll() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

module.exports = { getCheckpoint, setCheckpoint, clearCheckpoint, clearAll, read, STATE_FILE };
