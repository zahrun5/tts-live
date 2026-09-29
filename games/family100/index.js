const fs = require('fs');
const path = require('path');
const { generateNewRound, BOARD_SLOTS } = require('./ai-question-generator');

const QUESTION_PATH = path.join(__dirname, 'question.json');

let state = null;

function loadFromDisk() {
  state = JSON.parse(fs.readFileSync(QUESTION_PATH, 'utf8'));
}

function saveToDisk() {
  fs.writeFileSync(QUESTION_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// ---------- Board logic ----------
// Papan 7 slot, selalu sorted dari poin tertinggi ke terendah.
// Setiap jawaban akan "menempati posisinya sendiri" secara default.
// Ranking 0-1   → Target Slot 0
// Ranking 2-3   → Target Slot 1
// Ranking 4-5   → Target Slot 2
// Ranking 6-7   → Target Slot 3
// Ranking 8-9   → Target Slot 4
// Ranking 10-11 → Target Slot 5
// Ranking 12-14 → Target Slot 6

function insertToBoard() {
  // Ambil semua jawaban yang sudah ditemukan, maksimal 7 tertinggi
  const foundAnswers = state.answers
    .map((a, i) => ({ index: i, points: a.points, found: a.found }))
    .filter(a => a.found)
    .sort((a, b) => b.points - a.points)
    .slice(0, state.boardSlots);

  const N = foundAnswers.length;
  state.board = Array(state.boardSlots).fill(null);

  if (N === 0) return;

  let prevSlot = -1;
  for (let i = 0; i < N; i++) {
    const ans = foundAnswers[i];
    
    // Tentukan grup/target slot aslinya
    let target = Math.floor(ans.index / 2);
    if (target > 6) target = 6;

    // Geser ke bawah kalau menabrak jawaban yang poinnya lebih tinggi
    let slot = Math.max(target, prevSlot + 1);

    // Jangan sampai bablas ke bawah, sisakan ruang untuk jawaban di bawahnya
    const maxAllowedSlot = 6 - (N - 1 - i);
    slot = Math.min(slot, maxAllowedSlot);

    state.board[slot] = ans.index;
    prevSlot = slot;
  }
}

function boardFilledCount() {
  return state.board.filter(idx => idx !== null).length;
}

// ---------- State payload (kirim ke frontend) ----------

function buildStatePayload() {
  if (!state) {
    // Kalau state belum di-init, return default state
    return {
      question: 'Menunggu soal...',
      boardSlots: BOARD_SLOTS,
      board: Array(BOARD_SLOTS).fill(null),
      filledCount: 0,
      totalSlots: BOARD_SLOTS,
      foundCount: 0,
      totalAnswers: 0
    };
  }
  
  return {
    question: state.question,
    boardSlots: state.boardSlots,
    board: state.board.map(idx => {
      if (idx === null) return null;
      const ans = state.answers[idx];
      return {
        text: ans.text,
        points: ans.points,
        foundBy: ans.foundBy
      };
    }),
    filledCount: boardFilledCount(),
    totalSlots: state.boardSlots,
    // Kasih tau berapa jawaban valid yang sudah ditemukan (dari 15)
    foundCount: state.answers.filter(a => a.found).length,
    totalAnswers: state.answers.length
  };
}

function buildClueList() {
  if (!state) {
    return {
      question: 'Menunggu soal...',
      filledCount: 0,
      totalSlots: BOARD_SLOTS
    };
  }
  
  return {
    question: state.question,
    filledCount: boardFilledCount(),
    totalSlots: state.boardSlots
  };
}

// ---------- Answer handling ----------

function handleAnswer({ answer, player }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };

  const norm = s => s.toString().trim().toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
  const normAnswer = norm(answer);
  // Juga coba versi tanpa spasi buat matching lebih fleksibel
  const normNoSpace = normAnswer.replace(/\s/g, '');

  // Board sudah penuh = ronde selesai
  if (boardFilledCount() >= state.boardSlots) {
    return { ok: false, msg: 'Papan sudah penuh!' };
  }

  // Cari jawaban yang cocok
  const match = state.answers.find(a => {
    const normText = norm(a.text);
    const normTextNoSpace = normText.replace(/\s/g, '');
    return normText === normAnswer || normTextNoSpace === normNoSpace;
  });

  if (!match) return { ok: false, msg: 'Tidak ada di daftar jawaban' };
  if (match.found) return { ok: false, msg: 'Sudah pernah dijawab' };

  // Tandai sebagai ditemukan
  match.found = true;
  match.foundBy = player || 'Anonim';

  // Masukkan ke board
  insertToBoard();
  saveToDisk();

  return {
    ok: true,
    msg: 'Benar!',
    points: match.points,
    meta: {
      answer: match.text,
      points: match.points,
      foundBy: match.foundBy
    }
  };
}

// ---------- Game lifecycle ----------

function isComplete() {
  return boardFilledCount() >= state.boardSlots;
}

async function preGenerate() {
  const result = await generateNewRound(false); // false = coba AI dulu
  if (!result.success) return { success: false, error: result.error };
  // Jangan load — biar soal aktif gak ke-replace
  return { success: true, source: result.source };
}

async function onComplete() {
  // Kalau dipanggil langsung (tanpa cache), skip AI biar cepat — langsung pakai fallback
  const result = await generateNewRound(true); // true = skip AI, langsung fallback
  if (!result.success) return { success: false, error: result.error };
  loadFromDisk();
  return { success: true, source: result.source };
}

function reset() {
  state.answers.forEach(a => {
    a.found = false;
    a.foundBy = null;
  });
  state.board = Array(state.boardSlots).fill(null);
  saveToDisk();
}

// ---------- Fitur "nyerah": buka 1 jawaban acak yang belum ketemu ----------
// Dipanggil dari vote-controller.js (hasil vote "nyerah" penonton). Nggak
// nambah skor ke siapa-siapa, cuma isi 1 slot board yang masih kosong.
function revealRandomAnswer() {
  const unfound = state.answers.filter(a => !a.found);
  if (unfound.length === 0) return { ok: false, msg: 'Semua jawaban sudah ketemu' };

  const pick = unfound[Math.floor(Math.random() * unfound.length)];
  pick.found = true;
  pick.foundBy = 'Nyerah 🏳️';

  insertToBoard();
  saveToDisk();

  return {
    ok: true,
    meta: { answer: pick.text, points: pick.points, foundBy: pick.foundBy }
  };
}

// ---------- Comment parser ----------
// Family 100: kirim jawaban bebas, min 2 karakter

async function parseComment(text) {
  const cleaned = text.trim().toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 2) return null;
  return { answer: cleaned };
}

function getBankStats() {
  const { getTotalCount } = require('./fallback-manager');
  const fs = require('fs');
  const path = require('path');
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
  const fs = require('fs');
  const path = require('path');
  const USED_QUESTIONS_FILE = path.join(__dirname, 'used-questions.json');
  
  // Kosongkan riwayat supaya fallback mulai lagi dari file pertama, soal pertama
  fs.writeFileSync(USED_QUESTIONS_FILE, JSON.stringify([], null, 2), 'utf8');
  return true;
}

module.exports = {
  id: 'family100',
  init: loadFromDisk,
  buildStatePayload,
  buildClueList,
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
