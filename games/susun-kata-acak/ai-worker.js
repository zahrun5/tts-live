/**
 * Background AI Worker - Susun Kata Acak
 *
 * Pola sama persis kayak ai-worker.js punya Sambung Kata/Family 100:
 * jalan terus di background (di-manage PM2), tugasnya cuma pastiin bank
 * kata fallback cukup besar (target TARGET_BANK_SIZE). Kalau kurang,
 * terus manggil AI per-batch sampai tercapai. Kalau kena rate limit,
 * pause 5 menit baru coba lagi.
 */

const { callAIGenerator } = require('./ai-word-generator');
const { saveFallbackWord, getTotalCount } = require('./fallback-manager');

const TARGET_BANK_SIZE = 500;
const RETRY_DELAY_MS = 10000;       // Tunggu 10 detik kalau AI gagal (bukan karena limit)
const RATE_LIMIT_DELAY_MS = 300000; // Tunggu 5 menit kalau kena rate limit

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWorker() {
  console.log('👷 [AI Worker] Memulai Susun Kata Acak background worker...');

  while (true) {
    const currentCount = getTotalCount();

    if (currentCount >= TARGET_BANK_SIZE) {
      console.log(`👷 [AI Worker] Bank kata penuh (${currentCount}/${TARGET_BANK_SIZE}). Tidur 1 jam...`);
      await sleep(60 * 60 * 1000);
      continue;
    }

    console.log(`👷 [AI Worker] Bank kata kurang (${currentCount}/${TARGET_BANK_SIZE}). Memanggil AI...`);

    try {
      const words = await callAIGenerator();
      let savedCount = 0;
      for (const word of words) {
        if (saveFallbackWord(word)) savedCount++;
      }
      console.log(`✅ [AI Worker] ${savedCount}/${words.length} kata baru disimpan. Bank sekarang: ${getTotalCount()}`);

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
