const fs = require('fs');
const path = require('path');
const { generateNewPuzzle } = require('./ai-question-generator');
const { parseAnswer } = require('./comment-parser');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');
const USED_WORDS_PATH = path.join(__dirname, 'used-words.json');

let puzzle = null;
let state = {};
let revealedCells = new Set(); // "r,c" kolom yang udah kebuka -- basis hitung skor per KOLOM,
                                 // bukan per kata, biar intersection nggak dihitung dobel.

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
    words: puzzle.words.map(w => ({
      number: w.number,
      direction: w.direction,
      row: w.row,
      col: w.col,
      length: w.answer.length,
      clue: w.clue,
      answer: state[wordKey(w)] ? w.answer : null
    }))
  };
}

function buildClueList() {
  return puzzle.words.map(w => ({
    number: w.number,
    direction: w.direction,
    clue: w.clue,
    length: w.answer.length
  }));
}

function isComplete() {
  return Object.values(state).every(solved => solved === true);
}

function handleAnswer({ number, answer, direction }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };

  const hasNumber = number !== null && number !== undefined && !Number.isNaN(Number(number));

  let candidates;
  if (hasNumber) {
    candidates = puzzle.words.filter(w => w.number === Number(number));
    if (candidates.length === 0) return { ok: false, msg: 'Nomor tidak ditemukan' };
  } else {
    // Jawaban ditulis langsung tanpa nomor -- cocokkan ke semua kata
    // yang belum terisi (sama kayak Cari Kata/Sambung Kata).
    candidates = puzzle.words;
  }

  if (direction === 'across' || direction === 'down') {
    const filtered = candidates.filter(w => w.direction === direction);
    if (filtered.length > 0) candidates = filtered;
  }

  const norm = s => s.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normAnswer = norm(answer);

  const match = candidates.find(w => !state[wordKey(w)] && norm(w.answer) === normAnswer);

  if (!match) {
    if (candidates.every(w => state[wordKey(w)])) {
      return { ok: false, msg: 'Sudah terisi' };
    }
    return { ok: false, msg: 'Salah' };
  }

  state[wordKey(match)] = true;

  // Hitung skor dari jumlah kolom BARU yang kebuka lewat jawaban ini.
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
    meta: { number: match.number, answer: match.answer, clue: match.clue }
  };
}

async function preGenerate() {
  // Dipanggil di background sebelum ronde aktif selesai -- boleh coba AI
  // dulu (delay beberapa detik gak masalah, penonton belum lihat apa-apa).
  const result = await generateNewPuzzle(false);
  if (!result.success) return { success: false, error: result.error };
  // JANGAN load puzzle dari disk, biar puzzle aktif gak ke-replace
  return { success: true, source: result.source };
}

async function onComplete() {
  // Dipanggil pas ronde BENAR-BENAR selesai di live -- HARUS instan,
  // skip AI, langsung pakai bank fallback (statis + hasil ai-worker.js).
  const result = await generateNewPuzzle(true);
  if (!result.success) return { success: false, error: result.error };
  loadPuzzleFromDisk();
  return { success: true, source: result.source };
}

function reset() {
  Object.keys(state).forEach(k => state[k] = false);
  revealedCells = new Set();
}

// ---------- Fitur "nyerah": buka 1 kata acak yang belum terjawab ----------
// Dipanggil dari vote-controller.js (hasil vote "nyerah" penonton). Nggak
// nambah skor ke siapa-siapa, cuma reveal 1 kata ke grid.
function revealRandomAnswer() {
  const unsolved = puzzle.words.filter(w => !state[wordKey(w)]);
  if (unsolved.length === 0) return { ok: false, msg: 'Semua kata sudah terjawab' };

  const pick = unsolved[Math.floor(Math.random() * unsolved.length)];
  state[wordKey(pick)] = true;

  // Hitung sel baru yang kebuka (buat log saja, skor tidak diberikan)
  for (let i = 0; i < pick.answer.length; i++) {
    const r = pick.row + (pick.direction === 'down' ? i : 0);
    const c = pick.col + (pick.direction === 'across' ? i : 0);
    revealedCells.add(`${r},${c}`);
  }

  return {
    ok: true,
    meta: { number: pick.number, answer: pick.answer, clue: pick.clue, foundBy: 'Nyerah 🏳️' }
  };
}

// ---------- Stats bank (disamain kayak Sambung Kata/Cari Kata) ----------
function getBankStats() {
  const { getTotalCount } = require('./fallback-manager');
  let used = [];
  try {
    used = JSON.parse(fs.readFileSync(USED_WORDS_PATH, 'utf8'));
  } catch (e) {}
  return { total: getTotalCount(), used: used.length };
}

function resetBankCycle() {
  fs.writeFileSync(USED_WORDS_PATH, JSON.stringify([], null, 2), 'utf8');
  return true;
}

module.exports = {
  id: 'tts',
  init: loadPuzzleFromDisk,
  buildStatePayload,
  buildClueList,
  handleAnswer,
  isComplete,
  onComplete,
  preGenerate,
  reset,
  revealRandomAnswer,
  parseComment: parseAnswer, // comment-parser.js udah return shape { number, answer, direction } -- pas persis, TANPA AI
  getBankStats,
  resetBankCycle
};
