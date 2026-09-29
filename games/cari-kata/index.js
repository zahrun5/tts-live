const fs = require('fs');
const path = require('path');
const { generateNewRound } = require('./ai-word-generator');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');
const USED_THEMES_PATH = path.join(__dirname, 'used-themes.json');

let puzzle = null;
let currentLevel = 1; // default level

function setLevel(level) {
  currentLevel = level;
}

function getLevel() {
  return puzzle?.level || currentLevel;
}

function loadPuzzleFromDisk() {
  puzzle = JSON.parse(fs.readFileSync(PUZZLE_PATH, 'utf8'));
}

function buildStatePayload() {
  return {
    level: puzzle.level || 1,
    rows: puzzle.rows,
    cols: puzzle.cols,
    grid: puzzle.grid,
    theme: puzzle.theme,
    words: puzzle.words.map(w => ({
      id: w.id,
      row: w.row,
      col: w.col,
      direction: w.direction,
      length: w.word.length,
      found: w.found,
      word: w.found ? w.word : null,
      color: w.found ? w.color : null
    })),
    foundCount: puzzle.words.filter(w => w.found).length,
    totalCount: puzzle.words.length
  };
}

// Dipakai bot Telegram buat command /soal -- nunjukin tema & progres.
function buildClueList() {
  return {
    theme: puzzle.theme,
    words: puzzle.words.map(w => ({
      id: w.id,
      length: w.word.length,
      found: w.found,
      word: w.found ? w.word : null
    }))
  };
}

function isComplete() {
  return puzzle.words.every(w => w.found);
}

function handleAnswer({ answer }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };

  const norm = s => s.toString().trim().toUpperCase().replace(/[^A-Z]/g, '');
  const normAnswer = norm(answer);

  const match = puzzle.words.find(w => norm(w.word) === normAnswer);

  if (!match) return { ok: false, msg: 'Salah' };
  if (match.found) return { ok: false, msg: 'Sudah ditemukan' };

  match.found = true;

  return {
    ok: true,
    msg: 'Benar!',
    points: match.word.length,
    meta: {
      word: match.word,
      row: match.row,
      col: match.col,
      direction: match.direction,
      color: match.color
    }
  };
}

async function preGenerate(level = null) {
  const targetLevel = level !== null ? level : currentLevel;
  // Dipanggil di background sebelum ronde aktif selesai -- boleh coba AI
  // dulu (delay beberapa detik gak masalah, penonton belum lihat apa-apa).
  const result = await generateNewRound(targetLevel, false);
  if (!result.success) return { success: false, error: result.error };
  // JANGAN load puzzle dari disk, biar puzzle aktif gak ke-replace
  if (result.level) currentLevel = result.level;
  return { success: true, source: result.source, level: result.level };
}

async function onComplete(level = null) {
  const targetLevel = level !== null ? level : currentLevel;
  // Dipanggil pas ronde BENAR-BENAR selesai di live -- HARUS instan,
  // skip AI, langsung pakai bank fallback (statis + hasil ai-worker.js).
  const result = await generateNewRound(targetLevel, true);
  if (!result.success) return { success: false, error: result.error };
  loadPuzzleFromDisk(); // Load baru setelah round BENAR-BENAR selesai
  if (result.level) currentLevel = result.level;
  return { success: true, source: result.source, level: result.level };
}

function reset() {
  puzzle.words.forEach(w => { w.found = false; });
}

// ---------- Fitur "nyerah": buka 1 kata acak yang belum ditemukan ----------
// Dipanggil dari vote-controller.js (hasil vote "nyerah" penonton). Nggak
// nambah skor ke siapa-siapa, cuma reveal 1 kata di grid.
function revealRandomAnswer() {
  const unfound = puzzle.words.filter(w => !w.found);
  if (unfound.length === 0) return { ok: false, msg: 'Semua kata sudah ditemukan' };

  const pick = unfound[Math.floor(Math.random() * unfound.length)];
  pick.found = true;

  return {
    ok: true,
    meta: {
      word: pick.word,
      row: pick.row,
      col: pick.col,
      direction: pick.direction,
      color: pick.color,
      foundBy: 'Nyerah 🏳️'
    }
  };
}

// ---------- Stats bank (disamain kayak Sambung Kata) ----------
function getBankStats() {
  const { getTotalCount } = require('./fallback-manager');
  return {
    total: getTotalCount(),
    used: loadUsedThemesCount()
  };
}

function loadUsedThemesCount() {
  try {
    return JSON.parse(fs.readFileSync(USED_THEMES_PATH, 'utf8')).length;
  } catch (e) {
    return 0;
  }
}

function resetBankCycle() {
  fs.writeFileSync(USED_THEMES_PATH, JSON.stringify([], null, 2), 'utf8');
  return true;
}

async function parseComment(text) {
  const cleaned = text.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned || cleaned.length < 3) return null;
  return { answer: cleaned };
}

module.exports = {
  id: 'cari-kata',
  init: loadPuzzleFromDisk,
  buildStatePayload,
  buildClueList,
  handleAnswer,
  isComplete,
  onComplete,
  preGenerate,
  reset,
  revealRandomAnswer,
  parseComment,
  setLevel,
  getLevel,
  getBankStats,
  resetBankCycle
};
