/**
 * Word Placement dengan Backtracking Algorithm
 * Menempatkan semua kata pada grid berdasarkan persilangan yang valid
 */

const { findIntersections, calculateIntersectionPosition } = require('./intersection-finder');

/**
 * Inisialisasi grid kosong
 * @param {number} minSize - Ukuran minimal grid
 * @returns {Object} Grid object dengan size dinamis
 */
function initializeGrid(minSize = 50) {
  return {
    cells: {},  // Sparse grid: "row,col" -> {letter, words[]}
    minRow: Infinity,
    maxRow: -Infinity,
    minCol: Infinity,
    maxCol: -Infinity,
    maxSize: minSize
  };
}

/**
 * Cek apakah kotak sebelum & sesudah kata (di arah yang sama) kosong.
 * Ini mencegah kata numpuk jadi satu deretan tanpa pemisah
 * (misal API numpuk di dalam SAPI, atau MAKAN nyambung sama huruf tetangga).
 * @param {Object} grid - Grid object
 * @param {Object} word - Word object
 * @param {number} row - Row position
 * @param {number} col - Col position
 * @returns {boolean} true kalau boundary valid (kosong di kedua ujung)
 */
function hasValidBoundary(grid, word, row, col) {
  const { answer, direction } = word;
  let beforeKey, afterKey;

  if (direction === 'across') {
    beforeKey = `${row},${col - 1}`;
    afterKey = `${row},${col + answer.length}`;
  } else {
    beforeKey = `${row - 1},${col}`;
    afterKey = `${row + answer.length},${col}`;
  }

  if (grid.cells[beforeKey]) return false;
  if (grid.cells[afterKey]) return false;
  return true;
}

/**
 * Cek apakah kata bisa ditempatkan di posisi tertentu
 * @param {Object} grid - Grid object
 * @param {Object} word - Word object
 * @param {number} row - Row position
 * @param {number} col - Col position
 * @returns {Object} {canPlace: boolean, reason: string, conflicts: array}
 */
function canPlaceWord(grid, word, row, col) {
  const { answer, direction } = word;
  const conflicts = [];
  
  for (let i = 0; i < answer.length; i++) {
    const r = direction === 'down' ? row + i : row;
    const c = direction === 'across' ? col + i : col;
    const letter = answer[i].toUpperCase();
    const key = `${r},${c}`;
    
    // Cek apakah posisi sudah terisi
    if (grid.cells[key]) {
      const existingLetter = grid.cells[key].letter;
      
      if (existingLetter !== letter) {
        // KONFLIK: huruf berbeda
        conflicts.push({
          position: { row: r, col: c },
          expected: existingLetter,
          got: letter,
          existingWords: grid.cells[key].words
        });
      }
      // Jika huruf sama, itu persilangan yang valid (OK)
    }
  }
  
  if (conflicts.length > 0) {
    return {
      canPlace: false,
      reason: 'letter_conflict',
      conflicts
    };
  }
  
  // Cek batas grid maksimal
  for (let i = 0; i < answer.length; i++) {
    const r = direction === 'down' ? row + i : row;
    const c = direction === 'across' ? col + i : col;
    
    if (Math.abs(r) > grid.maxSize || Math.abs(c) > grid.maxSize) {
      return {
        canPlace: false,
        reason: 'grid_size_exceeded',
        conflicts: []
      };
    }
  }
  
  // Cek kotak sebelum & sesudah harus kosong (nggak boleh numpuk/nyambung)
  if (!hasValidBoundary(grid, word, row, col)) {
    return {
      canPlace: false,
      reason: 'boundary_violation',
      conflicts: []
    };
  }
  
  return {
    canPlace: true,
    reason: null,
    conflicts: []
  };
}

/**
 * Tempatkan kata di grid
 * @param {Object} grid - Grid object
 * @param {Object} word - Word object
 * @param {number} row - Row position
 * @param {number} col - Col position
 * @param {number} wordIndex - Index kata
 */
function placeWord(grid, word, row, col, wordIndex) {
  const { answer, direction } = word;
  
  for (let i = 0; i < answer.length; i++) {
    const r = direction === 'down' ? row + i : row;
    const c = direction === 'across' ? col + i : col;
    const letter = answer[i].toUpperCase();
    const key = `${r},${c}`;
    
    if (!grid.cells[key]) {
      grid.cells[key] = {
        letter,
        words: []
      };
    }
    
    grid.cells[key].words.push({
      wordIndex,
      answer: word.answer,
      direction: word.direction,
      position: i
    });
    
    // Update bounds
    grid.minRow = Math.min(grid.minRow, r);
    grid.maxRow = Math.max(grid.maxRow, r);
    grid.minCol = Math.min(grid.minCol, c);
    grid.maxCol = Math.max(grid.maxCol, c);
  }
}

/**
 * Hapus kata dari grid (untuk backtracking)
 * @param {Object} grid - Grid object
 * @param {Object} word - Word object
 * @param {number} row - Row position
 * @param {number} col - Col position
 * @param {number} wordIndex - Index kata
 */
