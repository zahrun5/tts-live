/**
 * Fallback Manager - Cari Kata
 *
 * Pola sama kayak fallback-manager.js punya Sambung Kata/Family 100: bank
 * tema disimpan sebagai banyak file kecil (fallback/bank-001.json, dst,
 * maks MAX_GROUPS_PER_FILE grup per file) yang di-isi otomatis di
 * background oleh ai-worker.js.
 *
 * fallback-wordbank.json (static, udah ada dari awal) tetap dipakai
 * sebagai seed dasar -- getAllFallbackGroups() gabungin static + bank AI,
 * biar game nggak pernah kehabisan tema walau bank AI masih kosong pas
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

function loadStaticThemes() {
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

// Gabungan tema statis (selalu ada dari awal) + tema hasil AI yang udah
// ditabung ai-worker.js ke fallback/bank-*.json. Kalau bank AI masih
// kosong (worker belum sempat isi), tetep jalan normal pakai tema statis
// doang -- nggak pernah nge-block game.
function getAllFallbackGroups() {
  return [...loadStaticThemes(), ...getAllAIGroups()];
}

function saveFallbackGroup(group) {
  try {
    const allExisting = getAllFallbackGroups();
    const dupe = allExisting.some(g => g.theme === group.theme);
    if (dupe) return false; // Tema ini udah ada, skip

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
    console.log(`💾 [Cari Kata] Tema AI "${group.theme}" disimpan ke fallback (${targetFile})`);
    return true;
  } catch (e) {
    console.error('⚠️ [Cari Kata] Gagal simpan tema ke fallback:', e.message);
    return false;
  }
}

// minWords: kalau dikasih, cuma pilih grup yang jumlah katanya cukup buat
// level yang lagi dipakai -- biar nggak pilih tema yang keburu gagal
// ditempatkan gara-gara kurang kata (misal tema statis lama cuma isi 8
// kata tapi lagi butuh level yang minimal 12 kata).
function pickFallbackGroup(usedThemes = [], minWords = 0) {
  let all = getAllFallbackGroups();
  if (all.length === 0) return null;

  if (minWords > 0) {
    const eligible = all.filter(g => g.words.length >= minWords);
    if (eligible.length > 0) all = eligible;
    // Kalau nggak ada satupun yang cukup kata, tetep coba semua (biar
    // placeWithFallbackDrop yang nanti mutuskan gagal/berhasil).
  }

  const notUsed = all.filter(g => !usedThemes.includes(g.theme));
  const pool = notUsed.length > 0 ? notUsed : all;

  return pool[Math.floor(Math.random() * pool.length)];
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
