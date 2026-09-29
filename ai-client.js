/**
 * AI Client dengan rotasi model - TTS Live
 *
 * Satu titik terpusat buat manggil AI, biar ai-parser.js dan
 * ai-question-generator.js gak lagi punya model string sendiri-sendiri
 * yang bisa nyasar/beda (ini penyebab bug puzzle keulang kemarin).
 *
 * Kalau model pertama gagal (error HTTP ATAU sukses tapi content kosong),
 * otomatis coba model berikutnya di MODEL_ROTATION, sampai salah satu
 * berhasil atau semua abis.
 */

require('dotenv').config();
const axios = require('axios');

const AI_API_URL = 'http://192.168.100.99:20128/v1/chat/completions';
const API_KEY = process.env.OPENAI_API_KEY;

// Urutan rotasi: dari yang paling diutamakan ke yang paling cadangan.
// Model dari Kiro (prefix "kr/") SENGAJA tidak dimasukkan - kuotanya
// mau disisakan buat project lain.
const MODEL_ROTATION_HARD = [
  'ag/gemini-3.8-flash',
  'ag/claude-sonnet-4-6',
  'ag/gemini-3.7-flash'
];

const MODEL_ROTATION_MEDIUM = [
  'ag/gemini-3.7-flash-low',
  'ag/gemini-3.6-flash',
  'ag/gemini-3.8-flash-low'
];

const MODEL_ROTATION_EASY = [
  'ag/gemini-3.5-flash-low',
  'ag/gemini-3.6-flash-low',
  'ag/gemini-3.5-flash-extra-low',
  'openrouter/openrouter/free'
];

const DEFAULT_ROTATION = MODEL_ROTATION_HARD;

/**
 * Panggil AI dengan rotasi model.
 * @param {Array} messages - array messages format OpenAI chat completions
 * @param {Object} [options]
 * @param {number} [options.temperature=0.5]
 * @param {number} [options.max_tokens=500]
 * @param {number} [options.timeout=15000]
 * @param {string} [options.difficulty='hard'] - 'hard', 'medium', or 'easy'
 * @returns {Promise<{content: string, model: string}>}
 * @throws {Error} kalau SEMUA model di rotasi gagal
 */
async function callAI(messages, options = {}) {
  const { temperature = 0.5, max_tokens = 500, timeout = 15000, difficulty = 'hard' } = options;
  const errors = [];
  
  let rotation = DEFAULT_ROTATION;
  if (difficulty === 'easy') rotation = MODEL_ROTATION_EASY;
  else if (difficulty === 'medium') rotation = MODEL_ROTATION_MEDIUM;
  else if (difficulty === 'hard') rotation = MODEL_ROTATION_HARD;

  for (const model of rotation) {
    try {
      const response = await axios.post(AI_API_URL, {
        model,
        stream: false,
        messages,
        temperature,
        max_tokens
      }, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout
      });

      const content = response?.data?.choices?.[0]?.message?.content;
      if (content && content.trim() !== '') {
        return { content, model };
      }

      errors.push(`${model}: response kosong`);
      console.warn(`⚠️  [AI Client] ${model} balikin response kosong, coba model berikutnya...`);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      errors.push(`${model}: ${msg}`);
      console.warn(`⚠️  [AI Client] ${model} gagal (${msg}), coba model berikutnya...`);
    }
  }

  throw new Error(`Semua model AI di rotasi gagal: ${errors.join(' | ')}`);
}

module.exports = { callAI, MODEL_ROTATION_HARD, MODEL_ROTATION_MEDIUM, MODEL_ROTATION_EASY };