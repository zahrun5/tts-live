require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const games = require('./games/game-registry');
// activeGame sekarang MUTABLE -- nilai env cuma tebakan awal sebelum sempat
// disinkron ke server.js (sumber kebenaran sebenarnya), dan bisa berubah
// kapan aja lewat command /game atau saat orang lain ganti game dari Telegram.
let activeGame = games[process.env.ACTIVE_GAME || 'tts'];
// Mode game dari server.js: 'random' = semua game diputar acak tiap ronde,
// 'fixed' = tetap di satu game. Sama kayak activeGame, ini cuma cache --
// sumber kebenarannya di server.js.
let gameMode = 'random';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Nama proses PM2 buat AI worker tiap game yang punya fitur bank soal.
// Dulu di-hardcode ke tts-worker-family100 doang -- sekarang di-mapping per
// gameId biar tombol "Restart AI Worker" & label bank soal di /status ngikutin
// game yang lagi AKTIF, bukan family100 melulu. Tambahin baris baru di sini
// tiap kali ada game baru yang dikasih worker sendiri.
const WORKER_PM2_NAMES = {
  'tts': 'tts-worker-tts',
  'sambung-kata': 'tts-worker-sambung-kata',
  'cari-kata': 'tts-worker-cari-kata',
  'trivia': 'tts-worker-trivia',
  'family100': 'tts-worker-family100',
  'susun-kata-acak': 'tts-worker-susun-kata-acak',
  'susun-kalimat': 'tts-worker-susun-kalimat'
};

const KNOWN_CHATS_FILE = path.join(__dirname, 'known-chats.json');
const TIKTOK_CONFIG_FILE = path.join(__dirname, 'tiktok-config.json');
const SERVER_URL = 'http://localhost:3010';

// ---------- Tracking chat yang pernah interaksi ----------

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

// HANYA UNTUK ADMIN - TIDAK ADA BROADCAST ATAU PARSE JAWABAN

// ---------- Helper kontrol proses (PM2) ----------

async function pm2(cmd) {
  try {
    const { stdout } = await execAsync(`pm2 ${cmd}`);
    return { ok: true, out: stdout };
  } catch (e) {
    return { ok: false, out: e.stderr || e.message };
  }
}

