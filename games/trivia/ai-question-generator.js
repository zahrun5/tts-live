/**
 * AI Question Generator - Trivia
 *
 * Minta AI bikin 1 soal pilihan ganda bahasa Indonesia (4 opsi A-D, 1 jawaban
 * benar). Divalidasi ketat server-side sebelum dipakai.
 *
 * Strategi:
 * - AI worker jalan di background ngisi bank soal fallback.
 * - generateNewRound(skipAI=false): coba AI dulu 1x, kalau gagal pakai bank.
 * - generateNewRound(skipAI=true): langsung pakai bank, dipakai di onComplete().
 */

const fs = require('fs');
const path = require('path');
const { callAI: requestAI } = require('../../ai-client');
const { pickFallbackQuestion, saveFallbackQuestion } = require('./fallback-manager');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');
const USED_QUESTIONS_FILE = path.join(__dirname, 'used-questions.json');
const FALLBACK_FILE = path.join(__dirname, 'fallback-questions.json');

const MAX_AI_ATTEMPTS = 1; // Kurangi attempt biar gak bikin server hang, AI worker yang urus retry
const USED_HISTORY_LIMIT = 2000;
const LETTERS = ['A', 'B', 'C', 'D'];

// ---------- Riwayat soal (biar gak keulang pertanyaan yang sama terus) ----------

function loadUsedQuestions() {
  try {
    if (!fs.existsSync(USED_QUESTIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_QUESTIONS_FILE, 'utf8'));
  } catch (e) {
    console.error('Gagal baca used-questions.json, mulai dari kosong:', e.message);
    return [];
  }
}

