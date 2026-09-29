/**
 * Grid Placement - Cari Kata
 *
 * Nempatin daftar kata ke grid dengan ukuran & arah configurable.
 * Support 2 arah (H+V) atau 4 arah (H+V+diagonal).
 */

const GRID_SIZE = 10;
const MAX_ATTEMPTS_PER_WORD = 300;
const MAX_FULL_ATTEMPTS = 40;

const DIRECTIONS = {
  2: ['horizontal', 'vertical'],
  4: ['horizontal', 'vertical', 'diagonal-down', 'diagonal-up']
};

function createEmptyGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

function randInt(max) {
  return Math.floor(Math.random() * max);
}

// Coba taruh 1 kata ke grid yang sudah ada isinya (grid dimodifikasi in-place kalau berhasil).
// Prioritaskan penempatan yang bersilangan dengan kata lain minimal 1 huruf.
function tryPlaceWord(grid, word, size, allowedDirections, placedCount = 0) {
  const directions = allowedDirections || DIRECTIONS[2];
  const requireIntersection = placedCount >= 1; // Setelah kata pertama, wajib bersilangan
  
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WORD; attempt++) {
    const direction = directions[randInt(directions.length)];
    let row, col, dr, dc;

    if (direction === 'horizontal') {
      if (word.length > size) continue;
      row = randInt(size);
      col = randInt(size - word.length + 1);
      dr = 0; dc = 1;
    } else if (direction === 'vertical') {
      if (word.length > size) continue;
      row = randInt(size - word.length + 1);
      col = randInt(size);
      dr = 1; dc = 0;
    } else if (direction === 'diagonal-down') {
      if (word.length > size) continue;
      row = randInt(size - word.length + 1);
      col = randInt(size - word.length + 1);
      dr = 1; dc = 1;
    } else if (direction === 'diagonal-up') {
      if (word.length > size) continue;
      row = word.length - 1 + randInt(size - word.length + 1);
      col = randInt(size - word.length + 1);
      dr = -1; dc = 1;
    }

    let fits = true;
    let hasIntersection = false;
    
    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const existing = grid[r][c];
      
      if (existing !== null) {
        if (existing !== word[i]) {
          fits = false;
          break;
        }
        hasIntersection = true;
      }
    }

    if (!fits) continue;
    
    // Kalau udah ada 2+ kata di grid, wajib bersilangan minimal 1 huruf
    if (requireIntersection && !hasIntersection) continue;

    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      grid[r][c] = word[i];
    }

    return { word, row, col, direction };
  }

  return null;
}

function fillRandomLetters(grid, size) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null) {
        grid[r][c] = ALPHABET[randInt(ALPHABET.length)];
      }
    }
  }
}

// Coba taruh SEMUA kata di `words` (array string uppercase) ke grid kosong baru.
// Kalau ada 1 aja yang gagal ditempatkan, seluruh attempt dianggap gagal
// dan dicoba lagi dari awal (urutan kata diacak ulang tiap attempt).
function placeAllWords(words, size = GRID_SIZE, allowedDirections = null) {
  for (let attempt = 0; attempt < MAX_FULL_ATTEMPTS; attempt++) {
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    // Kata lebih panjang ditaruh duluan (lebih susah cari slot, jadi diprioritaskan)
    shuffled.sort((a, b) => b.length - a.length);

    const grid = createEmptyGrid(size);
    const placed = [];
    let success = true;

    for (const word of shuffled) {
      const result = tryPlaceWord(grid, word, size, allowedDirections, placed.length);
      if (!result) {
        success = false;
        break;
      }
      placed.push(result);
    }

    if (success) {
      fillRandomLetters(grid, size);
      return { success: true, grid, words: placed };
    }
  }

  return { success: false };
}

// Coba taruh semua kata; kalau nggak muat semua, buang kata secara acak satu-satu
// sampai muat atau sampai sisa kata di bawah minWords (baru dianggap gagal total).
function placeWithFallbackDrop(words, { size = GRID_SIZE, minWords = 5, directions = 2 } = {}) {
  let candidates = [...new Set(words)]; // buang duplikat kalau ada
  const allowedDirections = DIRECTIONS[directions] || DIRECTIONS[2];

  while (candidates.length >= minWords) {
    const result = placeAllWords(candidates, size, allowedDirections);
    if (result.success) {
      return { success: true, grid: result.grid, words: result.words, size };
    }
    candidates.splice(randInt(candidates.length), 1);
  }

  return { success: false, error: `Cuma bisa muat kurang dari ${minWords} kata di grid ${size}x${size}` };
}

module.exports = { placeAllWords, placeWithFallbackDrop, GRID_SIZE, DIRECTIONS };
