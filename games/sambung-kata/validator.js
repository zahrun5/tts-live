/**
 * TTS Validator
 * Validates crossword puzzle for letter conflicts, spelling, bounds, and numbering
 */

function validateTTS(puzzle) {
  // Phase 1: Input Validation
  if (!puzzle || typeof puzzle !== 'object') {
    return {
      valid: false,
      error: 'Invalid puzzle: puzzle must be an object',
      conflicts: [],
      details: null
    };
  }

  if (typeof puzzle.rows !== 'number' || typeof puzzle.cols !== 'number') {
    return {
      valid: false,
      error: 'Invalid puzzle: rows and cols must be numbers',
      conflicts: [],
      details: null
    };
  }

  if (puzzle.rows <= 0 || puzzle.cols <= 0) {
    return {
      valid: false,
      error: 'Invalid puzzle: rows and cols must be > 0',
      conflicts: [],
      details: null
    };
  }

  if (!Array.isArray(puzzle.words) || puzzle.words.length === 0) {
    return {
      valid: false,
      error: 'Invalid puzzle: words must be a non-empty array',
      conflicts: [],
      details: null
    };
  }

  // Validate each word structure
  for (let i = 0; i < puzzle.words.length; i++) {
    const word = puzzle.words[i];
    
    if (!word.answer || typeof word.answer !== 'string' || word.answer.length === 0) {
      return {
        valid: false,
        error: `Invalid word at index ${i}: answer is required and must be a non-empty string`,
        conflicts: [],
        details: null
      };
    }

    if (!word.direction || !['across', 'down'].includes(word.direction)) {
      return {
        valid: false,
        error: `Invalid word at index ${i} (${word.answer}): direction must be 'across' or 'down'`,
        conflicts: [],
        details: null
      };
    }

    if (typeof word.row !== 'number' || typeof word.col !== 'number') {
      return {
        valid: false,
        error: `Invalid word at index ${i} (${word.answer}): row and col must be numbers`,
        conflicts: [],
        details: null
      };
    }

    if (word.row < 0 || word.col < 0) {
      return {
        valid: false,
        error: `Invalid word at index ${i} (${word.answer}): row and col must be >= 0`,
        conflicts: [],
        details: null
      };
    }

    if (typeof word.number !== 'number' || word.number <= 0) {
      return {
        valid: false,
        error: `Invalid word at index ${i} (${word.answer}): number must be a positive number`,
        conflicts: [],
        details: null
      };
    }
  }

  // Phase 2: Build Grid & Detect Conflicts
  const grid = Array(puzzle.rows).fill(null).map(() => 
    Array(puzzle.cols).fill(null).map(() => ({
      letter: null,
      words: []
    }))
  );

  const conflicts = [];
  let validatedCells = 0;

  for (const word of puzzle.words) {
    const { answer, direction, row, col, number } = word;

    for (let i = 0; i < answer.length; i++) {
      const r = direction === 'down' ? row + i : row;
      const c = direction === 'across' ? col + i : col;
      const letter = answer[i].toUpperCase();

      // Check bounds
      if (r >= puzzle.rows || c >= puzzle.cols) {
        return {
          valid: false,
          error: `Word ${number} (${answer}) goes out of bounds at position (${r}, ${c}). Grid size: ${puzzle.rows}x${puzzle.cols}`,
          conflicts: [],
          details: {
            totalWords: puzzle.words.length,
            gridSize: `${puzzle.rows}x${puzzle.cols}`,
            validatedWords: puzzle.words.indexOf(word),
            validatedCells
          }
        };
      }

      const cell = grid[r][c];
      
      if (cell.letter === null) {
        // First word to use this cell
        cell.letter = letter;
        cell.words.push({
          number,
          answer,
          direction,
          position: i
        });
        validatedCells++;
      } else if (cell.letter !== letter) {
        // CONFLICT DETECTED
        conflicts.push({
          position: { row: r, col: c },
          expected: cell.letter,
          got: letter,
          words: [
            ...cell.words,
            { number, answer, direction, position: i }
          ]
        });
      } else {
        // Same letter - valid intersection
        cell.words.push({
          number,
          answer,
          direction,
          position: i
        });
      }
    }
  }

  // Check if conflicts found
  if (conflicts.length > 0) {
    return {
      valid: false,
      error: `Found ${conflicts.length} letter conflict(s) at intersection(s)`,
      conflicts,
      details: {
        totalWords: puzzle.words.length,
        gridSize: `${puzzle.rows}x${puzzle.cols}`,
        validatedWords: puzzle.words.length,
        validatedCells
      }
    };
  }

  // Phase 3: Verify Answer Spelling
  for (const word of puzzle.words) {
    const { answer, direction, row, col, number } = word;
    let extractedWord = '';

    for (let i = 0; i < answer.length; i++) {
      const r = direction === 'down' ? row + i : row;
      const c = direction === 'across' ? col + i : col;
      extractedWord += grid[r][c].letter;
    }

    if (extractedWord !== answer.toUpperCase()) {
      return {
        valid: false,
        error: `Word ${number} spelling mismatch: expected "${answer.toUpperCase()}", got "${extractedWord}" at position (${row}, ${col}) ${direction}`,
        conflicts: [],
        details: {
          totalWords: puzzle.words.length,
          gridSize: `${puzzle.rows}x${puzzle.cols}`,
          validatedWords: puzzle.words.length,
          validatedCells
        }
      };
    }
  }

  // Phase 4: Validate Global Numbering
  const startPositions = new Map();
  
  for (const word of puzzle.words) {
    const key = `${word.row},${word.col}`;
    if (!startPositions.has(key)) {
      startPositions.set(key, {
        row: word.row,
        col: word.col,
        words: []
      });
    }
    startPositions.get(key).words.push(word);
  }

  // Sort positions (top→bottom, left→right)
  const sortedPositions = Array.from(startPositions.values()).sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  // Check if numbering matches sorted order
  let expectedNumber = 1;
  
  for (const position of sortedPositions) {
    const actualNumber = position.words[0].number;
    
    // All words at same position should have same number
    for (const word of position.words) {
      if (word.number !== actualNumber) {
        return {
          valid: false,
          error: `Words at position (${position.row}, ${position.col}) have different numbers: ${position.words.map(w => `${w.answer}=${w.number}`).join(', ')}`,
          conflicts: [],
          details: {
            totalWords: puzzle.words.length,
            gridSize: `${puzzle.rows}x${puzzle.cols}`,
            validatedWords: puzzle.words.length,
            validatedCells
          }
        };
      }
    }

    if (actualNumber !== expectedNumber) {
      return {
        valid: false,
        error: `Words at position (${position.row}, ${position.col}) have number ${actualNumber}, expected ${expectedNumber} based on position order (left→right, top→bottom)`,
        conflicts: [],
        details: {
          totalWords: puzzle.words.length,
          gridSize: `${puzzle.rows}x${puzzle.cols}`,
          validatedWords: puzzle.words.length,
          validatedCells
        }
      };
    }
    
    expectedNumber++;
  }

  // All validations passed
  return {
    valid: true,
    error: null,
    conflicts: [],
    details: {
      totalWords: puzzle.words.length,
      gridSize: `${puzzle.rows}x${puzzle.cols}`,
      validatedWords: puzzle.words.length,
      validatedCells
    }
  };
}

// Helper function: Format conflict details for display
function formatConflictDetails(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    return '(no conflicts)';
  }

  return conflicts.map(c => {
    const wordList = c.words.map(w => 
      `    - Word ${w.number} (${w.answer}) ${w.direction}: expects letter '${w.answer[w.position]}' at position ${w.position}`
    ).join('\n');
    
    return `  📍 Conflict at cell (${c.position.row}, ${c.position.col}):\n` +
           `     Expected: '${c.expected}'\n` +
           `     Got: '${c.got}'\n` +
           `     Involved words:\n${wordList}`;
  }).join('\n\n');
}

module.exports = {
  validateTTS,
  formatConflictDetails
};
