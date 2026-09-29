#!/usr/bin/env node

/**
 * CLI Tool untuk TTS Generator
 * Usage: node cli-generator.js [input-file] [output-file]
 */

const { generateTTSFromFile } = require('./generator');
const { visualizeGrid, generateClueList } = require('./grid-normalization');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);

// Show help
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          TTS GENERATOR - Command Line Interface           ║
╚════════════════════════════════════════════════════════════╝

USAGE:
  node cli-generator.js [input-file] [output-file] [options]

ARGUMENTS:
  input-file     Path ke file input JSON (default: puzzle-input.json)
  output-file    Path ke file output JSON (default: puzzle.json)

OPTIONS:
  --no-backup    Jangan buat backup file lama
  --no-validate  Skip validasi setelah generate
  --quiet        Mode quiet (minimal output)
  --help, -h     Show this help message

INPUT FORMAT:
  {
    "words": [
      {
        "answer": "KATA",
        "direction": "across" | "down",
        "clue": "Pertanyaan TTS"
      }
    ]
  }

OUTPUT FORMAT:
  {
    "rows": 10,
    "cols": 10,
    "words": [
      {
        "number": 1,
        "direction": "across",
        "row": 0,
        "col": 0,
        "answer": "KATA",
        "clue": "Pertanyaan TTS"
      }
    ]
  }

EXAMPLES:
  # Generate dengan default files
  node cli-generator.js

  # Generate dengan custom files
  node cli-generator.js my-input.json my-output.json

  # Generate tanpa backup
  node cli-generator.js input.json output.json --no-backup

  # Generate mode quiet
  node cli-generator.js input.json output.json --quiet

NOTES:
  - Semua kata WAJIB bisa ditempatkan (tidak ada yang dibuang)
  - Generator menggunakan backtracking untuk menemukan susunan valid
  - Grid size otomatis menyesuaikan
  - Validasi dilakukan sebelum menyimpan file

`);
  process.exit(0);
}

// Parse options
const options = {
  backup: !args.includes('--no-backup'),
  validate: !args.includes('--no-validate'),
  verbose: !args.includes('--quiet')
};

// Get input/output files
const inputFile = args.find(arg => !arg.startsWith('--') && arg.endsWith('.json')) || 'puzzle-input.json';
const outputFile = args.length > 1 && !args[1].startsWith('--') ? args[1] : 'puzzle.json';

// Banner
if (options.verbose) {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          TTS GENERATOR - Generating Puzzle...             ║
╚════════════════════════════════════════════════════════════╝
`);
  console.log(`Input:  ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Backup: ${options.backup ? 'Enabled' : 'Disabled'}`);
  console.log(`Validate: ${options.validate ? 'Enabled' : 'Disabled'}`);
  console.log('');
}

// Check input file exists
if (!fs.existsSync(inputFile)) {
  console.error(`❌ ERROR: Input file tidak ditemukan: ${inputFile}`);
  console.error(`\nGunakan --help untuk melihat panduan.`);
  process.exit(1);
}

// Generate TTS
const startTime = Date.now();

const result = generateTTSFromFile(inputFile, outputFile, options);

const endTime = Date.now();
const duration = endTime - startTime;

// Handle result
if (result.success) {
  if (options.verbose) {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ SUCCESS!                             ║
╚════════════════════════════════════════════════════════════╝

STATISTICS:
  Total kata        : ${result.stats.totalWords}
  Intersections     : ${result.stats.intersections}
  Grid size         : ${result.stats.gridSize}
  Grid cells        : ${result.stats.gridCells}
  Generation time   : ${duration}ms

OUTPUT:
  File saved        : ${outputFile}
  ${options.backup && fs.existsSync(outputFile + '.bak') ? `Backup created     : ${outputFile}.bak` : ''}

VISUALIZATION:
${visualizeGrid(result.puzzle)}

CLUE LIST:
`);
    
    const clues = generateClueList(result.puzzle);
    console.log('MENDATAR:');
    clues.across.forEach(c => console.log(`  ${c}`));
    console.log('\nMENURUN:');
    clues.down.forEach(c => console.log(`  ${c}`));
    
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  Puzzle berhasil dibuat dan siap digunakan untuk live!    ║
╚════════════════════════════════════════════════════════════╝
`);
  } else {
    console.log(`✅ Success: Puzzle saved to ${outputFile}`);
  }
  
  process.exit(0);
  
} else {
  console.error(`
╔════════════════════════════════════════════════════════════╗
║                    ❌ FAILED!                              ║
╚════════════════════════════════════════════════════════════╝

ERROR: ${result.error}
`);
  
  if (result.stats) {
    console.error('STATS:');
    console.error(`  Total kata     : ${result.stats.totalWords}`);
    if (result.stats.intersections !== undefined) {
      console.error(`  Intersections  : ${result.stats.intersections}`);
    }
    if (result.stats.placedWords !== undefined) {
      console.error(`  Kata tertmpat  : ${result.stats.placedWords}`);
    }
  }
  
  console.error(`
SARAN:
  - Pastikan semua kata memiliki huruf yang sama untuk bersilangan
  - Cek apakah direction sudah benar (across/down)
  - Gunakan kata yang lebih bervariasi untuk meningkatkan kemungkinan persilangan

Gunakan --help untuk melihat panduan lengkap.
`);
  
  process.exit(1);
}
