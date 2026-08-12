'use strict';

const ESC = String.fromCharCode(27);
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const c = (code) => (s) => (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : String(s));

const color = {
  dim: c('2'),
  bold: c('1'),
  red: c('31'),
  green: c('32'),
  yellow: c('33'),
  blue: c('36'),
  magenta: c('35'),
};

function stamp() {
  return color.dim(new Date().toTimeString().slice(0, 8));
}

const log = {
  color,

  info(msg) {
    console.log(`${stamp()} ${msg}`);
  },
  step(msg) {
    console.log(`${stamp()} ${color.blue('>')} ${color.bold(msg)}`);
  },
  ok(msg) {
    console.log(`${stamp()} ${color.green('OK')} ${msg}`);
  },
  warn(msg) {
    console.log(`${stamp()} ${color.yellow('WARN')} ${msg}`);
  },
  error(msg) {
    console.error(`${stamp()} ${color.red('ERROR')} ${msg}`);
  },
  detail(msg) {
    console.log(`${stamp()} ${color.dim('   ' + msg)}`);
  },
  blank() {
    console.log('');
  },
  title(msg) {
    const line = '='.repeat(Math.max(msg.length + 4, 60));
    console.log('');
    console.log(color.magenta(line));
    console.log(color.magenta('  ' + msg));
    console.log(color.magenta(line));
  },

  /** Progress satu baris yang menimpa dirinya sendiri (tidak membanjiri terminal). */
  progress(msg) {
    if (useColor) {
      process.stdout.write(`\r${ESC}[2K${stamp()} ${color.dim(msg)}`);
    } else {
      console.log(`${stamp()} ${msg}`);
    }
  },
  progressDone() {
    if (useColor) process.stdout.write(`\r${ESC}[2K`);
  },
};

module.exports = log;
