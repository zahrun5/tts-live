const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'fallback');
const MAX_QUESTIONS_PER_FILE = 100;

// Pastikan folder ada
if (!fs.existsSync(FALLBACK_DIR)) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
}

function getAllFallbackQuestions() {
  const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json'));
  let allQuestions = [];
  
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, file), 'utf8'));
      if (Array.isArray(data)) {
        allQuestions = allQuestions.concat(data);
      }
    } catch (e) {
      console.error(`Gagal baca fallback file ${file}:`, e.message);
    }
  }
  
  return allQuestions;
}

function saveFallbackQuestion(question, answers) {
  try {
    const allExisting = getAllFallbackQuestions();
    const dupe = allExisting.some(q => q.question === question);
    if (dupe) return false; // Udah ada, skip

    // Cari file terakhir
    const files = fs.readdirSync(FALLBACK_DIR).filter(f => f.endsWith('.json')).sort();
    let targetFile = 'bank-001.json';
    let targetData = [];

    if (files.length > 0) {
      const lastFile = files[files.length - 1];
      const lastData = JSON.parse(fs.readFileSync(path.join(FALLBACK_DIR, lastFile), 'utf8'));
      
      if (lastData.length < MAX_QUESTIONS_PER_FILE) {
        targetFile = lastFile;
        targetData = lastData;
      } else {
        // Bikin file baru
        const nextNum = parseInt(lastFile.match(/\d+/)[0], 10) + 1;
        targetFile = `bank-${String(nextNum).padStart(3, '0')}.json`;
      }
    }

    targetData.push({ question, answers });
    fs.writeFileSync(path.join(FALLBACK_DIR, targetFile), JSON.stringify(targetData, null, 2), 'utf8');
    console.log(`💾 Soal AI "${question}" disimpan ke fallback (${targetFile})`);
    return true;
  } catch (e) {
    console.error('⚠️ Gagal simpan soal ke fallback:', e.message);
    return false;
  }
}

function pickFallbackQuestion(usedQuestions) {
  const all = getAllFallbackQuestions();
  if (all.length === 0) return null;
  
  const notUsed = all.filter(q => !usedQuestions.includes(q.question));
  
  if (notUsed.length > 0) {
    // Sequential: ambil yang pertama belum kepakai
    return notUsed[0];
  }
  
  // Semua udah kepakai, reset (balik ke awal)
  return all[0];
}

function getTotalCount() {
  return getAllFallbackQuestions().length;
}

module.exports = {
  getAllFallbackQuestions,
  saveFallbackQuestion,
  pickFallbackQuestion,
  getTotalCount
};
