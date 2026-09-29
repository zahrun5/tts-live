/**
 * Word Bank - Susun Kata Acak
 *
 * Beda sama Sambung Kata/TTS: di sini nggak butuh AI generate real-time,
 * karena tiap slot perlu diganti CEPAT (tiap kali kejawab + cooldown 3-5
 * detik) — manggil AI per-kata bakal kelamaan dan gampang gagal pas live.
 *
 * Jadi sumber katanya cukup wordbank statis (fallback-wordbank.json) yang
 * di-cycle pake riwayat used-words.json (mirip pola used-words TTS), biar
 * kata nggak keulang-ulang berdekatan tapi tetep instan diambil.
 */

const fs = require('fs');
const path = require('path');
const { getAllFallbackWords } = require('./fallback-manager');

const WORDBANK_PATH = path.join(__dirname, 'fallback-wordbank.json');
const USED_WORDS_PATH = path.join(__dirname, 'used-words.json');
const USED_HISTORY_LIMIT = 300; // digedein karena sumber kata sekarang gabungan static + bank AI

// Gabungan kata statis (fallback-wordbank.json, selalu ada dari awal) +
// kata hasil AI yang udah ditabung ai-worker.js ke fallback/bank-*.json.
// Kalau bank AI masih kosong (worker belum sempat isi), tetep jalan normal
// pakai wordbank statis doang -- nggak pernah nge-block game.
function loadWordbank() {
  const staticWords = JSON.parse(fs.readFileSync(WORDBANK_PATH, 'utf8'));
  const aiWords = getAllFallbackWords();
  return Array.from(new Set([...staticWords, ...aiWords]));
}

function loadUsedWords() {
  try {
    if (!fs.existsSync(USED_WORDS_PATH)) return [];
    return JSON.parse(fs.readFileSync(USED_WORDS_PATH, 'utf8'));
  } catch (e) {
    console.error('⚠️ [Susun Kata Acak] Gagal baca used-words.json, mulai dari kosong:', e.message);
    return [];
  }
}

function saveUsedWords(used) {
  fs.writeFileSync(USED_WORDS_PATH, JSON.stringify(used.slice(-USED_HISTORY_LIMIT), null, 2), 'utf8');
}

/**
 * Ambil 1 kata baru dari wordbank yang belum kepakai di daftar `excludeWords`
 * (kata-kata yang lagi AKTIF di slot lain, biar 6 slot nggak dobel) DAN
 * belum ada di riwayat used-words terbaru (biar nggak keulang berdekatan
 * lintas ronde). Kalau semua kehabisan, mulai cycle dari awal lagi.
 */
function pickNextWord(excludeWords = []) {
  const bank = loadWordbank();
  const used = loadUsedWords();
  const excludeSet = new Set(excludeWords.map(w => w.toUpperCase()));

  let candidates = bank.filter(w => !used.includes(w) && !excludeSet.has(w));
  if (candidates.length === 0) {
    candidates = bank.filter(w => !excludeSet.has(w));
  }
  if (candidates.length === 0) {
    // Kepepet banget (wordbank lebih kecil dari 6 slot) -- ambil random dari semua
    candidates = bank;
  }

  const word = candidates[Math.floor(Math.random() * candidates.length)];
  saveUsedWords([...used, word]);
  return word;
}

/**
 * Acak huruf 1 kata. Dijamin hasilnya beda dari kata asli (kecuali kata
 * cuma 1 huruf unik berulang semua, misal "AAAA" -- kasus ini nggak ada
 * di wordbank kita karena minimal panjang 3 huruf dan bukan kata aneh).
 */
function scrambleWord(word) {
  const letters = word.split('');
  let attempt = 0;
  let scrambled = word;

  while (scrambled === word && attempt < 20) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    scrambled = letters.join('');
    attempt++;
  }

  return scrambled;
}

module.exports = { pickNextWord, scrambleWord, loadWordbank };
