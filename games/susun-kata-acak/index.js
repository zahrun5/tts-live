/**
 * Susun Kata Acak (Anagram) - 6 slot, 1 ronde
 *
 * Sama kayak game lain (TTS/Sambung Kata/Cari Kata/Family100): 1 ronde besar,
 * semua slot harus terjawab dulu baru ronde baru di-generate. Ini penting
 * biar isComplete() beneran nandain "ronde selesai" -- dipakai nanti buat
 * fitur rotasi game campuran (ganti jenis game otomatis pas 1 ronde kelar).
 *
 * BEDA dari versi lama: slot yang kejawab benar TETAP kelihatan jawabannya
 * (status 'solved') sampai SEMUA 6 slot kejawab -- nggak diganti sendiri-
 * sendiri lewat cooldown/setTimeout lagi. Begitu ke-6nya solved, onComplete()
 * dipanggil server.js buat generate 6 kata baru sekaligus.
 *
 * Sumber kata tetap wordbank statis + bank AI (word-bank.js) yang instan
 * diambil (bukan panggil AI real-time kayak Cari Kata), makanya nggak perlu
 * preGenerate() -- onComplete() langsung generate tanpa nunggu cache.
 */

const fs = require('fs');
const path = require('path');
const { pickNextWord, scrambleWord } = require('./word-bank');
const { getTotalCount: getAIBankCount } = require('./fallback-manager');

const USED_WORDS_FILE = path.join(__dirname, 'used-words.json');

const TOTAL_SLOTS = 6;
const POINTS_PER_ANSWER = 10;

// Jeda sebelum generate ronde baru pas semua slot udah solved, biar
// penonton sempat baca jawaban terakhir + siapa yang jawab. Berlaku juga
// pas dipaksa lewat SKIP (server.js manggil onComplete() yang sama buat
// kedua kasus, nggak ada cara beda-in trigger-nya dari sini).
const ROUND_COMPLETE_DELAY_MS = 3000;

let slots = []; // { id, answer, scrambled, status: 'active'|'solved', solvedBy, solvedAt }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fillSlot(id, excludeWords = []) {
  const word = pickNextWord(excludeWords);
  return {
    id,
    answer: word,
    scrambled: scrambleWord(word),
    status: 'active',
    solvedBy: null,
    solvedAt: null
  };
}

// Isi 6 slot sekaligus dalam 1 batch, saling exclude biar nggak ada kata
// dobel di ronde yang sama.
function fillAllSlots() {
  const fresh = [];
  const usedInBatch = [];
  for (let i = 1; i <= TOTAL_SLOTS; i++) {
    const slot = fillSlot(i, usedInBatch);
    usedInBatch.push(slot.answer);
    fresh.push(slot);
  }
  return fresh;
}

function init() {
  slots = fillAllSlots();
}

function buildStatePayload() {
  return {
    slots: slots.map(s => ({
      id: s.id,
      length: s.answer.length,
      scrambled: s.scrambled,
      status: s.status,
      // Jawaban cuma dibocorin ke frontend pas status "solved" (abis bener),
      // biar penonton bisa baca jawabannya -- pas "active" tetep dirahasiakan.
      answer: s.status === 'solved' ? s.answer : null,
      solvedBy: s.solvedBy
    })),
    foundCount: slots.filter(s => s.status === 'solved').length,
    totalCount: TOTAL_SLOTS
  };
}

function isComplete() {
  return slots.length > 0 && slots.every(s => s.status === 'solved');
}

