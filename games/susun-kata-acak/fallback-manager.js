/**
 * Fallback Manager - Susun Kata Acak
 *
 * Pola sama kayak fallback-manager.js punya Sambung Kata/Family 100: bank
 * kata disimpan sebagai banyak file kecil (fallback/bank-001.json, dst,
 * maks MAX_WORDS_PER_FILE per file) biar gampang di-scale dan gampang
 * dibaca manual kalau perlu. Isinya lebih simpel dari Sambung Kata --
 * cuma daftar kata polos (nggak perlu base letters/grid), karena di sini
 * tiap slot cuma butuh 1 kata buat diacak hurufnya.
 */

const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MAX_WORDS_PER_FILE = 200;

if (!fs.existsSync(FALLBACK_DIR)) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
}

function getAllFallbackWords() {
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json'));
  let allWords = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (Array.isArray(data)) allWords = allWords.concat(data);
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }

  return allWords;
}

function saveFallbackWord(word) {
  try {
    const clean = String(word || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (clean.length < 3) return false;

    const allExisting = getAllFallbackWords();
    if (allExisting.includes(clean)) return false; // udah ada, skip

    const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
    let targetFile = 'bank-001.json';
    let targetData = [];

    if (files.length > 0) {
      const lastFile = files[files.length - 1];
      const lastData = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, lastFile), 'utf8'));

      if (lastData.length < MAX_WORDS_PER_FILE) {
        targetFile = lastFile;
        targetData = lastData;
      } else {
        const nextNum = parseInt(lastFile.match(/\d+/)[0], 10) + 1;
        targetFile = `bank-${String(nextNum).padStart(3, '0')}.json`;
      }
    }

    targetData.push(clean);
    fs.writeFileSync(path.join(FALLBACK_DIR, targetFile), JSON.stringify(targetData, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('⚠️ Gagal simpan kata ke fallback:', e.message);
    return false;
  }
}

function getTotalCount() {
  return getAllFallbackWords().length;
}

module.exports = {
  getAllFallbackWords,
  saveFallbackWord,
  getTotalCount
};
