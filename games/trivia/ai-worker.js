/**
 * Background AI Worker - Trivia
 *
 * Worker ini jalan terus di background (di-manage PM2).
 * Tugasnya cuma SATU: pastikan bank soal fallback cukup besar (target 500 soal).
 * Kalau kurang dari target, dia akan terus-terusan manggil AI sampai tercapai.
 * Kalau API limit, dia akan pause 5 menit lalu coba lagi.
 */

const { callAIGenerator } = require('./ai-question-generator');
const { saveFallbackQuestion, getTotalCount } = require('./fallback-manager');

const TARGET_BANK_SIZE = 500;
const RETRY_DELAY_MS = 10000;       // Tunggu 10 detik kalau AI gagal (bukan karena limit)
const RATE_LIMIT_DELAY_MS = 300000; // Tunggu 5 menit kalau kena rate limit

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWorker() {
  console.log('👷 [AI Worker] Memulai Trivia background worker...');

  while (true) {
    const currentCount = getTotalCount();

    if (currentCount >= TARGET_BANK_SIZE) {
      console.log(`👷 [AI Worker] Bank soal penuh (${currentCount}/${TARGET_BANK_SIZE}). Tidur 1 jam...`);
      await sleep(60 * 60 * 1000);
      continue;
    }

    console.log(`👷 [AI Worker] Bank soal kurang (${currentCount}/${TARGET_BANK_SIZE}). Memanggil AI...`);

    try {
      const q = await callAIGenerator([]);

      const saved = saveFallbackQuestion(q);
      if (saved) {
        console.log(`✅ [AI Worker] Berhasil! Bank soal sekarang: ${getTotalCount()}`);
      } else {
        console.log(`⚠️ [AI Worker] Soal duplikat, di-skip.`);
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
