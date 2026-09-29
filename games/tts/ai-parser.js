/**
 * AI Agent untuk parsing komen natural language
 * Mengekstrak nomor soal, jawaban, dan arah dari berbagai format komen
 * Menggunakan 9router AI API
 */

const { callAI: requestAI } = require('../../ai-client');

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
  const cleanText = stripDirectionWords(text);

  // Coba regex DULUAN -- instan, tanpa network/inference. Format komentar
  // paling umum ("3 kursi", "nomor 3 kursi", "kursi nomor 3") udah kecover
  // regex ini, jadi mayoritas komentar nggak perlu nunggu AI sama sekali.
  // AI cuma dipanggil sebagai fallback buat format yang aneh/nggak standar
  // (misal "empat jawabannya air") yang regex gagal parse.
  const regexResult = parseAnswerRegex(cleanText, direction);
  if (regexResult && regexResult.number && regexResult.answer) {
    return regexResult;
  }

  try {
    const prompt = `Ekstrak nomor soal dan jawaban dari komentar berikut: "${cleanText}"

Komentar bisa dalam berbagai format seperti:
- "1 jakarta"
- "nomor 1 jakarta"
- "no tiga bali"
- "sate nomor 5"
- "empat jawabannya air"

Jawab HANYA dalam format JSON: {"number": <angka>, "answer": "<jawaban>"}
Jika tidak bisa diparsing, jawab: {"error": "tidak dapat diparsing"}`;

    const { content: aiResponse } = await requestAI([
      {
        role: "system",
        content: "Kamu adalah parser yang mengekstrak nomor soal dan jawaban dari komentar TTS. Selalu jawab dalam format JSON saja, tanpa teks tambahan."
      },
      {
        role: "user",
        content: prompt
      }
		], { temperature: 0.1, max_tokens: 400, timeout: 8000 });

    if (!aiResponse || aiResponse.trim() === '') {
      console.error('Empty AI response');
      return parseAnswerRegex(cleanText, direction);
    }
    
    // Parse JSON response
    let parsed;
    try {
      // Coba ekstrak JSON dari response (kadang AI kasih backticks)
      const jsonMatch = aiResponse.match(/\{[^}]+\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(aiResponse.trim());
      }
    } catch (e) {
      console.error('Error parsing AI response:', aiResponse);
      return parseAnswerRegex(cleanText, direction);
    }

    if (parsed.error || !parsed.number || !parsed.answer) {
      return parseAnswerRegex(cleanText, direction);
    }

    return {
      number: parseInt(parsed.number),
      answer: stripDirectionWords(parsed.answer).trim().toLowerCase(),
      direction
    };

  } catch (error) {
    console.error('Error calling AI API:', error.message);
    // Fallback ke regex parser
    return parseAnswerRegex(cleanText, direction);
  }
}

// Fallback regex parser (jika AI API gagal)
const wordToNumber = {
  'satu': 1, 'se': 1, 'atu': 1,
  'dua': 2, 'du': 2,
  'tiga': 3, 'ti': 3,
  'empat': 4, 'pat': 4,
  'lima': 5, 'lim': 5,
  'enam': 6, 'nam': 6,
  'tujuh': 7, 'juh': 7,
  'delapan': 8, 'lapan': 8,
  'sembilan': 9, 'bilan': 9,
  'sepuluh': 10, 'puluh': 10
};

function convertWordToNumber(text) {
  const words = text.toLowerCase().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (wordToNumber[words[i]]) {
      words[i] = wordToNumber[words[i]].toString();
    }
  }
  return words.join(' ');
}

function parseAnswerRegex(text, direction) {
  let normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  normalized = convertWordToNumber(normalized);
  
  let match = normalized.match(/^(\d+)[\.\s]+(.+)$/);
  if (match) {
    return { number: parseInt(match[1]), answer: match[2].trim(), direction };
  }
  
  match = normalized.match(/(?:nomor|no|nomer|number)\s*(\d+)\s+(.+)$/);
  if (match) {
    return { number: parseInt(match[1]), answer: match[2].trim(), direction };
  }
  
  match = normalized.match(/^(.+?)\s+(?:nomor|no|nomer|number)\s*(\d+)$/);
  if (match) {
    return { number: parseInt(match[2]), answer: match[1].trim(), direction };
  }
  
  return null;
}

module.exports = { parseAnswer };