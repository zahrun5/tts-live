/**
 * AI Word Generator - Cari Kata
 *
 * Minta AI kasih 1 tema + daftar kata bahasa Indonesia yang sesuai tema itu,
 * lalu ditempatkan ke grid 10x10 pakai grid-placement.js (horizontal/vertikal
 * aja, tanpa diagonal/terbalik).
 *
 * Sama kayak Sambung Kata: kalau AI gagal terus (3x percobaan), jatuh ke
 * fallback-wordbank.json biar ronde tetep bisa jalan.
 */

const fs = require('fs');
const path = require('path');
const { placeWithFallbackDrop, GRID_SIZE } = require('./grid-placement');
const { callAI: requestAI } = require('../../ai-client');
const { saveFallbackGroup, pickFallbackGroup } = require('./fallback-manager');

const PUZZLE_PATH = path.join(__dirname, 'puzzle.json');
const USED_THEMES_FILE = path.join(__dirname, 'used-themes.json');

const MAX_AI_ATTEMPTS = 3;
const USED_HISTORY_LIMIT = 15;

// Level config: grid size, word count range (ikut ARAH), directions
const LEVEL_CONFIG = {
  1: { size: 8, minWords: 8, maxWords: 10, wordLength: [3, 5], directions: 2 },
  2: { size: 10, minWords: 12, maxWords: 14, wordLength: [3, 8], directions: 4 },
  3: { size: 12, minWords: 16, maxWords: 18, wordLength: [3, 8], directions: 4 }
};

// Palet warna buat garis coretan tiap kata ketemu -- di-shuffle tiap ronde
// biar urutan warnanya nggak selalu sama.
const COLOR_PALETTE = [
  '#5eead4', '#f5b942', '#f472b6', '#8b6ef5',
  '#4ade80', '#60a5fa', '#fb923c', '#e879f9',
  '#facc15', '#38bdf8'
];

// ---------- Riwayat tema (biar gak keulang tema yang sama terus) ----------

function loadUsedThemes() {
  try {
    if (!fs.existsSync(USED_THEMES_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_THEMES_FILE, 'utf8'));
  } catch (e) {
    console.error('Gagal baca used-themes.json, mulai dari kosong:', e.message);
    return [];
  }
}

function saveUsedThemes(used, newOne) {
  const merged = [...used, newOne].slice(-USED_HISTORY_LIMIT);
  fs.writeFileSync(USED_THEMES_FILE, JSON.stringify(merged, null, 2), 'utf8');
}

// ---------- Panggil AI ----------

// Template tema dinamis & kombinasi biar gak monoton
const THEME_TEMPLATES = [
  // Kategori spesifik
  'Hewan yang hidup di {air/darat/udara}',
  'Buah berwarna {merah/kuning/hijau/ungu}',
  'Profesi yang bekerja di {rumah sakit/sekolah/kantor/lapangan}',
  'Kendaraan {darat/air/udara}',
  'Makanan yang {manis/asin/pedas/asam}',
  'Alat yang dipakai di {dapur/kamar mandi/taman/garasi}',
  'Benda yang terbuat dari {kayu/plastik/logam/kaca}',
  'Olahraga menggunakan {bola/raket/air}',
  'Pakaian untuk {pesta/olahraga/tidur/kerja}',
  'Tanaman {bunga/sayur/buah/hias}',
  
  // Kombinasi huruf
  'Hewan yang namanya diawali huruf {A/B/K/M/S}',
  'Nama kota di Indonesia huruf depan {B/J/S/M/P}',
  'Buah yang namanya ada huruf {N/G/M/R}',
  'Profesi yang berakhiran huruf {R/N/I/S}',
  
  // Kombinasi jumlah
  'Benda yang punya {roda/kaki/sayap}',
  'Hewan berkaki {dua/empat/banyak/tidak berkaki}',
  'Buah yang punya {biji/kulit tebal/kulit tipis}',
  
  // Lokasi spesifik
  'Benda yang ada di {kamar tidur/dapur/ruang tamu/kamar mandi}',
  'Hewan yang hidup di {hutan/laut/sungai/sawah/kebun}',
  'Tanaman yang tumbuh di {air/gunung/pantai/dataran rendah}',
  
  // Ukuran & bentuk
  'Benda {kecil/besar} yang sering dipakai sehari-hari',
  'Hewan {besar/kecil} yang jinak',
  'Buah berukuran {besar/kecil/sedang}',
  
  // Waktu & musim
  'Makanan untuk {sarapan/makan siang/camilan/makan malam}',
  'Kegiatan yang dilakukan {pagi/siang/malam} hari',
  
  // Fungsi spesifik
  'Alat untuk {memotong/memasak/membersihkan/menulis}',
  'Benda untuk {menyimpan/mengangkut/melindungi}',
  'Pakaian untuk melindungi {kepala/tangan/kaki/badan}'
];

