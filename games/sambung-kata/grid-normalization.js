/**
 * Grid Normalization
 * Mengubah koordinat grid yang arbitrary menjadi grid standar (0,0) based
 * dan assign nomor global standar TTS
 */

/**
 * Normalize grid coordinates dan assign global numbering
 * @param {Array} placement - Array of placed words dengan arbitrary coordinates
 * @returns {Object} Normalized puzzle dengan format standar
 */
function normalizeGrid(placement) {
  if (!placement || placement.length === 0) {
    throw new Error('Placement array kosong');
  }
  
  // Step 1: Find min/max coordinates
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  
  for (const p of placement) {
    const { word, row, col } = p;
    const endRow = word.direction === 'down' ? row + word.answer.length - 1 : row;
    const endCol = word.direction === 'across' ? col + word.answer.length - 1 : col;
    
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, endRow);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, endCol);
  }
  
  // Step 2: Shift all coordinates to start from (0, 0)
  const shifted = placement.map(p => ({
    ...p,
    row: p.row - minRow,
    col: p.col - minCol
  }));
  
  // Step 3: Calculate grid size
  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;
  
  // Step 4: Group words by start position untuk global numbering
  const startPositions = new Map();
  
  for (const p of shifted) {
    const key = `${p.row},${p.col}`;
    if (!startPositions.has(key)) {
      startPositions.set(key, {
        row: p.row,
        col: p.col,
        words: []
      });
    }
    startPositions.get(key).words.push(p);
  }
  
  // Step 5: Sort positions (top→bottom, left→right) untuk numbering
  const sortedPositions = Array.from(startPositions.values()).sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });
  
  // Step 6: Assign global numbers
  let number = 1;
  for (const position of sortedPositions) {
    for (const p of position.words) {
      p.number = number;
    }
    number++;
  }
  
  // Step 7: Create final puzzle structure
  const words = shifted.map(p => ({
    number: p.number,
    direction: p.word.direction,
    row: p.row,
    col: p.col,
    answer: p.word.answer.toUpperCase(),
    clue: p.word.clue || ''
  }));
  
  // Sort words by number
  words.sort((a, b) => a.number - b.number);
  
  return {
    rows,
    cols,
    words
  };
}

/**
 * Visualisasi grid sebagai ASCII art
 * @param {Object} puzzle - Puzzle object
 * @returns {string} ASCII visualization
 */
function visualizeGrid(puzzle) {
  const { rows, cols, words } = puzzle;
  
  // Build grid
  const grid = Array(rows).fill(null).map(() => 
    Array(cols).fill(null).map(() => ({
      letter: null,
      number: null
    }))
  );
  
  // Fill grid dengan kata-kata
  for (const word of words) {
    for (let i = 0; i < word.answer.length; i++) {
      const r = word.direction === 'down' ? word.row + i : word.row;
      const c = word.direction === 'across' ? word.col + i : word.col;
      
      grid[r][c].letter = word.answer[i];
      
      // Assign number hanya di posisi awal kata
      if (i === 0) {
        grid[r][c].number = word.number;
      }
    }
  }
  
  // Create ASCII visualization
  let output = '\n';
  
  // Header dengan nomor kolom
  output += '     ';
  for (let c = 0; c < cols; c++) {
    output += ` ${c.toString().padStart(2)} `;
  }
  output += '\n';
  
  // Separator
  output += '    ' + '─'.repeat(cols * 4 + 1) + '\n';
  
  // Grid rows
  for (let r = 0; r < rows; r++) {
    output += `${r.toString().padStart(2)} │`;
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell.letter) {
        if (cell.number) {
          output += `${cell.number.toString().padStart(2)}${cell.letter} `;
        } else {
          output += ` ${cell.letter}  `;
        }
      } else {
        output += ' ██ ';
      }
    }
    output += '│\n';
  }
  
  // Footer
  output += '    ' + '─'.repeat(cols * 4 + 1) + '\n';
  
  return output;
}

/**
 * Generate clue list untuk display
 * @param {Object} puzzle - Puzzle object
 * @returns {Object} {across: array, down: array}
 */
function generateClueList(puzzle) {
  const across = puzzle.words
    .filter(w => w.direction === 'across')
    .map(w => `${w.number}. ${w.clue} (${w.answer.length} huruf)`);
  
  const down = puzzle.words
    .filter(w => w.direction === 'down')
    .map(w => `${w.number}. ${w.clue} (${w.answer.length} huruf)`);
  
  return { across, down };
}

module.exports = {
  normalizeGrid,
  visualizeGrid,
  generateClueList
};
