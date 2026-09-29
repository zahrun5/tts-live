/**
 * Fallback Manager - Susun Kalimat
 *
 * Bank kalimat disimpan sebagai banyak file kecil (fallback/bank-001.json, dst,
 * maks MAX_SENTENCES_PER_FILE per file). Isinya array of { sentence, words }.
 */

const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MAX_SENTENCES_PER_FILE = 100;

if (!fs.existsSync(FALLBACK_DIR)) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
}

function getAllFallbackSentences() {
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
  let all = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (Array.isArray(data)) all = all.concat(data);
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }

  return all;
}

function saveFallbackSentence(item) {
  try {
    const all = getAllFallbackSentences();
    const dupe = all.some(s => s.sentence === item.sentence);
    if (dupe) return false;

    const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
    let targetFile = 'bank-001.json';
    let targetData = [];

    if (files.length > 0) {
      const lastFile = files[files.length - 1];
      const lastData = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, lastFile), 'utf8'));

      if (lastData.length < MAX_SENTENCES_PER_FILE) {
        targetFile = lastFile;
        targetData = lastData;
      } else {
        const nextNum = parseInt(lastFile.match(/\d+/)[0], 10) + 1;
        targetFile = `bank-${String(nextNum).padStart(3, '0')}.json`;
      }
    }

    targetData.push(item);
    fs.writeFileSync(path.join(FALLBACK_DIR, targetFile), JSON.stringify(targetData, null, 2), 'utf8');
    console.log(`💾 Kalimat "${item.sentence}" disimpan ke fallback (${targetFile})`);
    return true;
  } catch (e) {
    console.error('⚠️ Gagal simpan kalimat ke fallback:', e.message);
    return false;
  }
}

function pickFallbackSentence(usedSentences) {
  const all = getAllFallbackSentences();
  if (all.length === 0) return null;

  const notUsed = all.filter(s => !usedSentences.includes(s.sentence));
  if (notUsed.length > 0) return notUsed[0];

  // Semua sudah dipakai, mulai dari awal
  return all[0];
}

/**
 * Ambil beberapa kalimat sekaligus (buat 1 ronde isi 4-6 soal), tanpa duplikat
 * dalam ronde yang sama. Kalau bank yang belum kepake nggak cukup, boleh
 * pinjam dari yang udah pernah dipakai (siklus ulang) biar ronde tetap penuh.
 */
function pickFallbackSentences(usedSentences, count) {
  const all = getAllFallbackSentences();
  if (all.length === 0) return [];

  const notUsed = all.filter(s => !usedSentences.includes(s.sentence));
  const pool = notUsed.length >= count ? notUsed : all;

  const poolCopy = [...pool];
  const picked = [];
  while (picked.length < count && poolCopy.length > 0) {
    const idx = Math.floor(Math.random() * poolCopy.length);
    picked.push(poolCopy.splice(idx, 1)[0]);
  }
  return picked;
}

function getTotalCount() {
  return getAllFallbackSentences().length;
}

module.exports = {
  getAllFallbackSentences,
  saveFallbackSentence,
  pickFallbackSentence,
  pickFallbackSentences,
  getTotalCount
};
