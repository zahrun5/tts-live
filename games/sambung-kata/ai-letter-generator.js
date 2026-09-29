/**
 * AI Letter Generator - Sambung Kata
 *
 * Beda sama ai-question-generator.js punya Family 100: di sini AI diminta kasih
 * 1 set huruf dasar (base letters) + beberapa kata yang HANYA boleh dibentuk
 * dari huruf-huruf itu (subset, hitungan hurufnya gak boleh lebih dari yang
 * tersedia di base letters). Nggak ada clue -- penonton nebak kata langsung,
 * bukan dari deskripsi.
 *
 * Engine penempatan ke grid (generator.js, dkk) PERSIS SAMA kayak TTS,
 * cuma sumber katanya yang beda cara nyarinya.
 *
 * Sama kayak Family 100 sekarang: bank soal fallback disimpan lewat
 * fallback-manager.js (banyak file bank-*.json, auto-grow tiap kali AI
 * berhasil), dan ada ai-worker.js terpisah yang tugasnya cuma isi bank
 * itu di background -- generateNewRound() di sini dibikin skipAI-capable
 * biar pas dipanggil dari game (onComplete) bisa langsung pakai fallback
 * tanpa nunggu AI, sementara "coba AI dulu" cuma dipakai buat preGenerate.
 */

const fs = require('fs');
const path = require('path');
const { generateTTS } = require('./generator');
const { callAI: requestAI } = require('../../ai-client');
const { pickFallbackGroup, saveFallbackGroup } = require('./fallback-manager');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');
const USED_LETTERS_FILE = path.join(__dirname, 'used-base-letters.json');

const MAX_AI_ATTEMPTS = 1; // Kurangi attempt biar gak bikin server hang, AI worker yang urus retry
const USED_HISTORY_LIMIT = 2000;
const MIN_WORDS = 5; // sesuai permintaan: minimal 5 kata per set huruf
const TARGET_BASE_LETTER_COUNT = 7;

// ---------- Riwayat base letters (biar gak keulang set yang sama terus) ----------

function loadUsedBaseLetters() {
  try {
    if (!fs.existsSync(USED_LETTERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_LETTERS_FILE, 'utf8'));
  } catch (e) {
    console.error('Gagal baca used-base-letters.json, mulai dari kosong:', e.message);
    return [];
  }
}

