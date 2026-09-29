/**
 * Fallback Manager - TTS
 *
 * Pola sama kayak fallback-manager.js punya Sambung Kata/Cari Kata: bank
 * grup kata+klue disimpan sebagai banyak file kecil (fallback/bank-001.json,
 * dst, maks MAX_GROUPS_PER_FILE grup per file) yang di-isi otomatis di
 * background oleh ai-worker.js.
 *
 * fallback-wordbank.json (static, udah ada dari awal) tetap dipakai
 * sebagai seed dasar -- getAllFallbackGroups() gabungin static + bank AI,
 * biar game nggak pernah kehabisan soal walau bank AI masih kosong pas
 * baru pertama kali deploy.
 */

const fs = require('fs');
const path = require('path');

const STATIC_FILE = path.join(__dirname, 'fallback-wordbank.json');
const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MAX_GROUPS_PER_FILE = 100;

if (!fs.existsSync(FALLBACK_DIR)) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
}

function loadStaticGroups() {
  try {
    return JSON.parse(fs.readFileSync(STATIC_FILE, 'utf8'));
  } catch (e) {
    console.error('Gagal baca fallback-wordbank.json:', e.message);
    return [];
  }
}

function getAllAIGroups() {
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json'));
  let allGroups = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (Array.isArray(data)) allGroups = allGroups.concat(data);
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }

  return allGroups;
}

// Gabungan grup statis (selalu ada dari awal) + grup hasil AI yang udah
// ditabung ai-worker.js ke fallback/bank-*.json. Kalau bank AI masih
// kosong (worker belum sempat isi), tetep jalan normal pakai grup statis
// doang -- nggak pernah nge-block game.
function getAllFallbackGroups() {
  return [...loadStaticGroups(), ...getAllAIGroups()];
}

function groupKey(group) {
  return group.words.map(w => w.answer).sort().join(',');
}

function saveFallbackGroup(group) {
  try {
    const key = groupKey(group);
    const allExisting = getAllFallbackGroups();
    const dupe = allExisting.some(g => groupKey(g) === key);
    if (dupe) return false; // Set kata ini udah ada, skip

    const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
    let targetFile = 'bank-001.json';
    let targetData = [];

    if (files.length > 0) {
      const lastFile = files[files.length - 1];
      const lastData = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, lastFile), 'utf8'));

      if (lastData.length < MAX_GROUPS_PER_FILE) {
        targetFile = lastFile;
        targetData = lastData;
      } else {
        const nextNum = parseInt(lastFile.match(/\d+/)[0], 10) + 1;
        targetFile = `bank-${String(nextNum).padStart(3, '0')}.json`;
      }
    }

    targetData.push(group);
    fs.writeFileSync(path.join(FALLBACK_DIR, targetFile), JSON.stringify(targetData, null, 2), 'utf8');
    console.log(`💾 [TTS] Grup AI "${group.name}" disimpan ke fallback (${targetFile})`);
    return true;
  } catch (e) {
    console.error('⚠️ [TTS] Gagal simpan grup ke fallback:', e.message);
    return false;
  }
}

// Pilih grup yang paling sedikit overlap sama used-words terbaru (biar
// kata nggak keulang berdekatan), sama seperti logic pickFallbackGroup
// lama yang ada di ai-question-generator.js.
function pickFallbackGroup(usedWords = []) {
  const all = getAllFallbackGroups();
  if (all.length === 0) return null;

  const scored = all.map(group => {
    const overlap = group.words.filter(w => usedWords.includes(w.answer)).length;
    return { group, overlap };
  });

  const minOverlap = Math.min(...scored.map(s => s.overlap));
  const candidates = scored.filter(s => s.overlap === minOverlap);

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick.group;
}

function getTotalCount() {
  return getAllAIGroups().length;
}

module.exports = {
  getAllFallbackGroups,
  saveFallbackGroup,
  pickFallbackGroup,
  getTotalCount
};