function saveUsedQuestions(used, newOne) {
  const merged = [...used, newOne].slice(-USED_HISTORY_LIMIT);
  fs.writeFileSync(USED_QUESTIONS_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

// ---------- Panggil AI ----------

function buildPrompt(usedQuestions) {
  const excludeList = usedQuestions.length
    ? `\n\nJANGAN bikin pertanyaan yang mirip/sama kayak ini (udah pernah dipakai baru-baru ini):\n${usedQuestions.join('\n')}`
    : '';

  return `Buat 1 soal trivia pilihan ganda bahasa Indonesia untuk live streaming, dengan syarat:\n1. Kategori bebas (pengetahuan umum, sains, geografi, sejarah, olahraga, makanan, hiburan, dll), tapi HARUS soal yang jawabannya pasti/tidak ambigu.\n2. Ada tepat 4 opsi jawaban (A, B, C, D), cuma 1 yang benar.\n3. Pertanyaan singkat, jelas, dan cocok dijawab cepat lewat komentar live (bukan soal yang butuh mikir lama/hitungan rumit).\n4. Opsi jawaban singkat (maksimal beberapa kata), jangan ada 2 opsi yang mirip/bisa dianggap sama-sama benar.${excludeList}\n\nJawab HANYA dalam format JSON (tanpa teks lain, tanpa markdown backticks), contoh:\n{"category": "Sains", "question": "Planet apa yang dijuluki 'Planet Merah'?", "options": [{"letter":"A","text":"Venus"},{"letter":"B","text":"Jupiter"},{"letter":"C","text":"Mars"},{"letter":"D","text":"Saturnus"}], "correctLetter": "C"}`;
}

// Diekspor biar AI worker bisa pakai core logic-nya
async function callAIGenerator(usedQuestions = []) {
  const prompt = buildPrompt(usedQuestions);

  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal trivia pilihan ganda bahasa Indonesia. Selalu jawab dalam format JSON object saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: prompt }
  ], { temperature: 0.85, max_tokens: 400, timeout: 20000 , difficulty: 'easy' });

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON valid: ${content.slice(0, 200)}`);
  }

  return validateQuestion(parsed);
}

// Validasi KETAT server-side -- jangan percaya AI mentah-mentah.
function validateQuestion(parsed) {
  const category = String(parsed.category || 'Pengetahuan Umum').trim();
  const question = String(parsed.question || '').trim();

  if (!question || question.length < 5) {
    throw new Error('AI tidak kasih pertanyaan yang valid');
  }

  if (!Array.isArray(parsed.options) || parsed.options.length !== 4) {
    throw new Error('AI tidak kasih tepat 4 opsi jawaban');
  }

  const options = [];
  const seenTexts = new Set();

  for (let i = 0; i < parsed.options.length; i++) {
    const raw = parsed.options[i] || {};
    const letter = LETTERS[i]; // paksa urutan A-D, jangan percaya letter dari AI
    const text = String(raw.text || '').trim();

    if (!text) throw new Error(`Opsi ${letter} kosong`);

    const normText = text.toUpperCase();
    if (seenTexts.has(normText)) throw new Error('Ada 2 opsi jawaban yang isinya sama');
    seenTexts.add(normText);

    options.push({ letter, text });
  }

  const correctLetter = String(parsed.correctLetter || '').trim().toUpperCase();
  if (!LETTERS.includes(correctLetter)) {
    throw new Error(`correctLetter tidak valid: "${correctLetter}"`);
  }

  return { category, question, options, correctLetter };
}

function writePuzzle(q) {
  const puzzle = {
    category: q.category,
    question: q.question,
    options: q.options,
    correctLetter: q.correctLetter,
    answered: false,
    winnerLetter: null
  };
  fs.writeFileSync(PUZZLE_PATH, JSON.stringify(puzzle, null, 2), 'utf8');
  return puzzle;
}

// ---------- Fallback lokal (file statis lama, tetap dipertahankan sebagai lapis terakhir) ----------

function loadStaticFallbackQuestions() {
  try {
    return JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8'));
  } catch (e) {
    console.error('Gagal baca fallback-questions.json:', e.message);
    return [];
  }
}

function pickStaticFallback(usedQuestions) {
  const bank = loadStaticFallbackQuestions();
  if (bank.length === 0) return null;
  const notUsed = bank.filter(q => !usedQuestions.includes(q.question));
  const pool = notUsed.length > 0 ? notUsed : bank;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- Main entrypoint ----------

async function generateNewRound(skipAI = false) {
  const usedQuestions = loadUsedQuestions();
  let lastError = null;

  if (!skipAI) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
      try {
        console.log(`🤖 [Trivia Game] Percobaan AI...`);
        const q = await callAIGenerator(usedQuestions);
        console.log(`   Kategori: ${q.category}, soal: ${q.question.slice(0, 50)}...`);

        saveUsedQuestions(usedQuestions, q.question);
        saveFallbackQuestion(q); // otomatis nambah bank soal
        const puzzle = writePuzzle(q);
        console.log(`✓ [Trivia Game] Berhasil via AI (kategori: ${q.category})`);
        return { success: true, puzzle, source: 'ai' };
      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️  [Trivia Game] AI error: ${lastError}`);
      }
    }
  }

  console.log(`🔄 [Trivia Game] ${skipAI ? 'Skip AI,' : 'AI gagal,'} pakai bank soal...`);

  // Coba bank AI dulu (fallback/)
  const bankQ = pickFallbackQuestion(usedQuestions);
  if (bankQ) {
    saveUsedQuestions(usedQuestions, bankQ.question);
    const puzzle = writePuzzle(bankQ);
    console.log(`✓ [Trivia Game] Pakai bank: "${bankQ.question.slice(0, 50)}..."`);
    return { success: true, puzzle, source: 'bank' };
  }

  // Terakhir: static fallback lama
  console.log('🔄 [Trivia Game] Bank kosong, pakai fallback statis...');
  const staticQ = pickStaticFallback(usedQuestions);
  if (!staticQ) {
    return { success: false, error: `AI gagal dan semua bank kosong. Error terakhir: ${lastError}` };
  }

  saveUsedQuestions(usedQuestions, staticQ.question);
  const puzzle = writePuzzle(staticQ);
  console.log(`✓ [Trivia Game] Pakai fallback statis "${staticQ.question.slice(0, 50)}..."`);
  return { success: true, puzzle, source: 'fallback' };
}

module.exports = { generateNewRound, callAIGenerator };
