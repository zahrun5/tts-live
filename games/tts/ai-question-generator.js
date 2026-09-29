/**
 * AI Question Generator - TTS Live
 *
 * Alur:
 * 1. Minta AI bikin POOL besar kata+klue (bukan cuma 10 pas-pasan).
 * 2. Dari pool itu, pilih sendiri (greedy, berdasarkan kesamaan huruf
 *    across<->down) subset ~10 kata yang paling mungkin bisa saling nyilang.
 * 3. Coba generateTTS() pakai subset itu. Kalau gagal, coba subset lebih
 *    kecil dulu sebelum ganti pool baru dari AI.
 * 4. Kalau semua percobaan AI gagal, fallback ke word bank lokal biar
 *    live streaming gak macet.
 */

const fs = require('fs');
const path = require('path');
const { generateTTSFromFile } = require('./generator');
const { callAI: requestAI } = require('../../ai-client');
const { saveFallbackGroup, pickFallbackGroup } = require('./fallback-manager');

const INPUT_FILE = path.join(__dirname, 'puzzle-input.json');
const OUTPUT_FILE = path.join(__dirname, 'puzzle.json');
const USED_WORDS_FILE = path.join(__dirname, 'used-words.json');

const MAX_AI_ATTEMPTS = 3;
const USED_WORDS_HISTORY_LIMIT = 60; // biar gak muter-muter kata itu lagi terus
const POOL_SIZE_TARGET = 22; // minta AI bikin sekitar segini
const SUBSET_MAX = 6; // target jumlah kata final (dicoba dari sini turun)
const SUBSET_MIN = 4; // paling kecil yang masih dianggap layak jadi puzzle

// ---------- Used words tracking ----------

function loadUsedWords() {
  try {
    if (!fs.existsSync(USED_WORDS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_WORDS_FILE, 'utf8'));
  } catch (e) {
    console.error('Gagal baca used-words.json, mulai dari kosong:', e.message);
    return [];
  }
}

