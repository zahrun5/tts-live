/**
 * Background AI Worker - Susun Kalimat
 *
 * Jalan terus di background (di-manage PM2). Pastikan bank kalimat
 * cukup besar (target 500 kalimat). Kalau kena rate limit, pause 5 menit.
 */

const { callAIGenerator } = require('./ai-sentence-generator');
const { saveFallbackSentence, getTotalCount } = require('./fallback-manager');

const TARGET_BANK_SIZE = 500;
const RETRY_DELAY_MS = 10000;
const RATE_LIMIT_DELAY_MS = 300000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWorker() {
  console.log('👷 [AI Worker] Memulai Susun Kalimat background worker...');

  while (true) {
    const currentCount = getTotalCount();

    if (currentCount >= TARGET_BANK_SIZE) {
      console.log(`👷 [AI Worker] Bank kalimat penuh (${currentCount}/${TARGET_BANK_SIZE}). Tidur 1 jam...`);
      await sleep(60 * 60 * 1000);
      continue;
    }

    console.log(`👷 [AI Worker] Bank kalimat kurang (${currentCount}/${TARGET_BANK_SIZE}). Memanggil AI...`);

    try {
      const sentences = await callAIGenerator();
      let savedCount = 0;
      for (const item of sentences) {
        if (saveFallbackSentence(item)) savedCount++;
      }
      console.log(`✅ [AI Worker] ${savedCount}/${sentences.length} kalimat baru disimpan. Bank sekarang: ${getTotalCount()}`);

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
