/**
 * Background AI Worker - TTS
 *
 * Pola sama persis kayak ai-worker.js punya Sambung Kata/Cari Kata: jalan
 * terus di background (di-manage PM2), tugasnya cuma pastiin bank grup
 * kata+klue cukup besar (target TARGET_BANK_SIZE). Kalau kurang, terus
 * manggil AI sampai tercapai. Kalau kena rate limit, pause 5 menit dulu.
 *
 * PENTING: worker ini nggak pernah nulis ke puzzle.json/puzzle-input.json/
 * used-words.json (file punya proses server yang lagi live) -- cuma nulis
 * ke fallback/bank-*.json lewat fallback-manager.js. Penempatan ke grid
 * (generateTTS, in-memory, TANPA nulis file) cuma dipakai buat VALIDASI
 * biar grup yang ditabung emang beneran bisa disusun jadi TTS.
 */

const { generateTTS } = require('./generator');
const { callAIGenerator, buildConnectedSubset } = require('./ai-question-generator');
const { saveFallbackGroup, getTotalCount } = require('./fallback-manager');

const TARGET_BANK_SIZE = 500;
const SUBSET_MAX = 11;
const SUBSET_MIN = 7;
const RETRY_DELAY_MS = 10000;       // Tunggu 10 detik kalau AI gagal (bukan karena limit)
const RATE_LIMIT_DELAY_MS = 300000; // Tunggu 5 menit kalau kena rate limit

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Coba build subset yang nyambung dari 1 pool, in-memory doang (nggak
// nulis puzzle.json), buat validasi sebelum ditabung ke bank.
function tryPlaceFromPool(pool) {
  for (let targetSize = SUBSET_MAX; targetSize >= SUBSET_MIN; targetSize--) {
    const subset = buildConnectedSubset(pool, targetSize);
    if (!subset || subset.length < SUBSET_MIN) continue;

    const result = generateTTS({ words: subset }, { verbose: false });
    if (result.success) return { success: true, subset };
  }
  return { success: false };
}

async function runWorker() {
  console.log('👷 [AI Worker] Memulai TTS background worker...');

  while (true) {
    const currentCount = getTotalCount();

    if (currentCount >= TARGET_BANK_SIZE) {
      console.log(`👷 [AI Worker] Bank soal penuh (${currentCount}/${TARGET_BANK_SIZE}). Tidur 1 jam...`);
      await sleep(60 * 60 * 1000);
      continue;
    }

    console.log(`👷 [AI Worker] Bank soal kurang (${currentCount}/${TARGET_BANK_SIZE}). Memanggil AI...`);

    try {
      const pool = await callAIGenerator([]);
      const placed = tryPlaceFromPool(pool);

      if (!placed.success) {
        console.log('⚠️ [AI Worker] Pool gagal ditempatkan ke grid, di-skip.');
        await sleep(2000);
        continue;
      }

      const name = placed.subset.slice(0, 3).map(w => w.answer).join('-').toLowerCase();
      const saved = saveFallbackGroup({ name, words: placed.subset });
      if (saved) {
        console.log(`✅ [AI Worker] Berhasil! Bank soal sekarang: ${getTotalCount()}`);
      } else {
        console.log('⚠️ [AI Worker] Grup duplikat, di-skip.');
      }

      // Jeda bentar biar gak nyepam API
      await sleep(2000);

    } catch (err) {
      const errMsg = err.message || '';
      console.error(`❌ [AI Worker] Gagal: ${errMsg}`);

      if (errMsg.includes('429') || errMsg.includes('Rate limit') || errMsg.includes('timeout')) {
        console.log('⏳ [AI Worker] Terdeteksi rate limit / timeout. Istirahat 5 menit...');
        await sleep(RATE_LIMIT_DELAY_MS);
      } else {
        console.log('⏳ [AI Worker] Error lain. Coba lagi dalam 10 detik...');
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
}

runWorker().catch(e => console.error('Worker crash:', e));