function getRandomThemeIdea() {
  const template = THEME_TEMPLATES[Math.floor(Math.random() * THEME_TEMPLATES.length)];
  // Pilih salah satu opsi dalam kurung kurawal
  return template.replace(/\{([^}]+)\}/g, (match, options) => {
    const choices = options.split('/');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

function buildPrompt(usedThemes, level = 2) {
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[2];
  const targetWords = config.minWords + Math.floor(Math.random() * (config.maxWords - config.minWords + 1));
  const [minLen, maxLen] = config.wordLength;
  
  const themeIdea = getRandomThemeIdea();
  
  const excludeList = usedThemes.length
    ? `\n\nJANGAN pakai tema ini lagi (udah pernah dipakai baru-baru ini): ${usedThemes.join(', ')}`
    : '';

  return `Buat 1 tema SPESIFIK untuk game "Cari Kata" (word search) bahasa Indonesia, lalu kasih ${targetWords} kata bahasa Indonesia yang sesuai tema itu.

INSPIRASI TEMA (boleh pakai atau bikin variasi sendiri yang lebih kreatif):
"${themeIdea}"

CONTOH TEMA BAGUS:
- "Hewan yang hidup di air" (bukan cuma "Hewan")
- "Buah warna merah" (bukan cuma "Buah")
- "Profesi yang pakai seragam" (bukan cuma "Profesi")
- "Benda di dapur yang terbuat dari logam"
- "Olahraga menggunakan bola"

SYARAT:
1. Tiap kata cuma boleh huruf A-Z (tanpa spasi, tanpa tanda hubung, tanpa angka).
2. Panjang tiap kata antara ${minLen}-${maxLen} huruf.
3. Kata harus umum dan sering dipakai sehari-hari (bukan istilah teknis/jarang/bahasa daerah).
4. Jangan ulangi kata yang sama dua kali dalam 1 tema.
5. TEMA HARUS SPESIFIK DAN UNIK, bukan tema umum seperti "Hewan", "Buah", "Profesi" saja.${excludeList}

Jawab HANYA dalam format JSON (tanpa teks lain, tanpa markdown backticks), contoh:
{"theme": "Hewan yang hidup di air", "words": ["IKAN", "PAUS", "LUMBA", "GURITA", "UBUR", "HIU", "KEPITING", "UDANG"]}`;
}

async function callAI(prompt, level = 2) {
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[2];
  const [minLen, maxLen] = config.wordLength;
  
  const { content } = await requestAI([
    {
      role: 'system',
      content: 'Kamu adalah pembuat soal game Cari Kata (word search) bahasa Indonesia. Selalu jawab dalam format JSON object saja, tanpa teks tambahan, tanpa markdown backticks.'
    },
    { role: 'user', content: prompt }
  ], { temperature: 0.8, max_tokens: 500, timeout: 20000 , difficulty: 'easy' });

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`Response AI bukan JSON valid: ${content.slice(0, 200)}`);
  }

  const theme = String(parsed.theme || '').trim();
  if (!theme) throw new Error('AI tidak kasih tema yang valid');

  if (!Array.isArray(parsed.words)) {
    throw new Error('AI tidak mengembalikan array words');
  }

  // Validasi KETAT server-side -- jangan percaya AI mentah-mentah.
  const seen = new Set();
  const validWords = [];
  for (const raw of parsed.words) {
    const word = String(raw || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (word.length < minLen || word.length > maxLen) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    validWords.push(word);
  }

  if (validWords.length < config.minWords) {
    throw new Error(`Kata valid setelah difilter cuma ${validWords.length}, minimal ${config.minWords}`);
  }

  return { theme, words: validWords };
}

// ---------- Assign warna per kata (fixed sejak generate, dibuka pas ketemu) ----------

function assignColors(placedWords) {
  const shuffledColors = [...COLOR_PALETTE].sort(() => Math.random() - 0.5);
  return placedWords.map((w, i) => ({
    id: i,
    word: w.word,
    row: w.row,
    col: w.col,
    direction: w.direction,
    color: shuffledColors[i % shuffledColors.length],
    found: false
  }));
}

function writePuzzle(theme, placement, level = 2) {
  const puzzle = {
    theme,
    level,
    rows: placement.size,
    cols: placement.size,
    grid: placement.grid,
    words: assignColors(placement.words)
  };
  fs.writeFileSync(PUZZLE_PATH, JSON.stringify(puzzle, null, 2), 'utf8');
  return puzzle;
}

// Dipakai worker background (ai-worker.js) buat isi bank tanpa nyentuh
// puzzle.json/used-themes.json sama sekali -- 1 kali panggil AI, return
// {theme, words} mentah (belum ditempatkan ke grid).
async function callAIGenerator(usedThemes = [], level = 2) {
  const prompt = buildPrompt(usedThemes, level);
  return callAI(prompt, level);
}

// ---------- Main entrypoint ----------
//
// skipAI = false -> coba AI dulu (dipanggil pas preGenerate di background,
//                    delay beberapa detik nggak masalah karena penonton
//                    belum lihat apa-apa).
// skipAI = true  -> LANGSUNG pakai bank fallback (statis + hasil AI worker),
//                    dipanggil pas onComplete() di jalur live -- HARUS
//                    instan, nggak boleh nunggu AI sama sekali.
async function generateNewRound(level = 2, skipAI = false) {
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[2];
  const usedThemes = loadUsedThemes();
  let lastError = null;

  if (!skipAI) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
      try {
        console.log(`🤖 [Word Generator] Level ${level}, Percobaan ${attempt}/${MAX_AI_ATTEMPTS}...`);

        const { theme, words } = await callAIGenerator(usedThemes, level);
        console.log(`   Tema: ${theme}, ${words.length} kata valid`);

        const placement = placeWithFallbackDrop(words, {
          size: config.size,
          minWords: config.minWords,
          directions: config.directions
        });

        if (placement.success) {
          saveUsedThemes(usedThemes, theme);
          saveFallbackGroup({ theme, words, level }); // otomatis nambah bank soal
          const puzzle = writePuzzle(theme, placement, level);
          console.log(`✓ [Word Generator] Berhasil (level ${level}, tema: ${theme}, ${puzzle.words.length} kata muat di grid ${config.size}x${config.size})`);
          return { success: true, puzzle, source: 'ai', level };
        }

        lastError = placement.error;
        console.warn(`⚠️  [Word Generator] Percobaan ${attempt} gagal: ${lastError}`);
      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️  [Word Generator] Percobaan ${attempt} error: ${lastError}`);
      }
    }
    console.log('🔄 [Word Generator] Semua percobaan AI gagal, pakai bank fallback...');
  } else {
    console.log('⚡ [Word Generator] Skip AI, langsung pakai bank fallback (biar instan)...');
  }

  // Coba beberapa kandidat bank (bukan cuma 1) -- kalau kandidat pertama
  // ternyata gagal ditempatkan (misal jumlah kata kepotong terlalu abis
  // di-dedupe), coba kandidat lain sebelum turun level.
  //
  // Kalau bank belum ada tema yang cukup besar buat level yang diminta
  // (misal ai-worker.js belum sempat isi tema level 2/3), turun ke level
  // yang lebih kecil biar ronde TETAP bisa jalan instan -- live show
  // nggak boleh macet cuma karena bank belum penuh.
  const MAX_BANK_ATTEMPTS = 5;
  const levelsToTry = Object.keys(LEVEL_CONFIG)
    .map(Number)
    .filter(l => l <= level)
    .sort((a, b) => b - a); // dari level yang diminta, turun ke bawah

  for (const tryLevel of levelsToTry) {
    const tryConfig = LEVEL_CONFIG[tryLevel];

    for (let i = 0; i < MAX_BANK_ATTEMPTS; i++) {
      const group = pickFallbackGroup(usedThemes, tryConfig.minWords);
      if (!group) break;

      const placement = placeWithFallbackDrop(group.words, {
        size: tryConfig.size,
        minWords: tryConfig.minWords,
        directions: tryConfig.directions
      });

      if (placement.success) {
        saveUsedThemes(usedThemes, group.theme);
        const puzzle = writePuzzle(group.theme, placement, tryLevel);
        if (tryLevel !== level) {
          console.log(`⚠️  [Word Generator] Bank level ${level} belum cukup terisi, turun ke level ${tryLevel}.`);
        }
        console.log(`✓ [Word Generator] Berhasil pakai bank "${group.theme}" (level ${tryLevel})`);
        return { success: true, puzzle, source: `bank:${group.theme}`, level: tryLevel };
      }

      lastError = placement.error;
    }
  }

  return { success: false, error: `Bank fallback nggak ada yang cocok. Error terakhir: ${lastError}` };
}

module.exports = { generateNewRound, callAIGenerator, LEVEL_CONFIG };
