/**
 * Susun Kalimat - Game menyusun kalimat dari kata-kata acak
 *
 * Setiap RONDE berisi beberapa SOAL (4-6 kalimat), mirip TTS: tiap soal
 * punya nomor urut. Penonton jawab dengan format:
 *   - "<nomor> <jawaban lengkap>"  contoh: "3 ibu memasak nasi goreng"
 *   - jawaban langsung tanpa nomor -- dicocokkan ke semua soal yang
 *     belum terjawab (sama kayak TTS/Cari Kata/Sambung Kata)
 * Ronde dianggap selesai (isComplete -> true, trigger onComplete) kalau
 * SEMUA soal di ronde itu udah kejawab.
 *
 * - Tiap kalimat terdiri dari 4-6 kata, kata-katanya diacak urutannya
 * - Siapa pertama benar per soal, dapat POINTS_PER_SOAL poin buat soal itu
 * - Vote SKIP: ganti seluruh ronde (soal baru semua)
 * - Vote NYERAH: reveal 1 soal acak yang belum terjawab
 */

const fs = require('fs');
const path = require('path');
const { callAIGenerator } = require('./ai-sentence-generator');
const { saveFallbackSentence, pickFallbackSentences, getTotalCount } = require('./fallback-manager');

const STATE_FILE = path.join(__dirname, 'state.json');
const USED_FILE = path.join(__dirname, 'used-sentences.json');

const POINTS_PER_SOAL = 15;
const USED_HISTORY_LIMIT = 500;
const MIN_SOAL_PER_ROUND = 4;
const MAX_SOAL_PER_ROUND = 6;

let state = null; // { items: [{ number, sentence, words, shuffled, solved, solvedBy, winnerAnswer }] }

// ---------- Util ----------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Pastikan hasil shuffle beda dari urutan asli
  const original = arr.join('|');
  if (a.join('|') === original && a.length > 1) {
    [a[0], a[1]] = [a[1], a[0]];
  }
  return a;
}

function randomRoundSize() {
  return MIN_SOAL_PER_ROUND + Math.floor(Math.random() * (MAX_SOAL_PER_ROUND - MIN_SOAL_PER_ROUND + 1));
}

