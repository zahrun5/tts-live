/**
 * Intersection Finder
 * Mencari semua kemungkinan persilangan antar kata berdasarkan huruf yang sama
 */

/**
 * Mencari semua kemungkinan intersection antar kata
 * @param {Array} words - Array of word objects dengan format:
 *   {
 *     answer: string,
 *     direction: 'across' | 'down',
 *     clue: string
 *   }
 * @returns {Array} Array of intersection objects:
 *   {
 *     word1Index: number,
 *     word2Index: number,
 *     word1Pos: number,
 *     word2Pos: number,
 *     letter: string
 *   }
 */
function findIntersections(words) {
  const intersections = [];
  
  // Untuk setiap pasangan kata
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const word1 = words[i];
      const word2 = words[j];
      
      // Skip jika direction sama (tidak bisa bersilangan)
      if (word1.direction === word2.direction) {
        continue;
      }
      
      // Normalize answer ke uppercase untuk perbandingan
      const answer1 = word1.answer.toUpperCase();
      const answer2 = word2.answer.toUpperCase();
      
      // Cari semua huruf yang sama
      for (let p1 = 0; p1 < answer1.length; p1++) {
        for (let p2 = 0; p2 < answer2.length; p2++) {
          if (answer1[p1] === answer2[p2]) {
            intersections.push({
              word1Index: i,
              word2Index: j,
              word1Pos: p1,
              word2Pos: p2,
              letter: answer1[p1],
              word1Answer: answer1,
              word2Answer: answer2,
              word1Direction: word1.direction,
              word2Direction: word2.direction
            });
          }
        }
      }
    }
  }
  
  return intersections;
}

/**
 * Hitung koordinat untuk placement kata kedua berdasarkan intersection
 * @param {Object} intersection - Intersection object
 * @param {number} word1Row - Row kata pertama yang sudah ditempatkan
 * @param {number} word1Col - Col kata pertama yang sudah ditempatkan
 * @returns {Object} Position untuk kata kedua: {row, col}
 */
function calculateIntersectionPosition(intersection, word1Row, word1Col) {
  const { word1Pos, word2Pos, word1Direction, word2Direction } = intersection;
  
  // Hitung posisi intersection point dari kata pertama
  let intersectRow, intersectCol;
  
  if (word1Direction === 'across') {
    intersectRow = word1Row;
    intersectCol = word1Col + word1Pos;
  } else { // down
    intersectRow = word1Row + word1Pos;
    intersectCol = word1Col;
  }
  
  // Hitung posisi awal kata kedua berdasarkan intersection point
  let word2Row, word2Col;
  
  if (word2Direction === 'across') {
    word2Row = intersectRow;
    word2Col = intersectCol - word2Pos;
  } else { // down
    word2Row = intersectRow - word2Pos;
    word2Col = intersectCol;
  }
  
  return {
    row: word2Row,
    col: word2Col,
    intersectionPoint: { row: intersectRow, col: intersectCol }
  };
}

/**
 * Filter intersections untuk hanya mendapatkan yang valid untuk placement
 * @param {Array} intersections - Array of intersection objects
 * @param {Object} placedWord - Kata yang sudah ditempatkan {word, row, col}
 * @param {number} targetWordIndex - Index kata yang ingin ditempatkan
 * @returns {Array} Valid intersections dengan calculated positions
 */
function findValidIntersectionsForWord(intersections, placedWord, targetWordIndex) {
  const validIntersections = [];
  
  for (const intersection of intersections) {
    const { word1Index, word2Index } = intersection;
    
    // Cek apakah intersection ini melibatkan kata yang sudah ditempatkan dan kata target
    let isRelevant = false;
    let useWord1AsPlaced = false;
    
    if (word1Index === placedWord.wordIndex && word2Index === targetWordIndex) {
      isRelevant = true;
      useWord1AsPlaced = true;
    } else if (word2Index === placedWord.wordIndex && word1Index === targetWordIndex) {
      isRelevant = true;
      useWord1AsPlaced = false;
    }
    
    if (!isRelevant) continue;
    
    // Hitung posisi untuk kata target
    let position;
    if (useWord1AsPlaced) {
      position = calculateIntersectionPosition(
        intersection,
        placedWord.row,
        placedWord.col
      );
    } else {
      // Swap word1 dan word2 untuk calculation
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
    }
    
    validIntersections.push({
      ...intersection,
      calculatedPosition: position
    });
  }
  
  return validIntersections;
}

/**
 * Analisis dan tampilkan statistik intersection
 * @param {Array} words - Array of words
 * @param {Array} intersections - Array of intersections
 * @returns {Object} Statistics object
 */
function analyzeIntersections(words, intersections) {
  const stats = {
    totalWords: words.length,
    totalIntersections: intersections.length,
    averageIntersectionsPerWord: 0,
    wordStats: []
  };
  
  // Hitung intersection per kata
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const count = intersections.filter(
      int => int.word1Index === i || int.word2Index === i
    ).length;
    
    stats.wordStats.push({
      index: i,
      answer: word.answer,
      direction: word.direction,
      intersectionCount: count
    });
  }
  
  stats.averageIntersectionsPerWord = 
    stats.totalIntersections > 0 
      ? (stats.totalIntersections * 2 / stats.totalWords).toFixed(2)
      : 0;
  
  // Sort by intersection count descending
  stats.wordStats.sort((a, b) => b.intersectionCount - a.intersectionCount);
  
  return stats;
}

module.exports = {
  findIntersections,
  calculateIntersectionPosition,
  findValidIntersectionsForWord,
  analyzeIntersections
};