function removeWord(grid, word, row, col, wordIndex) {
  const { answer, direction } = word;
  
  for (let i = 0; i < answer.length; i++) {
    const r = direction === 'down' ? row + i : row;
    const c = direction === 'across' ? col + i : col;
    const key = `${r},${c}`;
    
    if (grid.cells[key]) {
      // Hapus word dari cell
      grid.cells[key].words = grid.cells[key].words.filter(
        w => w.wordIndex !== wordIndex
      );
      
      // Jika cell tidak ada word lagi, hapus cell
      if (grid.cells[key].words.length === 0) {
        delete grid.cells[key];
      }
    }
  }
  
  // Recalculate bounds
  recalculateBounds(grid);
}

/**
 * Recalculate grid bounds
 */
function recalculateBounds(grid) {
  grid.minRow = Infinity;
  grid.maxRow = -Infinity;
  grid.minCol = Infinity;
  grid.maxCol = -Infinity;
  
  for (const key in grid.cells) {
    const [r, c] = key.split(',').map(Number);
    grid.minRow = Math.min(grid.minRow, r);
    grid.maxRow = Math.max(grid.maxRow, r);
    grid.minCol = Math.min(grid.minCol, c);
    grid.maxCol = Math.max(grid.maxCol, c);
  }
}

/**
 * Cari semua posisi yang mungkin untuk kata berikutnya
 * @param {Object} grid - Grid object
 * @param {Object} word - Word object
 * @param {number} wordIndex - Index kata
 * @param {Array} intersections - Array of intersections
 * @param {Array} placedWords - Array of placed words
 * @returns {Array} Array of possible positions
 */
function findPossiblePositions(grid, word, wordIndex, intersections, placedWords) {
  const positions = [];
  
  // Cari intersections dengan kata yang sudah ditempatkan
  for (const intersection of intersections) {
    const { word1Index, word2Index } = intersection;
    
    // Cek apakah intersection melibatkan kata ini
    let placedWordIndex = -1;
    let isWord1 = false;
    
    if (word1Index === wordIndex) {
      // Kata ini adalah word1, cari word2 yang sudah ditempatkan
      const placed = placedWords.find(p => p.wordIndex === word2Index);
      if (placed) {
        placedWordIndex = word2Index;
        isWord1 = true;
      }
    } else if (word2Index === wordIndex) {
      // Kata ini adalah word2, cari word1 yang sudah ditempatkan
      const placed = placedWords.find(p => p.wordIndex === word1Index);
      if (placed) {
        placedWordIndex = word1Index;
        isWord1 = false;
      }
    }
    
    if (placedWordIndex === -1) continue;
    
    // Dapatkan placed word info
    const placedWord = placedWords.find(p => p.wordIndex === placedWordIndex);
    
    // Hitung posisi untuk kata ini
    let position;
    if (isWord1) {
      // word1 (kata ini) intersect dengan word2 (yang sudah ditempatkan)
      // Balik: anggap word2 sebagai base
      const swappedIntersection = {
        word1Pos: intersection.word2Pos,
        word2Pos: intersection.word1Pos,
        word1Direction: intersection.word2Direction,
        word2Direction: intersection.word1Direction
      };
      position = calculateIntersectionPosition(
        swappedIntersection,
        placedWord.row,
        placedWord.col
      );
    } else {
      // word2 (kata ini) intersect dengan word1 (yang sudah ditempatkan)
      position = calculateIntersectionPosition(
        intersection,
        placedWord.row,
        placedWord.col
      );
    }
    
    positions.push({
      row: position.row,
      col: position.col,
      intersection,
      placedWordIndex
    });
  }
  
  return positions;
}

/**
 * Backtracking algorithm untuk menempatkan semua kata
 * @param {Array} words - Array of words
 * @param {Array} intersections - Array of intersections
 * @param {Object} grid - Grid object
 * @param {Array} placedWords - Array of placed words
 * @param {number} depth - Recursion depth
 * @returns {Object} {success: boolean, placement: array, error: string}
 */