async function getLiveStatus() {
  return new Promise((resolve) => {
    http.get(`${SERVER_URL}/api/live-status`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

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
    if (data.mode) gameMode = data.mode;
    console.log(`🎮 Game aktif tersinkron dari server: ${data.id} (mode: ${gameMode})`);
  } else {
    console.warn('⚠️ Gagal sinkron game aktif ke server, pakai tebakan dari .env sementara.');
  }
}
syncActiveGame();

// Dulu bot admin cuma sinkron SEKALI pas start, jadi begitu game ganti sendiri
// (rotasi acak tiap ronde) activeGame di sini basi -- /soal, /status, dan
// tombol Restart AI Worker ngarah ke game yang salah. Sekarang ikut dengerin
// event dari server.js biar selalu update.
const syncSocket = io(SERVER_URL, { reconnection: true });
syncSocket.on('connect', syncActiveGame);
syncSocket.on('game:switched', (data) => {
  if (games[data.gameId]) activeGame = games[data.gameId];
  if (data.mode) gameMode = data.mode;
});
syncSocket.on('mode:changed', (data) => {
  if (data && data.mode) gameMode = data.mode;
});

function isRandomMode() {
  return gameMode === 'random';
}

// Label game aktif buat ditampilin ke admin, ngikutin mode.
function activeGameLabel() {
  return isRandomMode()
    ? `🎲 Game Acak (sekarang: ${activeGame.id})`
    : `📌 ${activeGame.id} (tetap)`;
}

async function pm2StatusSummary() {
  const { ok, out } = await pm2('jlist');
  if (!ok) return '⚠️ Gagal ambil status PM2. Pastikan PM2 sudah di-setup.';
  try {
    const list = JSON.parse(out);
    const names = ['tts-server', 'tts-bot', 'tts-tiktok', ...Object.values(WORKER_PM2_NAMES)];
    const lines = names.map((name) => {
      const proc = list.find((p) => p.name === name);
      if (!proc) return `${name}: ❔ belum terdaftar di PM2`;
      const status = proc.pm2_env.status;
      const emoji = status === 'online' ? '🟢' : status === 'stopped' ? '⚪' : '🔴';
      return `${emoji} ${name}: ${status}`;
    });
    return lines.join('\n');
  } catch (e) {
    return '⚠️ Gagal parsing status PM2.';
  }
}

// ---------- Pesan + tombol inline (dipakai bareng oleh command teks & callback tombol) ----------

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
    `Game aktif saat ini: ${activeGameLabel()}\n\n` +
    'Ketik /help buat liat cara mainnya, atau langsung kirim jawaban di chat!',
    startKeyboard()
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

  const keyboard = [
    [{ text: '🎮 Daftar Game', callback_data: 'games' }, { text: '📋 Soal Aktif', callback_data: 'soal' }]
  ];

  if (isAdmin(chatId)) {
    keyboard.push([{ text: '🔧 Panel Admin', callback_data: 'panel' }]);
  }

  bot.sendMessage(chatId, msg, { reply_markup: { inline_keyboard: keyboard } });
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
  // Ambil kondisi terbaru dari server dulu (game + mode), jangan percaya cache.
  await syncActiveGame();

  const admin = isAdmin(chatId);
  const random = isRandomMode();

  // Mode Acak: game yang lagi dimainkan cuma ditandai ▶️ (bukan pilihan admin),
  // ✅ dipakai buat opsi yang beneran lagi dipilih.
  const mark = (id) => {
    if (random) return id === activeGame.id ? '▶️' : '▫️';
    return id === activeGame.id ? '✅' : '▫️';
  };

  const lines = [
    `${random ? '✅' : '▫️'} 🎲 Game Acak (semua game diputar tiap ronde)`,
    ...Object.keys(games).map(id => `${mark(id)} ${id}`)
  ].join('\n');

  const keyboard = [
    [{ text: `${random ? '✅ ' : ''}🎲 Game Acak`, callback_data: 'game:random' }],
    ...Object.keys(games).map(id => ([{
      text: `${mark(id)} ${id}`,
      callback_data: `game:${id}`
    }]))
  ];

  const legend = random ? '\n\n▶️ = sedang dimainkan sekarang' : '';

  bot.sendMessage(
    chatId,
    `🎮 Game tersedia:\n${lines}${legend}${admin ? '\n\nTap buat ganti. Pilih game tertentu = tetap di game itu, pilih Game Acak = pindah-pindah tiap ronde.' : '\n\n(Ganti game khusus admin)'}`,
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

// ---------- Aksi admin (dipanggil dari command teks maupun tombol) ----------

async function doSwitchGame(chatId, gameId) {
  const wantsRandom = ['random', 'acak'].includes(String(gameId).trim().toLowerCase());

  bot.sendMessage(chatId, wantsRandom
    ? '⏳ Mengaktifkan mode Game Acak...'
    : `⏳ Mengganti game ke "${gameId}"...`);
  const result = await postJson('/api/switch-game', { gameId });

  if (!result) {
    bot.sendMessage(chatId, '⚠️ Tidak bisa terhubung ke server');
    return;
  }
  if (!result.ok) {
    bot.sendMessage(chatId, `⚠️ ${result.error}`);
    return;
  }

  // Pesan konfirmasi ke admin dikirim langsung dari sini (bot admin nggak
  // punya broadcast; broadcast ke penonton dikerjain bot pemain).
  if (result.mode) gameMode = result.mode;

  if (wantsRandom) {
    bot.sendMessage(chatId, result.modeChanged
      ? `🎲 Mode Game Acak aktif!\nRonde sekarang tetap lanjut di "${result.id}". Begitu selesai, game pindah acak ke game lain, dan begitu seterusnya tiap ronde.`
      : '🎲 Mode Game Acak memang sudah aktif.');
  } else if (result.unchanged && result.modeChanged) {
    bot.sendMessage(chatId, `📌 Mode Game Acak dimatikan. Tetap di "${result.id}" — tiap ronde selesai, soal baru di game yang sama.`);
  } else if (result.unchanged) {
    bot.sendMessage(chatId, `ℹ️ Game "${result.id}" memang lagi aktif.`);
  } else {
    bot.sendMessage(chatId, `📌 Game diganti ke "${result.id}"${result.modeChanged ? ' dan Mode Game Acak dimatikan' : ''}. Tiap ronde selesai, soal baru di game yang sama.`);
  }
}

async function doStartLiveHint(chatId) {
  const config = loadConfig();
  const lastUsername = config.username || null;
  
  const keyboard = [];
  
  if (lastUsername) {
    keyboard.push([{ text: `🔴 ${lastUsername} (terakhir)`, callback_data: `startlive:${lastUsername}` }]);
  }
  
  keyboard.push([{ text: '✏️ Input Username Baru', callback_data: 'startlive_manual' }]);
  
  bot.sendMessage(chatId, 
    `🔴 Mulai Live TikTok\n${lastUsername ? `\nUsername terakhir: ${lastUsername}` : ''}`, 
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

function loadConfig() {
  try {
    if (!fs.existsSync(TIKTOK_CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(TIKTOK_CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function doStopLive(chatId) {
  const result = await pm2('stop tts-tiktok');
  bot.sendMessage(chatId, result.ok ? '⏹️ Live TikTok dihentikan.' : `⚠️ Gagal stop: ${result.out}`);
}

async function doRestartServer(chatId) {
  const result = await pm2('restart tts-server');
  bot.sendMessage(chatId, result.ok ? '🔄 server.js di-restart.' : `⚠️ Gagal restart: ${result.out}`);
}

async function doRestartBot(chatId) {
  bot.sendMessage(chatId, '🔄 Bot di-restart, tunggu beberapa detik...').then(() => {
    pm2('restart tts-bot');
    // Nggak perlu exit manual -- pm2 restart dari luar bakal kill & respawn proses ini
  });
}

async function doRestartWorker(chatId) {
  const workerName = WORKER_PM2_NAMES[activeGame.id];
  if (!workerName) {
    bot.sendMessage(chatId, `⚠️ Game "${activeGame.id}" belum punya AI worker terdaftar (cek WORKER_PM2_NAMES di telegram-bot.js).`);
    return;
  }
  const result = await pm2(`restart ${workerName} || pm2 start ecosystem.config.js --only ${workerName}`);
  bot.sendMessage(chatId, result.ok ? `🤖 AI Worker (${workerName}) di-restart/dijalankan.` : `⚠️ Gagal restart worker: ${result.out}`);
}

async function doStatus(chatId) {
  await syncActiveGame(); // label game + bank soal harus ngikutin kondisi server terbaru
  const [pm2Summary, live, bankStatsRes] = await Promise.all([
    pm2StatusSummary(), 
    getLiveStatus(),
    getJson('/api/bank-stats')
  ]);
  
  const liveLine = live && live.active
    ? `\n🔴 Live aktif: @${live.username}`
    : '\n⚪ Tidak sedang live';
    
  let bankLine = '';
  if (bankStatsRes && bankStatsRes.ok && bankStatsRes.stats) {
    const { total, used } = bankStatsRes.stats;
    bankLine = `\n\n📚 Bank Soal ${activeGame.id}:\nTotal Soal: ${total}\nSudah Dipakai: ${used}\nSisa Putaran Ini: ${total - used}`;
  }
    
  bot.sendMessage(chatId, `📊 Status proses:\n${pm2Summary}${liveLine}\n🎮 Game: ${activeGameLabel()}${bankLine}`);
}

// ---------- Handler pesan Telegram ----------

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

  // Command /games - liat daftar game yang tersedia
  if (text === '/games') {
    sendGamesList(chatId);
    return;
  }

  // Command /game <id> - ganti game aktif (admin only)
  if (text === '/game' || text.startsWith('/game ') || text.startsWith('/game@')) {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '⛔ Command ini khusus admin.');

    // Handle /game@botname tts dan /game tts
    const gameId = text.replace(/^\/game(@\S+)?\s*/, '').trim();
    if (!gameId) {
      return bot.sendMessage(chatId, `Format: /game <nama>\nPilihan: random, ${Object.keys(games).join(', ')}`);
    }

    await doSwitchGame(chatId, gameId);
    return;
  }

  // Command /panel - buka panel tombol admin
  if (text === '/panel') {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '⛔ Command ini khusus admin.');
    sendPanel(chatId);
    return;
  }

  // ---------- Command kontrol (admin only) ----------

  if (text.startsWith('/startlive')) {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '⛔ Command ini khusus admin.');

    const username = text.replace('/startlive', '').trim().replace(/^@/, '');
    if (!username) {
      return bot.sendMessage(chatId, 'Format: /startlive <username_tiktok>\nContoh: /startlive officialgeilegisela');
    }

    fs.writeFileSync(TIKTOK_CONFIG_FILE, JSON.stringify({ username }, null, 2), 'utf8');
    bot.sendMessage(chatId, `⏳ Menyambungkan ke TikTok @${username}...`);

    const result = await pm2('restart tts-tiktok || pm2 start ecosystem.config.js --only tts-tiktok');
    if (!result.ok) {
      bot.sendMessage(chatId, `⚠️ Gagal start connector: ${result.out}`);
    }
    // Status "berhasil connect" nanti dikirim otomatis lewat event live:status dari server
    return;
  }

  if (text === '/stoplive') {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '⛔ Command ini khusus admin.');
    await doStopLive(chatId);
    return;
  }

  if (text === '/restartserver') {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '⛔ Command ini khusus admin.');
    await doRestartServer(chatId);
    return;
  }

  if (text === '/restartbot') {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '⛔ Command ini khusus admin.');
    await doRestartBot(chatId);
    return;
  }

  if (text === '/status') {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '⛔ Command ini khusus admin.');
    await doStatus(chatId);
    return;
  }

  // Tolak command lain dan abaikan pesan teks dari admin (biar nggak nge-parse jawaban game)
  if (text.startsWith('/')) return;

});

// ---------- Handler tombol inline ----------

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  // Selalu jawab dulu biar spinner loading di tombol Telegram-nya ilang,
  // apapun hasilnya di bawah.
  bot.answerCallbackQuery(query.id).catch(() => {});

  rememberChat(chatId);

  const adminOnly = ['panel', 'stoplive', 'restartserver', 'restartbot', 'restartworker', 'status', 'startlive_hint', 'reset_leaderboard', 'reset_answers', 'reset_bank_cycle', 'force_next', 'startlive_manual'];
  if ((adminOnly.includes(data) || data.startsWith('game:') || data.startsWith('startlive:')) && !isAdmin(chatId)) {
    bot.sendMessage(chatId, '⛔ Command ini khusus admin.');
    return;
  }

  if (data === 'help') return sendHelp(chatId);
  if (data === 'games') return sendGamesList(chatId);
  if (data === 'soal') return sendSoal(chatId);
  if (data === 'panel') return sendPanel(chatId);
  if (data === 'startlive_hint') return doStartLiveHint(chatId);
  if (data === 'startlive_manual') {
    bot.sendMessage(chatId, 'Ketik command:\n/startlive <username_tiktok>\n\nContoh:\n/startlive officialgeilegisela');
    return;
  }
  if (data === 'stoplive') return doStopLive(chatId);
  if (data === 'restartserver') return doRestartServer(chatId);
  if (data === 'restartbot') return doRestartBot(chatId);
  if (data === 'restartworker') return doRestartWorker(chatId);
  if (data === 'status') return doStatus(chatId);
  
  if (data === 'reset_leaderboard') {
    const result = await postJson('/api/reset-leaderboard', {});
    if (result && result.ok) {
      bot.sendMessage(chatId, '🗑️ Leaderboard berhasil direset!');
    } else {
      bot.sendMessage(chatId, '⚠️ Gagal reset leaderboard');
    }
    return;
  }

  if (data === 'reset_answers') {
    const result = await postJson('/api/reset', {});
    if (result && result.ok) {
      bot.sendMessage(chatId, '🔄 Jawaban berhasil direset! Soal yang sama dimulai dari awal.');
    } else {
      bot.sendMessage(chatId, '⚠️ Gagal reset jawaban');
    }
    return;
  }

  if (data === 'reset_bank_cycle') {
    const result = await postJson('/api/bank-reset-cycle', {});
    if (result && result.ok) {
      bot.sendMessage(chatId, '🔁 Siklus soal berhasil direset! Ronde berikutnya akan mengambil dari soal nomor 1 lagi.');
    } else {
      bot.sendMessage(chatId, `⚠️ Gagal reset siklus: ${result ? result.error : 'Server tidak merespon'}`);
    }
    return;
  }

  if (data === 'force_next') {
    bot.sendMessage(chatId, '⏭️ Memaksa skip soal, tunggu sebentar...');
    const result = await postJson('/api/force-next', {});
    if (result && result.ok) {
      bot.sendMessage(chatId, '✅ Soal berhasil diskip dan diganti yang baru!');
    } else {
      bot.sendMessage(chatId, `⚠️ Gagal skip soal: ${result ? result.error : 'Server tidak merespon'}`);
    }
    return;
  }

  if (data.startsWith('game:')) {
    const gameId = data.slice('game:'.length);
    return doSwitchGame(chatId, gameId);
  }
  
  if (data.startsWith('startlive:')) {
    const username = data.slice('startlive:'.length);
    bot.sendMessage(chatId, `⏳ Memulai live dengan @${username}...`);
    
    // Simpan config
    fs.writeFileSync(TIKTOK_CONFIG_FILE, JSON.stringify({ username }, null, 2), 'utf8');
    
    // Restart connector
    const result = await pm2('restart tts-tiktok');
    if (result.ok) {
      bot.sendMessage(chatId, `🔴 Connector dimulai untuk @${username}\nTunggu beberapa detik...`);
    } else {
      bot.sendMessage(chatId, `⚠️ Gagal start: ${result.out}`);
    }
    return;
  }
});

// Error handler
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});