/**
 * AI Word Generator - Susun Kata Acak
 *
 * Beda sama ai-letter-generator.js punya Sambung Kata: di sini nggak ada
 * konsep base letters/grid sama sekali -- AI diminta kasih daftar kata
 * umum bahasa Indonesia aja (per-batch, misal 20 kata sekaligus), lolos
 * validasi ketat, terus ditabung ke fallback bank satu-satu.
 *
 * Dipanggil dari ai-worker.js (background, isi bank terus sampai target)
 * DAN opsional dari index.js kalau nanti mau ada tombol "top up manual".
 */

const { callAI: requestAI } = require('../../ai-client');

const BATCH_SIZE = 20;
const MIN_LEN = 3;
const MAX_LEN = 10;

function buildPrompt() {
  return `Buat daftar ${BATCH_SIZE} kata benda/kata umum bahasa Indonesia yang SERING dipakai sehari-hari (bukan istilah teknis, bukan bahasa daerah, bukan singkatan), panjang ${MIN_LEN}-${MAX_LEN} huruf, cocok buat game tebak-kata "susun huruf acak" (penonton nebak kata asli dari huruf yang diacak). Kata harus konkret/gampang dibayangkan (benda, hewan, tempat, aktivitas sehari-hari) -- HINDARI kata abstrak yang susah ditebak dari acakan hurufnya doang.

Jawab HANYA dalam format JSON array (tanpa teks lain, tanpa markdown backticks), contoh:
["KURSI", "SEPEDA", "GUNUNG", "MEMBACA"]`;
}

/**
 * @returns {Promise<string[]>} daftar kata yang udah lolos validasi (bisa aja < BATCH_SIZE)
 */
async function callAIGenerator() {
  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat daftar kata untuk game tebak-kata susun huruf acak, bahasa Indonesia. Selalu jawab dalam format JSON array saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: buildPrompt() }
  ], { temperature: 0.9, max_tokens: 600, timeout: 20000 , difficulty: 'easy' });

  let parsed;
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON array valid: ${content.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI tidak mengembalikan array kata');
  }

  // Validasi ketat server-side, sama filosofinya kayak generator lain di project ini:
  // kata yang lolos aja yang dipakai, sisanya dibuang diam-diam.
  const seen = new Set();
  const validWords = [];
  for (const raw of parsed) {
    const word = String(raw || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (word.length < MIN_LEN || word.length > MAX_LEN) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    validWords.push(word);
  }

  if (validWords.length === 0) {
    throw new Error('Semua kata dari AI gagal validasi');
  }

  return validWords;
}

module.exports = { callAIGenerator };
