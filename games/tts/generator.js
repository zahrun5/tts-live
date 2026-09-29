/**
 * TTS Generator - Main Integration
 * Menggabungkan semua komponen untuk menghasilkan TTS yang valid
 */

const { findIntersections } = require('./intersection-finder');
const { placeWords } = require('./word-placement');
const { normalizeGrid } = require('./grid-normalization');
const { validateTTS } = require('./validator');
const fs = require('fs');
const path = require('path');

/**
 * Generate TTS dari daftar kata
 * @param {Object} input - Input object dengan format:
 *   {
 *     words: [
 *       { answer: string, direction: string, clue: string }
 *     ]
 *   }
 * @param {Object} options - Options
 * @returns {Object} {success: boolean, puzzle: object, error: string, stats: object}
 */
function generateTTS(input, options = {}) {
  const startTime = Date.now();
  const {
    maxGridSize = 50,
    validate = true,
    verbose = false
  } = options;
  
  try {
    // Step 1: Validasi input
    if (verbose) console.log('Step 1: Validasi input...');
    
    if (!input || !input.words || !Array.isArray(input.words)) {
      return {
        success: false,
        puzzle: null,
        error: 'Input tidak valid: words harus berupa array',
        stats: null
      };
    }
    
    if (input.words.length === 0) {
      return {
        success: false,
        puzzle: null,
        error: 'Input tidak valid: words tidak boleh kosong',
        stats: null
      };
    }
    
    // Validasi setiap kata
    for (let i = 0; i < input.words.length; i++) {
      const word = input.words[i];
      if (!word.answer || !word.direction || !word.clue) {
        return {
          success: false,
          puzzle: null,
          error: `Kata index ${i} tidak lengkap: harus ada answer, direction, dan clue`,
          stats: null
        };
      }
      
      if (!['across', 'down'].includes(word.direction)) {
        return {
          success: false,
          puzzle: null,
          error: `Kata index ${i}: direction harus 'across' atau 'down'`,
          stats: null
        };
      }
    }
    
    if (verbose) console.log(`✓ Input valid: ${input.words.length} kata`);
    
    // Step 2: Cari intersections
    if (verbose) console.log('\nStep 2: Mencari intersections...');
    
    const intersections = findIntersections(input.words);
    
    if (intersections.length === 0) {
      return {
        success: false,
        puzzle: null,
        error: 'Tidak ada persilangan yang mungkin antar kata-kata yang diberikan',
        stats: {
          totalWords: input.words.length,
          intersections: 0
        }
      };
    }
    
    if (verbose) console.log(`✓ Ditemukan ${intersections.length} kemungkinan persilangan`);
    
    // Step 3: Place words dengan backtracking
    if (verbose) console.log('\nStep 3: Menempatkan kata dengan backtracking...');
    
    const placementResult = placeWords(input.words, { maxGridSize });
    
    if (!placementResult.success) {
      return {
        success: false,
        puzzle: null,
        error: `Placement gagal: ${placementResult.error}`,
        stats: {
          totalWords: input.words.length,
          intersections: intersections.length,
          placedWords: 0
        }
      };
    }
    
    if (verbose) console.log(`✓ Semua ${placementResult.placement.length} kata berhasil ditempatkan`);
    
    // Step 4: Normalize grid
    if (verbose) console.log('\nStep 4: Normalisasi grid...');
    
    const puzzle = normalizeGrid(placementResult.placement);
    
    if (verbose) console.log(`✓ Grid dinormalisasi: ${puzzle.rows}x${puzzle.cols}`);
    
    // Step 5: Validate (jika diminta)
    if (validate) {
      if (verbose) console.log('\nStep 5: Validasi puzzle...');
      
      const validation = validateTTS(puzzle);
      
      if (!validation.valid) {
        return {
          success: false,
          puzzle: null,
          error: `Validasi gagal: ${validation.error}`,
          stats: {
            totalWords: input.words.length,
            intersections: intersections.length,
            placedWords: placementResult.placement.length,
            gridSize: `${puzzle.rows}x${puzzle.cols}`,
            validationError: validation.error
          }
        };
      }
      
      if (verbose) console.log('✓ Puzzle valid!');
    }
    
    // Success!
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return {
      success: true,
      puzzle,
      error: null,
      stats: {
        totalWords: input.words.length,
        intersections: intersections.length,
        placedWords: placementResult.placement.length,
        gridSize: `${puzzle.rows}x${puzzle.cols}`,
        gridCells: puzzle.rows * puzzle.cols,
        duration: `${duration}ms`
      }
    };
    
  } catch (error) {
    return {
      success: false,
      puzzle: null,
      error: `Error tidak terduga: ${error.message}`,
      stats: null
    };
  }
}

/**
 * Generate TTS dan simpan ke file dengan atomic write
 * @param {string} inputFile - Path ke input file
 * @param {string} outputFile - Path ke output file
 * @param {Object} options - Options
 * @returns {Object} Result object
 */
function generateTTSFromFile(inputFile, outputFile, options = {}) {
  const { backup = true, verbose = false } = options;
  
  try {
    // Read input file
    if (verbose) console.log(`📂 Membaca input dari: ${inputFile}`);
    
    if (!fs.existsSync(inputFile)) {
      return {
        success: false,
        error: `Input file tidak ditemukan: ${inputFile}`
      };
    }
    
    const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    
    // Generate TTS
    if (verbose) console.log('\n🔧 Generating TTS...\n');
    
    const result = generateTTS(input, { ...options, verbose });
    
    if (!result.success) {
      return result;
    }
    
    // Atomic write process
    if (verbose) console.log('\n💾 Menyimpan hasil...');
    
    const tempFile = outputFile + '.tmp';
    
    // Write to temporary file
    fs.writeFileSync(tempFile, JSON.stringify(result.puzzle, null, 2), 'utf8');
    
    if (verbose) console.log(`✓ Temporary file created: ${tempFile}`);
    
    // Backup existing file
    if (backup && fs.existsSync(outputFile)) {
      const backupFile = outputFile + '.bak';
      fs.copyFileSync(outputFile, backupFile);
      if (verbose) console.log(`✓ Backup created: ${backupFile}`);
    }
    
    // Rename temp file to output file (atomic operation)
    fs.renameSync(tempFile, outputFile);
    
    if (verbose) console.log(`✓ Puzzle saved to: ${outputFile}`);
    
    return {
      ...result,
      outputFile
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Error: ${error.message}`
    };
  }
}

module.exports = {
  generateTTS,
  generateTTSFromFile
};
