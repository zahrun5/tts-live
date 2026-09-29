const fs = require('fs');
const path = require('path');
const { generateNewRound } = require('./ai-letter-generator');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');

let puzzle = null;
let state = {};
let revealedCells = new Set();

function wordKey(w) {
  return `${w.number}-${w.direction}`;
}

function loadPuzzleFromDisk() {
  puzzle = JSON.parse(fs.readFileSync(PUZZLE_PATH, 'utf8'));
  state = {};
  revealedCells = new Set();
  puzzle.words.forEach(w => { state[wordKey(w)] = false; });
}

function buildStatePayload() {
  return {
    rows: puzzle.rows,
    cols: puzzle.cols,
    baseLetters: puzzle.baseLetters,
    words: puzzle.words.map(w => ({
      number: w.number,
      direction: w.direction,
      row: w.row,
      col: w.col,
      length: w.answer.length,
      answer: state[wordKey(w)] ? w.answer : null
    }))
  };
}

function isComplete() {
  return Object.values(state).every(solved => solved === true);
}

function handleAnswer({ answer }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };

  const norm = s => s.toString().trim().toUpperCase().replace(/[^A-Z]/g, '');
  const normAnswer = norm(answer);

  const match = puzzle.words.find(w => !state[wordKey(w)] && norm(w.answer) === normAnswer);

  if (!match) {
    const alreadySolved = puzzle.words.some(w => state[wordKey(w)] && norm(w.answer) === normAnswer);
    if (alreadySolved) return { ok: false, msg: 'Sudah terisi' };
    return { ok: false, msg: 'Salah' };
  }

  state[wordKey(match)] = true;

  let newCellCount = 0;
  for (let i = 0; i < match.answer.length; i++) {
    const r = match.row + (match.direction === 'down' ? i : 0);
    const c = match.col + (match.direction === 'across' ? i : 0);
    const key = `${r},${c}`;
    if (!revealedCells.has(key)) {
      revealedCells.add(key);
      newCellCount++;
    }
  }

  return {
    ok: true,
    msg: 'Benar!',
    points: newCellCount,
    meta: { number: match.number, answer: match.answer }
  };
}

async function preGenerate() {
  const result = await generateNewRound(false); // false = coba AI dulu
  if (!result.success) return { success: false, error: result.error };
  // Jangan load — biar puzzle aktif gak ke-replace
  return { success: true, source: result.source };
}

async function onComplete() {
  // Kalau dipanggil langsung (tanpa cache), skip AI biar cepat — langsung pakai fallback
  const result = await generateNewRound(true); // true = skip AI, langsung fallback
  if (!result.success) return { success: false, error: result.error };
  loadPuzzleFromDisk();
  return { success: true, source: result.source };
}

function reset() {
  Object.keys(state).forEach(k => state[k] = false);
  revealedCells = new Set();
}

// ---------- Fitur "nyerah": buka 1 kata acak yang belum ketemu ----------
// Dipanggil dari vote-controller.js (hasil vote "nyerah" penonton). Nggak
// nambah skor ke siapa-siapa, cuma buka huruf-huruf 1 kata yang masih kosong.
function revealRandomAnswer() {
  const unsolved = puzzle.words.filter(w => !state[wordKey(w)]);
  if (unsolved.length === 0) return { ok: false, msg: 'Semua kata sudah ketemu' };

  const pick = unsolved[Math.floor(Math.random() * unsolved.length)];
  state[wordKey(pick)] = true;

  for (let i = 0; i < pick.answer.length; i++) {
    const r = pick.row + (pick.direction === 'down' ? i : 0);
    const c = pick.col + (pick.direction === 'across' ? i : 0);
    revealedCells.add(`${r},${c}`);
  }

  return {
    ok: true,
    meta: { number: pick.number, answer: pick.answer, foundBy: 'Nyerah 🏳️' }
  };
}

async function parseComment(text) {
  const cleaned = text.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned || cleaned.length < 3) return null;
  return { answer: cleaned };
}

function getBankStats() {
  const { getTotalCount } = require('./fallback-manager');
  const fs = require('fs');
  const path = require('path');
  const USED_LETTERS_FILE = path.join(__dirname, 'used-base-letters.json');

  let used = [];
  try {
    if (fs.existsSync(USED_LETTERS_FILE)) {
      used = JSON.parse(fs.readFileSync(USED_LETTERS_FILE, 'utf8'));
    }
  } catch (e) {}

  return {
    total: getTotalCount(),
    used: used.length
  };
}

function resetBankCycle() {
  const fs = require('fs');
  const path = require('path');
  const USED_LETTERS_FILE = path.join(__dirname, 'used-base-letters.json');

  // Kosongkan riwayat supaya fallback mulai lagi dari file pertama, set huruf pertama
  fs.writeFileSync(USED_LETTERS_FILE, JSON.stringify([], null, 2), 'utf8');
  return true;
}

module.exports = {
  id: 'sambung-kata',
  init: loadPuzzleFromDisk,
  buildStatePayload,
  handleAnswer,
  isComplete,
  onComplete,
  preGenerate,
  reset,
  revealRandomAnswer,
  parseComment,
  getBankStats,
  resetBankCycle
};