function saveUsedWords(usedWords, newAnswers) {
  const merged = [...usedWords, ...newAnswers];
  const trimmed = merged.slice(-USED_WORDS_HISTORY_LIMIT);
  fs.writeFileSync(USED_WORDS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
}

// ---------- AI call: minta POOL besar, bukan set pas-pasan ----------

function buildPrompt(usedWords, feedback) {
  const excludeList = usedWords.length
    ? `\n\nJANGAN pakai kata-kata ini (sudah pernah dipakai baru-baru ini):\n${usedWords.join(', ')}`
    : '';

  const feedbackNote = feedback
    ? `\n\nCATATAN: Percobaan sebelumnya gagal cari kombinasi yang nyambung ("${feedback}"). Kali ini kasih variasi kata yang LEBIH BANYAK dan lebih beragam hurufnya biar makin gampang dicari kombinasi yang saling bersilangan.`
    : '';

  return `Buat POOL sekitar ${POOL_SIZE_TARGET} kata untuk bahan teka-teki silang (TTS) berbahasa Indonesia. Ini pool calon kata — nanti cuma sebagian yang dipakai, jadi buat SEBANYAK dan SEBERAGAM mungkin supaya banyak pilihan.

TINGKAT KESULITAN: MENENGAH KE BAWAH — ini buat penonton live, jangan sampai bikin puyeng.
1. Pakai kata yang BENERAN umum & sering dipakai sehari-hari (makanan, hewan peliharaan/ternak, benda rumah, anggota tubuh, aktivitas sehari-hari, warna, angka, dll). Hindari istilah teknis, jarang dipakai, atau bahasa daerah.
2. Clue harus lugas dan gampang ditebak — deskripsi langsung ke ciri paling gampang dikenali, BUKAN teka-teki berlapis atau majas.
3. Buat campuran arah "across" dan "down" kira-kira seimbang.
4. Setiap kata 3-6 huruf, huruf kapital semua, tanpa spasi/tanda baca.
5. USAHAKAN banyak kata yang berbagi huruf yang sama satu sama lain (biar gampang nyilang), tapi gak masalah kalau beberapa kata di pool ini gak kepakai nanti.
6. Jangan ulangi kata yang sama dua kali dalam list ini.${excludeList}${feedbackNote}

Jawab HANYA dalam format JSON array (tanpa teks lain, tanpa markdown backticks), contoh:
[
  {"answer": "NASI", "direction": "across", "clue": "Makanan pokok orang Indonesia"},
  {"answer": "IKAN", "direction": "down", "clue": "Hewan air bersisik"}
]`;
}

async function callAI(prompt) {
  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal teka-teki silang bahasa Indonesia. Selalu jawab dalam format JSON array saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: prompt }
  ], { temperature: 0.8, max_tokens: 1600, timeout: 20000 , difficulty: 'hard' });

  let words;
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    words = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON valid: ${content.slice(0, 200)}`);
  }

  if (!Array.isArray(words) || words.length === 0) {
    throw new Error('AI tidak mengembalikan array kata');
  }

  // Normalisasi + validasi ringan + dedupe sebelum diproses lebih lanjut
  const seen = new Set();
  const cleaned = [];
  for (const w of words) {
    const answer = String(w.answer || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    const clue = String(w.clue || '').trim();
    const direction = w.direction === 'down' ? 'down' : 'across';
    if (answer.length < 3 || answer.length > 8 || clue.length === 0) continue;
    if (seen.has(answer)) continue;
    seen.add(answer);
    cleaned.push({ answer, direction, clue });
  }

  if (cleaned.length < SUBSET_MIN) {
    throw new Error(`Pool AI terlalu kecil setelah dibersihkan (${cleaned.length} kata, minimal ${SUBSET_MIN})`);
  }

  return cleaned;
}

// ---------- Seleksi subset dari pool ----------

function sharedLetterCount(a, b) {
  const setA = new Set(a.split(''));
  let count = 0;
  for (const ch of b) if (setA.has(ch)) count++;
  return count;
}

// Skor cuma dihitung antar kata beda arah, karena yang bisa nyilang
// di grid TTS itu selalu across ketemu down.
function pairScore(w1, w2) {
  if (w1.direction === w2.direction) return 0;
  return sharedLetterCount(w1.answer, w2.answer);
}

/**
 * Pilih subset kata dari pool yang paling "nempel" satu sama lain,
 * secara greedy: mulai dari pasangan dengan skor tertinggi, lalu terus
 * tambahkan kata yang paling banyak nyambung ke yang sudah terpilih.
 */
function buildConnectedSubset(pool, targetSize) {
  if (pool.length < 2) return null;

  let best = null;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const score = pairScore(pool[i], pool[j]);
      if (!best || score > best.score) best = { i, j, score };
    }
  }
  if (!best || best.score === 0) return null; // gak ada satu pun pasangan yang nyambung

  const selected = [pool[best.i], pool[best.j]];
  const remaining = pool.filter((_, idx) => idx !== best.i && idx !== best.j);

  while (selected.length < targetSize && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = 0;
    remaining.forEach((cand, idx) => {
      const score = selected.reduce((sum, s) => sum + pairScore(s, cand), 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    if (bestIdx === -1) break; // gak ada kandidat lain yang masih nyambung
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  // Pastikan ada campuran arah yang wajar (minimal 2 masing-masing)
  const acrossCount = selected.filter((w) => w.direction === 'across').length;
  const downCount = selected.length - acrossCount;
  if (acrossCount < 2 || downCount < 2) return null;

  return selected;
}

/**
 * Coba build puzzle dari satu pool, dengan target size diturunkan bertahap
 * kalau ukuran besar gagal ditempatkan generator.js.
 */
function tryBuildFromPool(pool) {
  for (let targetSize = SUBSET_MAX; targetSize >= SUBSET_MIN; targetSize--) {
    const subset = buildConnectedSubset(pool, targetSize);
    if (!subset || subset.length < SUBSET_MIN) continue;

    fs.writeFileSync(INPUT_FILE, JSON.stringify({ words: subset }, null, 2), 'utf8');
    const result = generateTTSFromFile(INPUT_FILE, OUTPUT_FILE, { backup: true, verbose: false });

    if (result.success) {
      return { success: true, result, usedAnswers: subset.map((w) => w.answer), subset };
    }
    // gagal di ukuran ini, coba ukuran lebih kecil (loop lanjut)
    console.warn(`⚠️  [AI Generator] Subset ${subset.length} kata gagal: ${result.error}`);
  }
  return { success: false };
}

// Dipakai worker background (ai-worker.js) buat isi bank tanpa nyentuh
// puzzle.json/puzzle-input.json/used-words.json sama sekali -- 1 kali
// minta pool ke AI, return pool mentah (belum dipilih subset-nya).
async function callAIGenerator(usedWords = [], feedback = null) {
  const prompt = buildPrompt(usedWords, feedback);
  return callAI(prompt);
}

// ---------- Main entrypoint ----------
//
// skipAI = false -> coba AI dulu (dipanggil pas preGenerate di background,
//                    delay beberapa detik nggak masalah karena penonton
//                    belum lihat apa-apa).
// skipAI = true  -> LANGSUNG pakai bank fallback (statis + hasil AI worker),
//                    dipanggil pas onComplete() di jalur live -- HARUS
//                    instan, nggak boleh nunggu AI sama sekali.
async function generateNewPuzzle(skipAI = false) {
  const usedWords = loadUsedWords();
  let lastError = null;

  if (!skipAI) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
      try {
        console.log(`🤖 [AI Generator] Percobaan ${attempt}/${MAX_AI_ATTEMPTS} (minta pool ~${POOL_SIZE_TARGET} kata)...`);

        const pool = await callAIGenerator(usedWords, lastError);
        console.log(`   Pool diterima: ${pool.length} kata valid`);

        const built = tryBuildFromPool(pool);

        if (built.success) {
          saveUsedWords(usedWords, built.usedAnswers);
          saveFallbackGroup({ name: built.usedAnswers.slice(0, 3).join('-').toLowerCase(), words: built.subset }); // otomatis nambah bank soal
          console.log(`✓ [AI Generator] Berhasil di percobaan ${attempt} (${built.result.stats.gridSize}, ${built.usedAnswers.length} kata)`);
          return { success: true, puzzle: built.result.puzzle, source: 'ai', error: null };
        }

        lastError = 'tidak ada subset dari pool yang berhasil ditempatkan';
        console.warn(`⚠️  [AI Generator] Percobaan ${attempt} gagal: ${lastError}`);
      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️  [AI Generator] Percobaan ${attempt} error: ${lastError}`);
      }
    }
    console.log('🔄 [AI Generator] Semua percobaan AI gagal, pakai bank fallback...');
  } else {
    console.log('⚡ [AI Generator] Skip AI, langsung pakai bank fallback (biar instan)...');
  }

  // Coba beberapa kandidat bank -- kalau kandidat pertama gagal
  // ditempatkan, coba kandidat lain sebelum benar-benar nyerah.
  const MAX_BANK_ATTEMPTS = 5;
  for (let i = 0; i < MAX_BANK_ATTEMPTS; i++) {
    const fallbackGroup = pickFallbackGroup(usedWords);
    if (!fallbackGroup) break;

    fs.writeFileSync(INPUT_FILE, JSON.stringify({ words: fallbackGroup.words }, null, 2), 'utf8');
    const fallbackResult = generateTTSFromFile(INPUT_FILE, OUTPUT_FILE, { backup: true, verbose: false });

    if (fallbackResult.success) {
      saveUsedWords(usedWords, fallbackGroup.words.map((w) => w.answer));
      console.log(`✓ [AI Generator] Berhasil pakai bank "${fallbackGroup.name}"`);
      return { success: true, puzzle: fallbackResult.puzzle, source: `bank:${fallbackGroup.name}`, error: null };
    }

    lastError = fallbackResult.error;
  }

  return { success: false, puzzle: null, source: null, error: `Bank fallback nggak ada yang cocok. Error terakhir: ${lastError}` };
}

module.exports = { generateNewPuzzle, callAIGenerator, buildConnectedSubset };