function handleAnswer({ answer, player }) {
  if (!answer) return { ok: false, msg: 'Jawaban kosong' };

  const norm = s => s.toString().trim().toUpperCase().replace(/[^A-Z]/g, '');
  const normAnswer = norm(answer);
  if (!normAnswer) return { ok: false, msg: 'Jawaban kosong' };

  // Nggak perlu nomor slot lagi -- penonton tinggal ketik jawabannya aja,
  // dicariin sendiri di antara slot yang masih aktif (sama kayak pola
  // Family100/Sambung Kata/Cari Kata). Kata-kata dalam 1 batch udah dijamin
  // unik (lihat fillAllSlots -> excludeWords), jadi nggak bakal ambigu.
  const slot = slots.find(s => s.status === 'active' && norm(s.answer) === normAnswer);
  if (!slot) return { ok: false, msg: 'Salah' };

  slot.status = 'solved';
  slot.solvedBy = player || 'Anonim';
  slot.solvedAt = Date.now();

  return {
    ok: true,
    msg: 'Benar!',
    points: POINTS_PER_ANSWER,
    meta: { number: slot.id, answer: slot.answer }
  };
}

// Dipanggil server.js pas ronde beneran selesai (semua slot solved) ATAU
// pas fitur vote "SKIP" kepenuhin (paksa ganti walau belum semua kejawab) --
// server.js manggil fungsi yang sama buat kedua kasus.
async function onComplete() {
  await sleep(ROUND_COMPLETE_DELAY_MS);
  slots = fillAllSlots();
  return { success: true, source: 'wordbank' };
}

// Dipanggil server.js pas fitur "NYERAH" kepenuhin (komen NYERAH 10x).
// Buka 1 slot AKTIF secara acak -- pindah ke status "solved" nampilin
// jawabannya (sama kayak kalo ada yang jawab bener), TAPI nggak dikasih
// poin ke siapa-siapa (server.js sengaja gak manggil addScore buat reveal).
// Kalau kebetulan ini slot terakhir yang aktif, isComplete() otomatis jadi
// true abis ini -- server.js yang manggil handleRoundCompleted()-nya.
function revealRandomAnswer() {
  const activeSlots = slots.filter(s => s.status === 'active');
  if (activeSlots.length === 0) return { ok: false, msg: 'Semua slot udah terjawab, tunggu ronde baru' };

  const slot = activeSlots[Math.floor(Math.random() * activeSlots.length)];
  slot.status = 'solved';
  slot.solvedBy = 'Nyerah 🏳️';
  slot.solvedAt = Date.now();

  return {
    ok: true,
    meta: { number: slot.id, answer: slot.answer, foundBy: 'Nyerah 🏳️' }
  };
}

function reset() {
  init();
}

async function parseComment(text) {
  // Full regex/string, TANPA AI sama sekali -- sama kayak Sambung Kata &
  // Cari Kata. Penonton cukup ketik jawabannya doang, nggak perlu nomor
  // slot lagi (handleAnswer yang nyari sendiri slot mana yang cocok).
  const cleaned = text.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned || cleaned.length < 2) return null;
  return { answer: cleaned };
}

// Sama kayak getBankStats() punya Sambung Kata: "total" itu ukuran bank
// kata hasil AI (yang terus ditambah ai-worker.js di background), "used"
// itu berapa banyak yang udah kepakai baru-baru ini (riwayat cycle).
// Wordbank statis (fallback-wordbank.json) sengaja nggak dihitung di sini
// karena dia selalu ada & nggak pernah abis -- cuma "bonus" dari bank AI
// yang perlu dipantau.
function getBankStats() {
  let used = [];
  try {
    if (fs.existsSync(USED_WORDS_FILE)) {
      used = JSON.parse(fs.readFileSync(USED_WORDS_FILE, 'utf8'));
    }
  } catch (e) {}

  return {
    total: getAIBankCount(),
    used: used.length
  };
}

function resetBankCycle() {
  fs.writeFileSync(USED_WORDS_FILE, JSON.stringify([], null, 2), 'utf8');
  return true;
}

module.exports = {
  id: 'susun-kata-acak',
  init,
  buildStatePayload,
  handleAnswer,
  isComplete,
  onComplete,
  reset,
  parseComment,
  getBankStats,
  resetBankCycle,
  revealRandomAnswer
};
