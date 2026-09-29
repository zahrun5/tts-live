/**
 * Fallback Manager - Sambung Kata
 *
 * Meniru pola fallback-manager.js punya Family 100: bank soal disimpan
 * sebagai banyak file kecil (fallback/bank-001.json, bank-002.json, dst,
 * maks MAX_GROUPS_PER_FILE grup per file) supaya gampang di-scale dan
 * gampang dibaca manual kalau perlu.
 *
 * Bedanya sama Family 100: yang disimpan di sini bukan soal+jawaban,
 * tapi { name, baseLetters, words: [{answer, direction, clue}] } --
 * hasil generate yang SUDAH lolos validasi ketat + SUDAH berhasil
 * ditempatkan ke grid (biar bank isinya cuma grup yang beneran kepakai).
 */

const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MAX_GROUPS_PER_FILE = 100;

if (!fs.existsSync(FALLBACK_DIR)) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
}

function getAllFallbackGroups() {
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json'));
  let allGroups = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (Array.isArray(data)) {
        allGroups = allGroups.concat(data);
      }
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }

  return allGroups;
}

function saveFallbackGroup(group) {
  try {
    const allExisting = getAllFallbackGroups();
    const dupe = allExisting.some(g => g.baseLetters === group.baseLetters);
    if (dupe) return false; // Set huruf ini udah ada, skip

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
    console.log(`💾 Set huruf AI "${group.baseLetters}" disimpan ke fallback (${targetFile})`);
    return true;
  } catch (e) {
    console.error('⚠️ Gagal simpan grup ke fallback:', e.message);
    return false;
  }
}

function pickFallbackGroup(usedBaseLetters) {
  const all = getAllFallbackGroups();
  if (all.length === 0) return null;

  const notUsed = all.filter(g => !usedBaseLetters.includes(g.baseLetters));

  if (notUsed.length > 0) {
    // Sequential: ambil yang pertama belum kepakai (sama kayak Family 100)
    return notUsed[0];
  }

  // Semua udah kepakai, mulai dari awal lagi
  return all[0];
}

function getTotalCount() {
  return getAllFallbackGroups().length;
}

module.exports = {
  getAllFallbackGroups,
  saveFallbackGroup,
  pickFallbackGroup,
  getTotalCount
};
