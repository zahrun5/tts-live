/**
 * AI Question Generator - Family 100
 */

const fs = require('fs');
const path = require('path');
const { callAI: requestAI } = require('../../ai-client');
const { pickFallbackQuestion, saveFallbackQuestion } = require('./fallback-manager');

const QUESTION_PATH = path.join(__dirname, 'question.json');
const USED_QUESTIONS_FILE = path.join(__dirname, 'used-questions.json');

const MAX_AI_ATTEMPTS = 1; // Kurangi attempt biar gak bikin server hang, AI worker yang urus retry
const USED_HISTORY_LIMIT = 2000;
const TOTAL_ANSWERS = 15;
const BOARD_SLOTS = 7;

function generatePoints(count) {
  const points = [];
  const max = 30;
  const min = 3;
  for (let i = 0; i < count; i++) {
    const p = Math.round(max - ((max - min) * i / (count - 1)));
    points.push(p);
  }
  return points;
}

function loadUsedQuestions() {
  try {
    if (!fs.existsSync(USED_QUESTIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_QUESTIONS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveUsedQuestions(used, newOne) {
  const merged = [...used, newOne].slice(-USED_HISTORY_LIMIT);
  fs.writeFileSync(USED_QUESTIONS_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

const QUESTION_TEMPLATES = [
  'Sebutkan hewan yang hidup di {darat/laut/udara}',
  'Sebutkan negara yang ada di {Asia/Eropa/Afrika}',
  'Sebutkan jenis {buah-buahan/sayuran/makanan khas Indonesia}',
  'Sebutkan {warna/cabang olahraga/alat musik} yang kamu tahu',
  'Sebutkan benda yang ada di {dapur/kamar tidur/kamar mandi/ruang kelas/kantor}',
  'Sebutkan jenis {kendaraan/profesi atau pekerjaan/burung/serangga/minuman} yang kamu tahu',
  'Sebutkan anggota tubuh manusia',
  'Sebutkan nama {pulau/gunung} di Indonesia',
  'Sebutkan jenis {cuaca/perasaan atau emosi manusia} yang kamu tahu',
  'Sebutkan bagian-bagian rumah',
  'Sebutkan alat tulis atau perlengkapan sekolah',
  'Sebutkan bahan makanan pokok di dapur',
  'Sebutkan alat pertukangan yang kamu tahu',
  'Sebutkan benda elektronik yang ada di rumah'
];

function getRandomQuestionIdea() {
  const template = QUESTION_TEMPLATES[Math.floor(Math.random() * QUESTION_TEMPLATES.length)];
  return template.replace(/\{([^}]+)\}/g, (match, options) => {
    const choices = options.split('/');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

function buildPrompt(usedQuestions) {
  const idea = getRandomQuestionIdea();
  const excludeList = usedQuestions.length
    ? `\n\nJANGAN pakai pertanyaan atau tema ini (sudah pernah): ${usedQuestions.join(', ')}`
    : '';

  return `Buat 1 pertanyaan MUDAH ala game "Family 100" berbahasa Indonesia yang jawabannya berupa daftar hal-hal umum/pengetahuan umum (kategori), lalu berikan 15 jawaban yang benar dan masuk akal.

INSPIRASI TEMA (Gunakan ini atau buat variasi baru yang sejenis, tetap kategori pengetahuan umum yang mudah):
"${idea}"

SYARAT MUTLAK:
1. Pertanyaan HARUS berupa permintaan menyebutkan anggota suatu kategori yang jelas dan objektif (contoh: hewan, negara, warna, buah, profesi, benda di suatu tempat). JANGAN membuat pertanyaan opini/survei subjektif (seperti "menurutmu kenapa..." atau "apa yang akan kamu lakukan jika...").
2. Kategori harus benar-benar punya minimal 15 jawaban yang valid dan umum diketahui orang Indonesia.
3. Berikan TEPAT ${TOTAL_ANSWERS} jawaban, semuanya harus BENAR secara faktual (bukan karangan/opini).
4. Urutkan jawaban dari yang PALING UMUM/PALING MUDAH terpikirkan hingga yang PALING JARANG (tapi tetap benar).
5. Tiap jawaban HARUS SATU KATA SAJA (boleh kata majemuk dengan tanda hubung seperti "KUPU-KUPU" atau "ABU-ABU"), gunakan huruf kapital. JANGAN pakai jawaban 2 kata terpisah spasi.
6. Tidak boleh ada jawaban yang maknanya sama/duplikat dalam satu soal.
7. Pertanyaan dan jawaban harus gampang ditebak anak-anak maupun orang dewasa, cocok untuk permainan santai yang cepat.${excludeList}

Jawab HANYA dalam format JSON (tanpa teks lain, tanpa markdown backticks), contoh:
{"question": "Sebutkan hewan yang hidup di darat", "answers": ["SAPI", "KAMBING", "KUDA", "GAJAH", "JERAPAH", "SINGA", "HARIMAU", "KUCING", "ANJING", "KELINCI", "RUSA", "ZEBRA", "BADAK", "KERBAU", "MONYET"]}
`;
}

// Diekspor biar AI worker bisa pakai core logic-nya
async function callAIGenerator(usedQuestions = []) {
  const prompt = buildPrompt(usedQuestions);
  
  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal game Family 100 bahasa Indonesia bergaya MUDAH (kategori pengetahuan umum, bukan survei opini). Selalu jawab dalam format JSON object saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: prompt }
  ], { temperature: 0.85, max_tokens: 600, timeout: 20000 , difficulty: 'medium' });

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON valid: ${content.slice(0, 200)}`);
  }

  const question = String(parsed.question || '').trim();
  if (!question) throw new Error('AI tidak kasih pertanyaan yang valid');

  if (!Array.isArray(parsed.answers)) {
    throw new Error('AI tidak mengembalikan array answers');
  }

  const seen = new Set();
  const validAnswers = [];
  for (const raw of parsed.answers) {
    const answer = String(raw || '').trim().toUpperCase();
    if (!answer || answer.length > 20) continue;
    const normKey = answer.replace(/[^A-Z]/g, '');
    if (seen.has(normKey)) continue;
    seen.add(normKey);
    validAnswers.push(answer);
  }

  if (validAnswers.length < TOTAL_ANSWERS) {
    throw new Error(`Jawaban valid cuma ${validAnswers.length}, butuh ${TOTAL_ANSWERS}`);
  }

  return { question, answers: validAnswers.slice(0, TOTAL_ANSWERS) };
}

function buildQuestion(question, answers) {
  const points = generatePoints(answers.length);
  const answerList = answers.map((text, i) => ({
    id: i,
    text,
    points: points[i],
    found: false,
    foundBy: null
  }));

  const state = {
    question,
    answers: answerList,
    board: Array(BOARD_SLOTS).fill(null),
    boardSlots: BOARD_SLOTS
  };

  fs.writeFileSync(QUESTION_PATH, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

// ---------- Main entrypoint untuk Game ----------

async function generateNewRound(skipAI = false) {
  const usedQuestions = loadUsedQuestions();
  let lastError = null;

  if (!skipAI) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
      try {
        console.log(`🤖 [Family100 Game] Percobaan AI...`);
        const { question, answers } = await callAIGenerator(usedQuestions);
        
        saveUsedQuestions(usedQuestions, question);
        saveFallbackQuestion(question, answers); // otomatis nambah bank soal
        
        const state = buildQuestion(question, answers);
        console.log(`✓ [Family100 Game] Berhasil via AI: "${question}"`);
        return { success: true, state, source: 'ai' };
      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️  [Family100 Game] AI error: ${lastError}`);
      }
    }
  }

  console.log(`🔄 [Family100 Game] ${skipAI ? 'Skip AI,' : 'AI gagal,'} pakai fallback...`);

  const fallback = pickFallbackQuestion(usedQuestions);
  if (!fallback) {
    return { success: false, error: `AI gagal dan fallback kosong. Error: ${lastError}` };
  }

  saveUsedQuestions(usedQuestions, fallback.question);
  const state = buildQuestion(fallback.question, fallback.answers);
  console.log(`✓ [Family100 Game] Pakai fallback: "${fallback.question}"`);
  return { success: true, state, source: `fallback:${fallback.question}` };
}

module.exports = { 
  generateNewRound, 
  callAIGenerator, 
  BOARD_SLOTS, 
  TOTAL_ANSWERS 
};
