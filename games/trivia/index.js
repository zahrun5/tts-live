const fs = require('fs');
const path = require('path');
const { generateNewRound } = require('./ai-question-generator');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');

let puzzle = null;

function loadPuzzleFromDisk() {
  puzzle = JSON.parse(fs.readFileSync(PUZZLE_PATH, 'utf8'));
  puzzle.answered = false;
  puzzle.winnerLetter = null;
}

// Buat overlay OBS -- jawaban benar cuma dibocorin (correctLetter) SETELAH
// soal itu terjawab, biar penonton nggak bisa liat curang lewat layar.
function buildStatePayload() {
  return {
    category: puzzle.category,
    question: puzzle.question,
    options: puzzle.options,
    answered: puzzle.answered,
    correctLetter: puzzle.answered ? puzzle.correctLetter : null,
    winnerLetter: puzzle.answered ? puzzle.winnerLetter : null
  };
}

// Dipakai bot Telegram buat command /soal.
function buildClueList() {
  return {
    category: puzzle.category,
    question: puzzle.question,
    options: puzzle.options,
    answered: puzzle.answered,
    correctLetter: puzzle.answered ? puzzle.correctLetter : null
  };
}

function isComplete() {
  return puzzle.answered === true;
}

function handleAnswer({ answer }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };
  if (puzzle.answered) return { ok: false, msg: 'Soal ini sudah terjawab' };

  const normLetter = answer.toString().trim().toUpperCase();
  const normText = s => s.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  let match = null;
  if (/^[A-D]$/.test(normLetter)) {
    match = puzzle.options.find(o => o.letter === normLetter);
  }
  if (!match) {
    match = puzzle.options.find(o => normText(o.text) === normText(normLetter));
  }

  if (!match) return { ok: false, msg: 'Salah' };
  if (match.letter !== puzzle.correctLetter) return { ok: false, msg: 'Salah' };

  puzzle.answered = true;
  puzzle.winnerLetter = match.letter;

  return {
    ok: true,
    msg: 'Benar!',
    points: 10,
    meta: { letter: match.letter, text: match.text, category: puzzle.category }
  };
}

// preGenerate: dipanggil di background selagi ronde masih berjalan.
// Coba AI dulu (skipAI=false), hasilnya masuk ke bank. Puzzle aktif tidak disentuh.
async function preGenerate() {
  const result = await generateNewRound(false); // coba AI, simpan ke bank
  if (!result.success) return { success: false, error: result.error };
  // Jangan load ke puzzle aktif — biar soal yang sedang berjalan tidak ke-replace
  return { success: true, source: result.source };
}

// onComplete: dipanggil saat ronde selesai, harus cepat.
// Langsung ambil dari bank (skipAI=true), lalu load ke puzzle aktif.
async function onComplete() {
  const result = await generateNewRound(true); // skip AI, langsung bank
  if (!result.success) return { success: false, error: result.error };
  loadPuzzleFromDisk();
  return { success: true, source: result.source };
}

function reset() {
  puzzle.answered = false;
  puzzle.winnerLetter = null;
}

// ---------- Fitur "nyerah": reveal jawaban yang benar ----------
// Trivia hanya punya 1 jawaban benar, jadi "nyerah" = langsung tandai soal
// sebagai terjawab dan tampilkan jawaban yang benar ke layar.
function revealRandomAnswer() {
  if (puzzle.answered) return { ok: false, msg: 'Soal sudah terjawab' };

  puzzle.answered = true;
  puzzle.winnerLetter = null; // null = reveal tanpa pemenang

  const correct = puzzle.options.find(o => o.letter === puzzle.correctLetter);
  return {
    ok: true,
    meta: {
      letter: puzzle.correctLetter,
      text: correct ? correct.text : '',
      foundBy: 'Nyerah 🏳️'
    }
  };
}

// Terima jawaban dari komentar TikTok dalam beberapa format:
// "a", "A", "a. jakarta", "1" (nomor urut opsi), atau langsung isi teks opsi ("jakarta").
async function parseComment(text) {
  const raw = text.trim();
  if (!raw) return null;

  // Huruf pilihan longgar di awal komentar, misal "A", "a.", "jawabannya b", "(c)"
  const letterMatch = raw.toUpperCase().match(/(?:^|\s)\(?([A-D])\)?(?:[.\s]|$)/);
  if (letterMatch) return { answer: letterMatch[1] };

  // Angka 1-4 dianggap urutan opsi (1=A, 2=B, dst) -- banyak penonton lebih
  // gampang ngetik angka daripada huruf pas nonton live.
  const numMatch = raw.match(/(?:^|\s)([1-4])(?:[.\s]|$)/);
  if (numMatch) {
    const letters = ['A', 'B', 'C', 'D'];
    return { answer: letters[Number(numMatch[1]) - 1] };
  }

  // Kalau nggak ada huruf/angka, coba cocokin ke isi teks opsi langsung.
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length >= 3) return { answer: cleaned };

  return null;
}

function getBankStats() {
  const { getTotalCount } = require('./fallback-manager');
  const USED_QUESTIONS_FILE = path.join(__dirname, 'used-questions.json');

  let used = [];
  try {
    if (fs.existsSync(USED_QUESTIONS_FILE)) {
      used = JSON.parse(fs.readFileSync(USED_QUESTIONS_FILE, 'utf8'));
    }
  } catch (e) {}

  return {
    total: getTotalCount(),
    used: used.length
  };
}

function resetBankCycle() {
  const USED_QUESTIONS_FILE = path.join(__dirname, 'used-questions.json');
  fs.writeFileSync(USED_QUESTIONS_FILE, JSON.stringify([], null, 2), 'utf8');
  return true;
}

module.exports = {
  id: 'trivia',
  init: loadPuzzleFromDisk,
  buildStatePayload,
  buildClueList,
  handleAnswer,
  isComplete,
  preGenerate,
  onComplete,
  reset,
  revealRandomAnswer,
  parseComment,
  getBankStats,
  resetBankCycle
};
