/**
 * AI Sentence Generator - Susun Kalimat
 *
 * Minta AI bikin kalimat bahasa Indonesia yang pendek dan mudah dipahami,
 * 4-6 kata per kalimat. Kata-katanya diacak urutannya, penonton harus
 * nyusun balik jadi kalimat yang benar.
 *
 * Dipanggil dari ai-worker.js (background, isi bank terus sampai target)
 * dan dari index.js lewat generateNewRound().
 */

const { callAI: requestAI } = require('../../ai-client');

const BATCH_SIZE = 10;
const MIN_WORDS = 4;
const MAX_WORDS = 6;

function buildPrompt() {
  return `Buat ${BATCH_SIZE} kalimat bahasa Indonesia yang pendek dan mudah dipahami, cocok untuk game "susun kalimat" di live streaming TikTok.

SYARAT:
1. Setiap kalimat terdiri dari ${MIN_WORDS}-${MAX_WORDS} kata saja (tidak lebih, tidak kurang).
2. Kalimat harus natural, logis, dan umum dipakai sehari-hari (bukan kalimat aneh atau terlalu formal).
3. Gunakan variasi topik: aktivitas sehari-hari, alam, makanan, keluarga, sekolah, kerja, dll.
4. Hindari tanda baca selain titik di akhir. Hindari singkatan, angka, atau simbol.
5. Tiap kata harus bermakna (bukan kata sambung saja), sehingga ketika diacak urutannya tetap menantang tapi bisa ditebak.
6. Jangan ulangi kalimat yang sama.

Jawab HANYA dalam format JSON array of strings (tanpa teks lain, tanpa markdown backticks), contoh:
["Ibu memasak nasi goreng di dapur", "Anak-anak bermain bola di lapangan", "Ayah membaca koran setiap pagi"]`;
}

/**
 * @returns {Promise<Array<{sentence: string, words: string[]}>>}
 */
async function callAIGenerator() {
  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal game susun kalimat bahasa Indonesia. Selalu jawab dalam format JSON array of strings saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: buildPrompt() }
  ], { temperature: 0.85, max_tokens: 800, timeout: 20000 , difficulty: 'easy' });

  let parsed;
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON array valid: ${content.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI tidak mengembalikan array kalimat');
  }

  const seen = new Set();
  const valid = [];

  for (const raw of parsed) {
    const sentence = String(raw || '').trim().replace(/\.$/, '').trim();
    if (!sentence) continue;

    // Split jadi kata-kata, bersihkan
    const words = sentence.split(/\s+/).filter(w => w.length > 0);
    if (words.length < MIN_WORDS || words.length > MAX_WORDS) continue;

    const key = words.map(w => w.toUpperCase()).join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    valid.push({ sentence, words });
  }

  if (valid.length === 0) {
    throw new Error('Semua kalimat dari AI gagal validasi');
  }

  return valid;
}

module.exports = { callAIGenerator };
