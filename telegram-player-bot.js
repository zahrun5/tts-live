require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const games = require('./games/game-registry');
// activeGame sekarang MUTABLE -- nilai env cuma tebakan awal sebelum sempat
// disinkron ke server.js (sumber kebenaran sebenarnya), dan bisa berubah
// kapan aja lewat command /game atau saat orang lain ganti game dari Telegram.
let activeGame = games[process.env.ACTIVE_GAME || 'tts'];
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const token = process.env.TELEGRAM_PLAYER_TOKEN;
if (!token) {
  console.error('❌ TELEGRAM_PLAYER_TOKEN belum diatur di .env');
  process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

const KNOWN_CHATS_FILE = path.join(__dirname, 'known-chats-player.json');
const TIKTOK_CONFIG_FILE = path.join(__dirname, 'tiktok-config.json');
const SERVER_URL = 'http://localhost:3010';

// Chat ID yang boleh pakai command kontrol (restart, startlive, dst).
// Isi di .env, format: TELEGRAM_ADMIN_IDS=123456789,987654321
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAdmin(chatId) {
  // Kalau ADMIN_IDS kosong (belum di-set di .env), semua command kontrol ditolak
  // demi keamanan -- daripada default-nya "semua orang boleh restart server kamu".
  return ADMIN_IDS.includes(String(chatId));
}

console.log('🤖 Telegram Bot TTS Live sudah aktif!');

// ---------- Tracking chat yang pernah interaksi (buat broadcast) ----------

function loadKnownChats() {
  try {
    if (!fs.existsSync(KNOWN_CHATS_FILE)) return new Set();
    const arr = JSON.parse(fs.readFileSync(KNOWN_CHATS_FILE, 'utf8'));
    return new Set(arr);
  } catch (e) {
    console.error('Gagal baca known-chats.json:', e.message);
    return new Set();
  }
}

function saveKnownChats(chatSet) {
  fs.writeFileSync(KNOWN_CHATS_FILE, JSON.stringify([...chatSet], null, 2), 'utf8');
}

const knownChats = loadKnownChats();

function rememberChat(chatId) {
  if (!knownChats.has(chatId)) {
    knownChats.add(chatId);
    saveKnownChats(knownChats);
  }
}

function broadcast(message) {
  for (const chatId of knownChats) {
    bot.sendMessage(chatId, message).catch((e) => {
      console.error(`Gagal kirim broadcast ke ${chatId}:`, e.message);
    });
  }
}

// ---------- Format clue list jadi pesan Telegram ----------

function formatClueMessage(clues, source) {
  if (!Array.isArray(clues)) return '🧩 Soal baru!';
  const across = clues.filter((c) => c.direction === 'across');
  const down = clues.filter((c) => c.direction === 'down');

  let msg = '🧩 Soal TTS baru!\n\n';

  if (across.length) {
    msg += 'MENDATAR:\n';
    across.forEach((c) => {
      msg += `${c.number}. ${c.clue} (${c.length} huruf)\n`;
    });
    msg += '\n';
  }

  if (down.length) {
    msg += 'MENURUN:\n';
    down.forEach((c) => {
      msg += `${c.number}. ${c.clue} (${c.length} huruf)\n`;
    });
  }

  msg += '\nKirim jawaban dengan format bebas, misal: "1 jakarta"';

  return msg;
}

// ---------- Socket.IO client: dengerin event dari server.js ----------

const socket = io(SERVER_URL, { reconnection: true });

socket.on('connect', () => {
  console.log('🔌 Terhubung ke server TTS (Socket.IO)');
  syncActiveGame(); // jaga-jaga kalau game sempat diganti pas bot lagi disconnect
});

socket.on('game:switched', (data) => {
  activeGame = games[data.gameId] || activeGame;
  console.log(`🔀 Game aktif diganti jadi: ${data.gameId}`);
  broadcast(`🔀 Game diganti ke: ${data.gameId}\nKetik /help buat liat cara mainnya.`);
});

socket.on('disconnect', () => {
  console.log('🔌 Terputus dari server TTS, akan coba reconnect...');
});

socket.on('puzzle:completed', () => {
  broadcast('🎉 Puzzle selesai! Sedang menyiapkan soal baru, mohon tunggu sebentar...');
});

socket.on('puzzle:pregenerate', (data) => {
  broadcast(data.message || '⏳ Setengah jalan! Menyiapkan tema baru...');
});

socket.on('puzzle:pregenerate:success', (data) => {
  broadcast(`✅ Tema baru siap: ${data.theme}`);
});

socket.on('puzzle:pregenerate:failed', (data) => {
  broadcast(`⚠️ Gagal menyiapkan tema baru: ${data.error || 'unknown error'}`);
});

socket.on('puzzle:new', async (data) => {
  const { clues, source } = data;
  console.log(`📬 Puzzle baru diterima (sumber: ${source}), broadcast ke ${knownChats.size} chat`);

  if (Array.isArray(clues)) {
    // Game dengan clue list array (TTS)
    broadcast(formatClueMessage(clues, source));
    return;
  }

  if (clues && clues.theme) {
    // Game cari kata
    broadcast(`🔍 Soal Cari Kata baru!\nTema: ${clues.theme}\nJumlah kata: ${clues.words ? clues.words.length : ''}\n\nKirim kata yang kamu temukan di chat.`);
    return;
  }

  if (clues && clues.question) {
    // Game trivia atau family100 — deteksi berdasarkan ada options atau tidak
    if (clues.options) {
      // Trivia
      const opts = (clues.options || []).map((o) => `${o.letter}. ${o.text}`).join('\n');
      broadcast(`❓ Soal Trivia baru! (${clues.category || 'Umum'})\n\n${clues.question}\n\n${opts}\n\nKirim pilihan jawabanmu di chat.`);
    } else {
      // Family 100
      broadcast(`💯 Soal Family 100 baru!\n\n${clues.question}\n\nKirim jawaban yang menurutmu paling umum!`);
    }
    return;
  }

  // Game tanpa clue (misal Sambung Kata) -- info yang relevan bukan clue,
  // tapi huruf dasarnya. Ambil dari /api/grid biar gak perlu tau struktur
  // internal tiap game di file ini.
  const grid = await getJson('/api/grid');
  if (grid && grid.baseLetters) {
    broadcast(`🔤 Soal baru!\nHuruf dasar: ${grid.baseLetters.split('').join(' ')}\n\nTebak kata yang bisa dibentuk dari huruf-huruf itu, kirim langsung jawabannya di chat.`);
  } else {
    broadcast('🎲 Soal baru sudah siap! Cek layar buat detailnya.');
  }
});

socket.on('puzzle:error', (data) => {
  broadcast(`⚠️ Gagal membuat soal baru: ${data.message}`);
});

socket.on('level:unlock', (data) => {
  broadcast(`${data.message}`);
});

socket.on('live:status', (data) => {
  if (data.active) {
    broadcast(`🔴 LIVE dimulai! Terhubung ke TikTok @${data.username}`);
  } else if (data.error) {
    broadcast(`⚠️ Gagal konek ke TikTok Live @${data.username}: ${data.error}`);
  } else if (data.username) {
    broadcast(`⏹️ Live TikTok @${data.username} terputus/berakhir.`);
  }
});

// (Tidak ada helper PM2 di bot player)

// ---------- Helper generic buat panggil API server.js ----------

function getJson(routePath) {
  return new Promise((resolve) => {
    http.get(`${SERVER_URL}${routePath}`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function postJson(routePath, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(`${SERVER_URL}${routePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

// Ambil game aktif SEBENARNYA dari server.js (sumber kebenaran), soalnya
// bot bisa aja restart duluan sebelum sempat tau ada yang ganti game.
async function syncActiveGame() {
  const data = await getJson('/api/game');
  if (data && games[data.id]) {
    activeGame = games[data.id];
    console.log(`🎮 Game aktif tersinkron dari server: ${data.id}`);
  } else {
    console.warn('⚠️ Gagal sinkron game aktif ke server, pakai tebakan dari .env sementara.');
  }
}
syncActiveGame();

// Bot Jawaban: Tidak butuh panel admin

function startKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📖 Cara Main', callback_data: 'help' }, { text: '🎮 Daftar Game', callback_data: 'games' }],
        [{ text: '📋 Soal Aktif', callback_data: 'soal' }]
      ]
    }
  };
}

async function sendStart(chatId) {
  bot.sendMessage(chatId,
    '🎮 Selamat datang di TTS Live!\n\n' +
    'Bot ini menghubungkan kamu ke game interaktif yang bisa dimainkan bareng-bareng.\n\n' +
    `Game aktif saat ini: ${activeGame.id}\n\n` +
    'Ketik /help buat liat cara mainnya, atau langsung kirim jawaban di chat!'
  );
}

function helpTextForGame(game) {
  switch (game.id) {
    case 'tts':
      return '📖 Cara bermain TTS:\n\n' +
        '1. Lihat pertanyaan TTS di layar\n' +
        '2. Kirim jawaban dengan format bebas\n' +
        '3. Bot akan validasi dan isi grid otomatis\n\n' +
        'Contoh format jawaban:\n' +
        '• 1 jakarta\n' +
        '• nomor 2 bali\n' +
        '• sate nomor 5\n' +
        '• 3 jawabannya rasa';
    case 'cari-kata':
      return '📖 Cara bermain Cari Kata:\n\n' +
        '1. Lihat grid huruf dan tema di layar\n' +
        '2. Cari kata tersembunyi sesuai tema\n' +
        '3. Kirim langsung kata yang kamu temukan\n\n' +
        'Contoh: ketik "KUCING" kalau kamu nemuin kata itu di grid.';
    case 'trivia':
      return '📖 Cara bermain Trivia:\n\n' +
        '1. Baca soal dan pilihan jawaban\n' +
        '2. Kirim huruf pilihanmu (A/B/C/D)\n\n' +
        'Contoh: ketik "A" atau "B"';
    case 'sambung-kata':
      return '📖 Cara bermain Sambung Kata:\n\n' +
        '1. Lihat huruf dasar di layar\n' +
        '2. Bentuk kata dari huruf-huruf yang tersedia\n' +
        '3. Kirim langsung kata tebakanmu\n\n' +
        'Contoh: kalau hurufnya A B C, ketik "BAC" atau "CAB"';
    case 'family100':
      return '📖 Cara bermain Family 100:\n\n' +
        '1. Baca pertanyaan survei di layar\n' +
        '2. Kirim jawaban yang menurutmu paling umum\n' +
        '3. Papan akan terisi otomatis (7 slot, diurutkan dari poin tertinggi)\n\n' +
        'Contoh: "KUCING" atau "ANJING"\n\n' +
        'Semakin populer jawabanmu, semakin tinggi poinnya!';
    default:
      return '📖 Kirim jawaban langsung di chat.';
  }
}

async function sendHelp(chatId) {
  let msg = helpTextForGame(activeGame);
  bot.sendMessage(chatId, msg);
}

async function sendSoal(chatId) {
  const grid = await getJson('/api/grid');
  if (!grid) {
    bot.sendMessage(chatId, '⚠️ Tidak bisa terhubung ke server');
    return;
  }

  const keyboard = [[{ text: '🔄 Refresh', callback_data: 'soal' }, { text: '🎮 Game Lain', callback_data: 'games' }]];

  if (activeGame.id === 'tts' && Array.isArray(grid.words)) {
    const clues = grid.words.map(w => ({ number: w.number, direction: w.direction, clue: w.clue, length: w.length }));
    bot.sendMessage(chatId, formatClueMessage(clues, 'current'), { reply_markup: { inline_keyboard: keyboard } });
  } else if (activeGame.id === 'cari-kata' && grid.theme) {
    const found = (grid.words || []).filter(w => w.found).length;
    bot.sendMessage(chatId, `🔍 Cari Kata\nTema: ${grid.theme}\n📊 Progres: ${found}/${(grid.words || []).length} kata\n\nKirim kata yang kamu temukan di chat.`, { reply_markup: { inline_keyboard: keyboard } });
  } else if (activeGame.id === 'trivia' && grid.question) {
    const opts = (grid.options || []).map(o => `${o.letter}. ${o.text}`).join('\n');
    bot.sendMessage(chatId, `❓ Trivia (${grid.category || 'Umum'})\n\n${grid.question}\n\n${opts}\n\nKirim pilihan jawabanmu di chat.`, { reply_markup: { inline_keyboard: keyboard } });
  } else if (activeGame.id === 'family100' && grid.question) {
    bot.sendMessage(chatId, `💯 Family 100\n\n${grid.question}\n\n📊 Progres: ${grid.filledCount}/${grid.totalSlots} slot terisi\n\nKirim jawaban yang menurutmu paling umum!`, { reply_markup: { inline_keyboard: keyboard } });
  } else if (grid.baseLetters) {
    const solved = (grid.words || []).filter(w => w.answer).length;
    bot.sendMessage(chatId, `🔤 Huruf dasar: ${grid.baseLetters.split('').join(' ')}\n📊 Progres: ${solved}/${(grid.words || []).length} kata\n\nKirim tebakan kata langsung di chat.`, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    bot.sendMessage(chatId, '🎲 Ada soal aktif, tapi bot belum tau cara nampilinnya buat game ini.', { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function sendGamesList(chatId) {
  const admin = isAdmin(chatId);
  const list = Object.keys(games)
    .map(id => `${id === activeGame.id ? '✅' : '▫️'} ${id}`)
    .join('\n');

  const keyboard = Object.keys(games).map(id => ([{
    text: `${id === activeGame.id ? '✅ ' : ''}${id}`,
    callback_data: `game:${id}`
  }]));

  bot.sendMessage(
    chatId,
    `🎮 Game tersedia:\n${list}${admin ? '\n\nTap buat ganti game.' : '\n\n(Ganti game khusus admin)'}`,
    admin ? { reply_markup: { inline_keyboard: keyboard } } : undefined
  );
}

async function sendPanel(chatId) {
  const keyboard = [
    [{ text: '🔴 Mulai Live', callback_data: 'startlive_hint' }, { text: '⏹️ Stop Live', callback_data: 'stoplive' }],
    [{ text: '🔄 Restart Server', callback_data: 'restartserver' }, { text: '🔄 Restart Bot', callback_data: 'restartbot' }],
    [{ text: '🤖 Restart AI Worker', callback_data: 'restartworker' }],
    [{ text: '📊 Status & Cek Bank Soal', callback_data: 'status' }, { text: '🎮 Ganti Game', callback_data: 'games' }],
    [{ text: '🔄 Reset Jawaban', callback_data: 'reset_answers' }, { text: '⏭️ Skip Soal', callback_data: 'force_next' }],
    [{ text: '🔁 Ulang Siklus Soal', callback_data: 'reset_bank_cycle' }, { text: '🗑️ Reset Leaderboard', callback_data: 'reset_leaderboard' }]
  ];
  bot.sendMessage(chatId, '🔧 Panel Admin', { reply_markup: { inline_keyboard: keyboard } });
}

// Hanya handle pesan biasa dan /start, /help, /soal
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username || msg.from.first_name || 'Anonim';

  rememberChat(chatId);

  // Skip kalau bukan text
  if (!text) return;

  // Command /start
  if (text === '/start') {
    sendStart(chatId);
    return;
  }

  // Command /help
  if (text === '/help') {
    sendHelp(chatId);
    return;
  }

  // Command /soal - liat soal aktif saat ini (bentuknya beda-beda tergantung game aktif)
  if (text === '/soal') {
    sendSoal(chatId);
    return;
  }

  // Tolak command lain
  if (text.startsWith('/')) return;

  // Cek dulu apakah ini komentar "ganti"/"skip"/vote angka pilihan game --
  // dites lewat Telegram dulu sebelum coba di TikTok Live beneran.
  const voteResult = await postJson('/api/vote-comment', { player: username, text });
  if (voteResult && voteResult.handled) {
    return;
  }

  // Parse jawaban pakai parser dari game yang lagi aktif
  const parsed = await activeGame.parseComment(text);
  
  if (!parsed) {
    const hints = {
      'tts': 'Coba: "1 jakarta" atau "nomor 1 jakarta"',
      'cari-kata': 'Kirim kata yang kamu temukan, misal: "KUCING"',
      'trivia': 'Kirim pilihan jawaban, misal: "A"',
      'sambung-kata': 'Kirim kata dari huruf yang tersedia',
      'family100': 'Kirim jawaban yang menurutmu paling umum'
    };
    bot.sendMessage(chatId, `❌ Format tidak dikenali. ${hints[activeGame.id] || 'Ketik /help buat bantuan.'}`);
    return;
  }

  console.log(`📩 ${username}: "${text}" → parsed:`, parsed);

  // Kirim ke API game yang lagi aktif
	const postData = JSON.stringify({
	    ...parsed,
	    player: username
	  });

  const options = {
    hostname: 'localhost',
    port: 3010,
    path: '/api/answer',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        
        if (result.ok) {
          // Pakai meta dari RESPONS SERVER (bukan `parsed` mentah dari parser),
          // soalnya tiap game beda: TTS ada nomor, Sambung Kata bisa aja nggak.
          const meta = result.meta || {};
          const label = meta.number != null
            ? `Nomor ${meta.number} terisi: ${(meta.answer || '').toUpperCase()}`
            : `${(meta.answer || parsed.answer || '').toUpperCase()} terisi`;
          bot.sendMessage(chatId, `✅ Benar! ${label}`);
          console.log(`✅ ${username} benar! ${label}`);
        } else {
          bot.sendMessage(chatId, `❌ ${result.msg}`);
          console.log(`❌ ${username} salah. ${result.msg}`);
        }
      } catch (e) {
        bot.sendMessage(chatId, '⚠️ Error validasi jawaban');
        console.error('Error parsing response:', e);
      }
    });
  });

  req.on('error', (e) => {
    bot.sendMessage(chatId, '⚠️ Tidak bisa terhubung ke server TTS');
    console.error('Error connecting to TTS server:', e);
  });

  req.write(postData);
  req.end();
});

// Error handler
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});