function placeWordsRecursive(words, intersections, grid, placedWords, depth = 0) {
  // Base case: semua kata sudah ditempatkan
  if (placedWords.length === words.length) {
    return {
      success: true,
      placement: placedWords,
      error: null
    };
  }
  
  // Cari kata berikutnya yang belum ditempatkan
  const nextWordIndex = placedWords.length;
  const word = words[nextWordIndex];
  
  // Jika ini kata pertama, tempatkan di (0, 0)
  if (placedWords.length === 0) {
    const checkResult = canPlaceWord(grid, word, 0, 0);
    if (!checkResult.canPlace) {
      return {
        success: false,
        placement: [],
        error: `Kata pertama "${word.answer}" tidak bisa ditempatkan di (0,0): ${checkResult.reason}`
      };
    }
    
    placeWord(grid, word, 0, 0, nextWordIndex);
    placedWords.push({
      wordIndex: nextWordIndex,
      word,
      row: 0,
      col: 0
    });
    
    return placeWordsRecursive(words, intersections, grid, placedWords, depth + 1);
  }
  
  // Fungsi bantu: cek ulang boundary SEMUA kata yang udah ditempatkan.
  // Perlu karena kata baru bisa nempel ke ujung kata lama yang udah lolos cek duluan
  // (waktu kata lama itu ditempatkan, tetangganya masih kosong).
  function allBoundariesValid() {
    return placedWords.every(p => hasValidBoundary(grid, p.word, p.row, p.col));
  }
  
  // Cari semua posisi yang mungkin untuk kata ini
  const possiblePositions = findPossiblePositions(
    grid,
    word,
    nextWordIndex,
    intersections,
    placedWords
  );
  
  if (possiblePositions.length === 0) {
    return {
      success: false,
      placement: [],
      error: `Kata "${word.answer}" tidak memiliki persilangan valid dengan kata yang sudah ditempatkan`
    };
  }
  
  // Coba setiap posisi yang mungkin
  for (const pos of possiblePositions) {
    const checkResult = canPlaceWord(grid, word, pos.row, pos.col);
    
    if (checkResult.canPlace) {
      // Tempatkan kata
      placeWord(grid, word, pos.row, pos.col, nextWordIndex);
      placedWords.push({
        wordIndex: nextWordIndex,
        word,
        row: pos.row,
        col: pos.col
      });
      
      // Cek ulang: apa penempatan baru ini bikin kata LAIN yang udah ada jadi
      // kelanggar boundary-nya (nempel tanpa pemisah)? Kalau iya, batalin.
      if (allBoundariesValid()) {
        // Recursion
        const result = placeWordsRecursive(words, intersections, grid, placedWords, depth + 1);
        
        if (result.success) {
          return result;
        }
      }
      
      // Backtrack
      placedWords.pop();
      removeWord(grid, word, pos.row, pos.col, nextWordIndex);
    }
  }
  
  // Semua posisi gagal
  return {
    success: false,
    placement: [],
    error: `Kata "${word.answer}" tidak bisa ditempatkan - semua posisi konflik dengan kata lain`
  };
}

/**
 * Main function untuk menempatkan kata dengan prioritas
 * @param {Array} words - Array of words
 * @param {Object} options - Options
 * @returns {Object} {success: boolean, placement: array, grid: object, error: string}
 */
function placeWords(words, options = {}) {
  const { maxGridSize = 50, maxOrderAttempts = 30 } = options;

  // Validasi input
  if (!Array.isArray(words) || words.length === 0) {
    return {
      success: false,
      placement: [],
      grid: null,
      error: 'Input words harus berupa array non-empty'
    };
  }

  // Cari intersections
  const intersections = findIntersections(words);

  if (intersections.length === 0) {
    return {
      success: false,
      placement: [],
      grid: null,
      error: 'Tidak ada persilangan yang mungkin antar kata-kata yang diberikan'
    };
  }

  function attemptWithOrder(orderedWords) {
    // Map intersections ke index baru sesuai urutan yang dicoba
    const indexMap = orderedWords.map(w => words.indexOf(w));
    const mappedIntersections = intersections.map(int => ({
      ...int,
      word1Index: indexMap.indexOf(int.word1Index),
      word2Index: indexMap.indexOf(int.word2Index)
    }));

    const grid = initializeGrid(maxGridSize);
    return {
      result: placeWordsRecursive(orderedWords, mappedIntersections, grid, [], 0),
      grid
    };
  }

  // Attempt #1: urutan default (intersection banyak dulu, lalu kata terpanjang)
  // Dipertahankan sebagai percobaan pertama biar behaviour lama gak berubah.
  const wordStats = words.map((word, index) => {
    const intersectionCount = intersections.filter(
      int => int.word1Index === index || int.word2Index === index
    ).length;
    return { index, word, intersectionCount, length: word.answer.length };
  });
  wordStats.sort((a, b) => {
    if (b.intersectionCount !== a.intersectionCount) {
      return b.intersectionCount - a.intersectionCount;
    }
    return b.length - a.length;
  });

  const defaultOrder = wordStats.map(ws => ws.word);
  let attempt = attemptWithOrder(defaultOrder);
  if (attempt.result.success) {
    return { success: true, placement: attempt.result.placement, grid: attempt.grid, error: null };
  }

  let lastError = attempt.result.error;

  // Attempt #2..N: kalau urutan default gagal, coba beberapa urutan ACAK.
  // Algoritma backtracking cuma coba posisi untuk urutan yang FIXED, jadi kalau
  // urutan defaultnya "sial", kombinasi yang sebenarnya valid gak akan ketemu
  // kecuali kita ganti urutannya juga.
  for (let i = 1; i < maxOrderAttempts; i++) {
    const shuffled = [...words];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }

    attempt = attemptWithOrder(shuffled);
    if (attempt.result.success) {
      return { success: true, placement: attempt.result.placement, grid: attempt.grid, error: null };
    }
    lastError = attempt.result.error;
  }

  return {
    success: false,
    placement: [],
    grid: null,
    error: `Gagal setelah mencoba ${maxOrderAttempts} urutan berbeda. Error terakhir: ${lastError}`
  };
}

module.exports = {
  placeWords,
  canPlaceWord,
  placeWord,
  removeWord,
  findPossiblePositions,
  initializeGrid,
  hasValidBoundary
};
