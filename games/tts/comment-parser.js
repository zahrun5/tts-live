/**
 * Parser komentar TTS -- TANPA AI.
 *
 * Sebelumnya parseAnswer() manggil AI buat "memahami" komentar penonton
 * (misal "sate nomor 5"), yang bikin delay lumayan berat pas live
 * (timeout AI sampe 8 detik per komentar). Sekarang parsing full regex,
 * instan, dengan 2 format yang didukung:
 *
 *   1. "<nomor> <jawaban>"       contoh: "3 jakarta"  (angka literal, BUKAN "tiga")
 *   2. "<jawaban>" langsung      contoh: "jakarta"    (tanpa nomor sama sekali --
 *                                                        dicocokkan ke semua kata
 *                                                        yang belum terisi)
 *
 * Beberapa variasi umum lain ("nomor 3 jakarta", "jakarta nomor 3") juga
 * masih didukung biar komentar natural penonton tetep kebaca, tapi
 * SEMUANYA lewat regex -- nggak ada panggilan AI/network sama sekali.
 */

// Kata arah -> normalisasi ke 'across' / 'down' biar bisa dicocokkan
// langsung ke field "direction" di puzzle.json
const DIRECTION_PATTERNS = [
  { regex: /\b(mendatar|horizontal|kesamping|across)\b/i, value: 'across' },
  { regex: /\b(menurun|vertikal|kebawah|down)\b/i, value: 'down' }
];

function extractDirection(text) {
  for (const { regex, value } of DIRECTION_PATTERNS) {
    if (regex.test(text)) return value;
  }
  return null;
}

const DIRECTION_WORDS = /\b(mendatar|menurun|horizontal|vertikal|kesamping|kebawah|across|down)\b/gi;

function stripDirectionWords(text) {
  return text.replace(DIRECTION_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

async function parseAnswer(text) {
  const direction = extractDirection(text);
  const cleanText = stripDirectionWords(text).trim();

  if (!cleanText) return null;

  const normalized = cleanText.toLowerCase().replace(/\s+/g, ' ');

  // Format 1: "<nomor> <jawaban>" atau "<nomor>. <jawaban>" -- format utama
  // yang diminta: "3 jakarta", BUKAN "tiga jakarta".
  let match = normalized.match(/^(\d+)[.\s]+(.+)$/);
  if (match) {
    return { number: parseInt(match[1], 10), answer: match[2].trim(), direction };
  }

  // Format 2: "nomor/no/nomer/number <nomor> <jawaban>"
  match = normalized.match(/(?:nomor|no|nomer|number)\s*(\d+)\s+(.+)$/);
  if (match) {
    return { number: parseInt(match[1], 10), answer: match[2].trim(), direction };
  }

  // Format 3: "<jawaban> nomor/no/nomer/number <nomor>"
  match = normalized.match(/^(.+?)\s+(?:nomor|no|nomer|number)\s*(\d+)$/);
  if (match) {
    return { number: parseInt(match[2], 10), answer: match[1].trim(), direction };
  }

  // Format 4: jawaban langsung TANPA nomor sama sekali, misal cuma "jakarta".
  // Ditolak kalau isinya cuma angka doang (nggak jelas itu nomor atau jawaban).
  if (!/^\d+$/.test(normalized) && normalized.length >= 2) {
    return { number: null, answer: normalized, direction };
  }

  return null;
}

module.exports = { parseAnswer };
