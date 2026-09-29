/**
 * Background AI Worker - Sambung Kata
 *
 * Worker ini jalan terus di background (di-manage PM2), sama persis polanya
 * kayak ai-worker.js punya Family 100. Tugasnya cuma SATU: pastikan bank
 * fallback (set huruf + kata) cukup besar (misal minimal 1000 set).
 * Kalau kurang dari target, dia akan terus-terusan manggil AI sampai tercapai.
 * Kalau API limit, dia akan pause 5 menit lalu coba lagi.
 *
 * Beda sama Family 100: hasil AI di sini masih perlu lolos tryDirectionPatterns
 * (ditempatkan ke grid) dulu sebelum layak disimpan ke bank -- kalau gagal
 * ditempatkan, dianggap gagal generate dan langsung coba set huruf baru lagi.
 */

const path = require('path');
const { generateTTS } = require('./generator');
const { callAIGenerator } = require('./ai-letter-generator');
const { saveFallbackGroup, getTotalCount } = require('./fallback-manager');

const TARGET_BANK_SIZE = 1000;
const RETRY_DELAY_MS = 10000;       // Tunggu 10 detik kalau AI gagal (bukan karena limit)
const RATE_LIMIT_DELAY_MS = 300000; // Tunggu 5 menit kalau kena rate limit

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sama kayak sharedLetterCount + tryDirectionPatterns di ai-letter-generator.js,
// diduplikasi ringkas di sini biar worker gak nunggu import balik ke game state.
function sharedLetterCount(a, b) {
  const setA = new Set(a.split(''));
  let count = 0;
  for (const ch of b) if (setA.has(ch)) count++;
  return count;
}

function tryPlaceWords(words, baseLetters) {
  const sorted = [...words].sort((a, b) => {
    const scoreA = words.reduce((sum, w) => sum + (w === a ? 0 : sharedLetterCount(a, w)), 0);
    const scoreB = words.reduce((sum, w) => sum + (w === b ? 0 : sharedLetterCount(b, w)), 0);
    return scoreB - scoreA;
  });

  const patterns = [
    sorted.map((_, i) => (i % 2 === 0 ? 'across' : 'down')),
    sorted.map((_, i) => (i % 2 === 0 ? 'down' : 'across'))
  ];

  for (const pattern of patterns) {
    const groupWords = sorted.map((answer, i) => ({ answer, direction: pattern[i], clue: 'x' }));
    const result = generateTTS({ words: groupWords }, { verbose: false });
    if (result.success) return { success: true, groupWords };
  }
  return { success: false, error: 'Semua pola arah gagal ditempatkan' };
}

async function runWorker() {
  console.log('👷 [AI Worker] Memulai Sambung Kata background worker...');

  while (true) {
    const currentCount = getTotalCount();

    if (currentCount >= TARGET_BANK_SIZE) {
      console.log(`👷 [AI Worker] Bank soal penuh (${currentCount}/${TARGET_BANK_SIZE}). Tidur 1 jam...`);
      await sleep(60 * 60 * 1000);
      continue;
    }

    console.log(`👷 [AI Worker] Bank soal kurang (${currentCount}/${TARGET_BANK_SIZE}). Memanggil AI...`);

    try {
      // Kita gak peduli riwayat used-base-letters di sini, karena saveFallbackGroup
      // udah check duplicate berdasarkan baseLetters.
      const { baseLetters, words } = await callAIGenerator([]);
      const placed = tryPlaceWords(words, baseLetters);

      if (!placed.success) {
        console.log(`⚠️ [AI Worker] Set "${baseLetters}" gagal ditempatkan ke grid, di-skip.`);
        await sleep(2000);
        continue;
      }

      const saved = saveFallbackGroup({ name: baseLetters.toLowerCase(), baseLetters, words: placed.groupWords });
      if (saved) {
        console.log(`✅ [AI Worker] Berhasil! Bank soal sekarang: ${getTotalCount()}`);
      } else {
        console.log(`⚠️ [AI Worker] Set huruf duplikat, di-skip.`);
      }

      // Jeda bentar biar gak nyepam API
      await sleep(2000);

    } catch (err) {
      const errMsg = err.message || '';
      console.error(`❌ [AI Worker] Gagal: ${errMsg}`);

      if (errMsg.includes('429') || errMsg.includes('Rate limit') || errMsg.includes('timeout')) {
        console.log(`⏳ [AI Worker] Terdeteksi rate limit / timeout. Istirahat 5 menit...`);
        await sleep(RATE_LIMIT_DELAY_MS);
      } else {
        console.log(`⏳ [AI Worker] Error lain. Coba lagi dalam 10 detik...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
}

runWorker().catch(e => console.error('Worker crash:', e));