function saveUsedBaseLetters(used, newOne) {
  const merged = [...used, newOne].slice(-USED_HISTORY_LIMIT);
  fs.writeFileSync(USED_LETTERS_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

// ---------- Validasi: kata cuma boleh pakai huruf dari base letters ----------

function letterCounts(str) {
  const counts = {};
  for (const ch of str) counts[ch] = (counts[ch] || 0) + 1;
  return counts;
}

function canFormFromBase(word, baseCounts) {
  const wordCounts = letterCounts(word);
  for (const [ch, need] of Object.entries(wordCounts)) {
    if (!baseCounts[ch] || baseCounts[ch] < need) return false;
  }
  return true;
}

// ---------- Panggil AI ----------

function buildPrompt(usedBaseLetters) {
  const excludeList = usedBaseLetters.length
    ? `\n\nJANGAN pakai set huruf dasar ini lagi (udah pernah dipakai baru-baru ini): ${usedBaseLetters.slice(-20).join(', ')}`
    : '';

  return `Buat 1 set huruf dasar sebanyak ${TARGET_BASE_LETTER_COUNT} huruf (huruf kapital, unik/tidak berulang) untuk game tebak-kata bahasa Indonesia, mirip "Word Cookies". Dari huruf dasar itu, cari MINIMAL ${MIN_WORDS + 2} kata bahasa Indonesia yang valid, dengan syarat KETAT:
1. Setiap kata HANYA boleh pakai huruf yang ada di set huruf dasar tersebut (tidak boleh ada huruf lain sama sekali).
2. Setiap huruf dalam 1 kata tidak boleh dipakai lebih banyak dari jumlah huruf itu di set dasar (karena huruf dasarnya masing-masing cuma 1x, kata juga cuma boleh pakai tiap huruf itu 1x).
3. Kata harus umum dan sering dipakai sehari-hari (bukan istilah teknis/jarang/bahasa daerah), panjang 3-7 huruf.
4. Usahakan kata-katanya saling berbagi banyak huruf yang sama biar nanti gampang disusun saling silang.
5. Jangan ulangi kata yang sama dua kali.${excludeList}

Jawab HANYA dalam format JSON (tanpa teks lain, tanpa markdown backticks), contoh:
{"baseLetters": "KERTAS", "words": ["KERAS", "SATE", "TERAS"]}`;
}

// Diekspor biar AI worker bisa pakai core logic-nya (sama pola kayak callAIGenerator di Family 100)
async function callAIGenerator(usedBaseLetters = []) {
  const prompt = buildPrompt(usedBaseLetters);

  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal game tebak-kata dari 1 set huruf dasar, bahasa Indonesia. Selalu jawab dalam format JSON object saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: prompt }
  ], { temperature: 0.8, max_tokens: 800, timeout: 20000 , difficulty: 'easy' });

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON valid: ${content.slice(0, 200)}`);
  }

  const baseLetters = String(parsed.baseLetters || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (baseLetters.length < 4) {
    throw new Error('AI tidak kasih base letters yang valid');
  }

  const baseCounts = letterCounts(baseLetters);

  if (!Array.isArray(parsed.words)) {
    throw new Error('AI tidak mengembalikan array words');
  }

  // Validasi KETAT server-side -- jangan percaya AI mentah-mentah.
  // Kata yang lolos aturan "harus subset dari base letters" doang yang dipakai,
  // sisanya dibuang diam-diam (bukan bikin seluruh percobaan gagal).
  const seen = new Set();
  const validWords = [];
  for (const raw of parsed.words) {
    const word = String(raw || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (word.length < 3 || word.length > 8) continue;
    if (seen.has(word)) continue;
    if (!canFormFromBase(word, baseCounts)) continue;
    seen.add(word);
    validWords.push(word);
  }

  if (validWords.length < MIN_WORDS) {
    throw new Error(`Kata valid setelah difilter cuma ${validWords.length}, minimal ${MIN_WORDS}`);
  }

  return { baseLetters, words: validWords };
}

// ---------- Assign direction otomatis + coba generate ----------

function sharedLetterCount(a, b) {
  const setA = new Set(a.split(''));
  let count = 0;
  for (const ch of b) if (setA.has(ch)) count++;
  return count;
}

// Karena semua kata di sini emang udah dijamin berbagi huruf yang sama
// (dari 1 base letters yang sama), assign direction gantian aja (across/down)
// berdasarkan urutan kata yang paling "nempel" ke yang lain -- kalau gagal,
// coba pola gantian yang dibalik sebelum nyerah ke attempt AI berikutnya.
function tryDirectionPatterns(words, baseLetters) {
  // Urutkan kata dari yang paling banyak share huruf sama kata lain (prioritas ditempatkan duluan)
  const sorted = [...words].sort((a, b) => {
    const scoreA = words.reduce((sum, w) => sum + (w === a ? 0 : sharedLetterCount(a, w)), 0);
    const scoreB = words.reduce((sum, w) => sum + (w === b ? 0 : sharedLetterCount(b, w)), 0);
    return scoreB - scoreA;
  });

  const patterns = [
    sorted.map((_, i) => (i % 2 === 0 ? 'across' : 'down')),
    sorted.map((_, i) => (i % 2 === 0 ? 'down' : 'across'))
  ];

  for (const pattern of patterns) {
    const groupWords = sorted.map((answer, i) => ({ answer, direction: pattern[i], clue: 'x' }));
    const result = generateTTS({ words: groupWords }, { verbose: false });
    if (result.success) {
      result.puzzle.baseLetters = baseLetters;
      return { success: true, puzzle: result.puzzle, groupWords };
    }
  }
  return { success: false, error: 'Semua pola arah gagal ditempatkan' };
}

// ---------- Main entrypoint untuk Game ----------
// skipAI = true -> langsung fallback (dipanggil pas ronde selesai, biar cepat)
// skipAI = false -> coba AI dulu (dipanggil pas preGenerate di background)

async function generateNewRound(skipAI = false) {
  const usedBaseLetters = loadUsedBaseLetters();
  let lastError = null;

  if (!skipAI) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
      try {
        console.log(`🤖 [Sambung Kata] Percobaan AI...`);
        const { baseLetters, words } = await callAIGenerator(usedBaseLetters);
        const built = tryDirectionPatterns(words, baseLetters);

        if (built.success) {
          saveUsedBaseLetters(usedBaseLetters, baseLetters);
          saveFallbackGroup({ name: baseLetters.toLowerCase(), baseLetters, words: built.groupWords }); // otomatis nambah bank soal
          fs.writeFileSync(PUZZLE_PATH, JSON.stringify(built.puzzle, null, 2), 'utf8');
          console.log(`✓ [Sambung Kata] Berhasil via AI (base: ${baseLetters}, ${words.length} kata)`);
          return { success: true, puzzle: built.puzzle, source: 'ai' };
        }

        lastError = built.error;
        console.warn(`⚠️  [Sambung Kata] AI berhasil generate tapi gagal ditempatkan: ${lastError}`);
      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️  [Sambung Kata] AI error: ${lastError}`);
      }
    }
  }

  console.log(`🔄 [Sambung Kata] ${skipAI ? 'Skip AI,' : 'AI gagal,'} pakai fallback...`);

  const group = pickFallbackGroup(usedBaseLetters);
  if (!group) {
    return { success: false, error: `AI gagal dan fallback kosong. Error: ${lastError}` };
  }

  const result = generateTTS({ words: group.words }, { verbose: false });
  if (!result.success) {
    return { success: false, error: `Fallback juga gagal: ${result.error}` };
  }

  result.puzzle.baseLetters = group.baseLetters;
  fs.writeFileSync(PUZZLE_PATH, JSON.stringify(result.puzzle, null, 2), 'utf8');
  saveUsedBaseLetters(usedBaseLetters, group.baseLetters);
  console.log(`✓ [Sambung Kata] Pakai fallback: "${group.name || group.baseLetters}"`);
  return { success: true, puzzle: result.puzzle, source: `fallback:${group.name || group.baseLetters}` };
}

module.exports = { generateNewRound, callAIGenerator, TARGET_BASE_LETTER_COUNT };