function loadUsedSentences() {
  try {
    if (!fs.existsSync(USED_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
  } catch (e) { return []; }
}

function saveUsedSentences(used, newOnes) {
  const merged = [...used, ...newOnes].slice(-USED_HISTORY_LIMIT);
  fs.writeFileSync(USED_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

function buildItem(number, item) {
  return {
    number,
    sentence: item.sentence,
    words: item.words,
    shuffled: shuffle(item.words),
    solved: false,
    solvedBy: null,
    winnerAnswer: null
  };
}

function buildState(items) {
  return { items: items.map((item, i) => buildItem(i + 1, item)) };
}

function saveStateToDisk() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ---------- Generate ronde baru (banyak soal sekaligus) ----------

async function generateNewRound(skipAI = false) {
  const used = loadUsedSentences();
  const targetCount = randomRoundSize();

  if (!skipAI) {
    try {
      console.log('🤖 [Susun Kalimat] Mencoba AI...');
      const generated = await callAIGenerator();
      const fresh = generated.filter(i => !used.includes(i.sentence));
      const pool = fresh.length >= targetCount ? fresh : generated;
      const picks = pool.slice(0, targetCount);

      if (picks.length > 0) {
        saveUsedSentences(used, picks.map(p => p.sentence));
        picks.forEach(p => saveFallbackSentence(p));
        state = buildState(picks);
        saveStateToDisk();
        console.log(`✓ [Susun Kalimat] AI: ${picks.length} soal baru`);
        return { success: true, source: 'ai', count: picks.length };
      }
    } catch (err) {
      console.warn(`⚠️ [Susun Kalimat] AI gagal: ${err.message}`);
    }
  }

  // Bank fallback
  const picks = pickFallbackSentences(used, targetCount);
  if (picks.length > 0) {
    saveUsedSentences(used, picks.map(p => p.sentence));
    state = buildState(picks);
    saveStateToDisk();
    console.log(`✓ [Susun Kalimat] Bank: ${picks.length} soal`);
    return { success: true, source: 'bank', count: picks.length };
  }

  return { success: false, error: 'Bank kalimat kosong dan AI gagal' };
}

// ---------- Game interface ----------

function init() {
  // Load dari disk kalau ada, kalau tidak generate baru
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // Reset status solved saat server restart, ronde diulang dari awal
      if (Array.isArray(state.items)) {
        state.items.forEach(it => { it.solved = false; it.solvedBy = null; it.winnerAnswer = null; });
      } else {
        state = { items: [] };
      }
      return;
    }
  } catch (e) {}
  // Fallback state kosong, onComplete() akan dipanggil server saat game pertama start
  state = { items: [] };
}

function buildStatePayload() {
  return {
    items: state.items.map(it => ({
      number: it.number,
      shuffled: it.shuffled,      // kata-kata teracak (yang ditampilkan)
      wordCount: it.words.length, // hint jumlah kata
      solved: it.solved,
      solvedBy: it.solvedBy,
      // Kalimat asli hanya dibocorin setelah soal ini terjawab
      sentence: it.solved ? it.sentence : null
    })),
    totalSoal: state.items.length,
    solvedSoal: state.items.filter(it => it.solved).length
  };
}

function buildClueList() {
  return state.items.map(it => ({
    number: it.number,
    wordCount: it.words.length,
    shuffled: it.shuffled,
    solved: it.solved,
    sentence: it.solved ? it.sentence : null
  }));
}

function isComplete() {
  return state.items.length > 0 && state.items.every(it => it.solved);
}

function normalizeAnswer(s) {
  return s.toString().trim().toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function handleAnswer({ number, answer, player }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };

  const hasNumber = number !== null && number !== undefined && !Number.isNaN(Number(number));

  let candidates;
  if (hasNumber) {
    candidates = state.items.filter(it => it.number === Number(number));
    if (candidates.length === 0) return { ok: false, msg: 'Nomor tidak ditemukan' };
  } else {
    // Jawaban ditulis langsung tanpa nomor -- cocokkan ke semua soal
    // yang belum terjawab (sama kayak TTS/Cari Kata/Sambung Kata).
    candidates = state.items;
  }

  const normAnswer = normalizeAnswer(answer);
  const match = candidates.find(it => !it.solved && normalizeAnswer(it.sentence) === normAnswer);

  if (!match) {
    if (candidates.every(it => it.solved)) {
      return { ok: false, msg: hasNumber ? 'Soal ini sudah terjawab' : 'Semua soal sudah terjawab' };
    }
    return { ok: false, msg: 'Salah' };
  }

  match.solved = true;
  match.solvedBy = player || 'Anonim';
  match.winnerAnswer = answer;
  saveStateToDisk();

  return {
    ok: true,
    msg: 'Benar!',
    points: POINTS_PER_SOAL,
    meta: { number: match.number, sentence: match.sentence, solvedBy: match.solvedBy }
  };
}

async function preGenerate() {
  // Dipanggil di background — coba AI, simpan ke bank, jangan replace state aktif
  try {
    const items = await callAIGenerator();
    let saved = 0;
    for (const item of items) {
      if (saveFallbackSentence(item)) saved++;
    }
    return { success: true, source: 'ai', saved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function onComplete() {
  // Dipanggil saat ronde selesai (semua soal kejawab) — skip AI, langsung dari bank
  const result = await generateNewRound(true);
  return result;
}

function reset() {
  state.items.forEach(it => { it.solved = false; it.solvedBy = null; it.winnerAnswer = null; });
  saveStateToDisk();
}

// ---------- Fitur "nyerah": reveal 1 soal acak yang belum terjawab ----------

function revealRandomAnswer() {
  const unsolved = state.items.filter(it => !it.solved);
  if (unsolved.length === 0) return { ok: false, msg: 'Semua soal sudah terjawab' };

  const pick = unsolved[Math.floor(Math.random() * unsolved.length)];
  pick.solved = true;
  pick.solvedBy = 'Nyerah 🏳️';
  pick.winnerAnswer = pick.sentence;
  saveStateToDisk();

  return {
    ok: true,
    meta: { number: pick.number, sentence: pick.sentence, foundBy: 'Nyerah 🏳️' }
  };
}

// ---------- Comment parser -- metode SAMA kayak TTS (regex, tanpa AI) ----------
// Format 1: "<nomor> <jawaban>"                  contoh: "3 ibu memasak nasi goreng"
// Format 2: "nomor/no/nomer/number <nomor> <jawaban>"
// Format 3: "<jawaban> nomor/no/nomer/number <nomor>"
// Format 4: jawaban langsung TANPA nomor -- dicocokkan ke semua soal belum terjawab
async function parseComment(text) {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  if (['skip', 'ganti', 'nyerah'].includes(lower)) return null;

  const normalized = cleaned.replace(/\s+/g, ' ');

  let match = normalized.match(/^(\d+)[.\s]+(.+)$/);
  if (match) {
    return { number: parseInt(match[1], 10), answer: match[2].trim() };
  }

  match = normalized.match(/(?:nomor|no|nomer|number)\s*(\d+)\s+(.+)$/i);
  if (match) {
    return { number: parseInt(match[1], 10), answer: match[2].trim() };
  }

  match = normalized.match(/^(.+?)\s+(?:nomor|no|nomer|number)\s*(\d+)$/i);
  if (match) {
    return { number: parseInt(match[2], 10), answer: match[1].trim() };
  }

  // Jawaban langsung tanpa nomor -- minimal 7 karakter (kalimat paling pendek ~4 kata)
  if (!/^\d+$/.test(normalized) && normalized.length >= 7) {
    return { number: null, answer: normalized };
  }

  return null;
}

// ---------- Bank stats ----------

function getBankStats() {
  let used = [];
  try {
    if (fs.existsSync(USED_FILE)) used = JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
  } catch (e) {}
  return { total: getTotalCount(), used: used.length };
}

function resetBankCycle() {
  fs.writeFileSync(USED_FILE, JSON.stringify([], null, 2), 'utf8');
  return true;
}

module.exports = {
  id: 'susun-kalimat',
  init,
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
