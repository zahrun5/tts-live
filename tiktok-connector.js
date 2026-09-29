require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

const games = require('./games/game-registry');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

// ACTIVE_GAME di .env cuma tebakan awal sebelum sempat disinkron ke
// server.js. Game aktif SEKARANG bisa diganti kapan aja lewat Telegram
// (/game <nama>) tanpa restart connector ini -- makanya activeGame di sini
// mutable, dan disinkron via socket.io-client (event 'game:switched').
let activeGame = games[process.env.ACTIVE_GAME || 'tts'];

const CONFIG_FILE = path.join(__dirname, 'tiktok-config.json');
const SERVER_URL = 'http://localhost:3010';

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

async function syncActiveGame() {
  const data = await getJson('/api/game');
  if (data && games[data.id]) {
    activeGame = games[data.id];
    console.log(`🎮 Game aktif tersinkron dari server: ${data.id}`);
  }
}

const gameSyncSocket = ioClient(SERVER_URL, { reconnection: true });
gameSyncSocket.on('connect', syncActiveGame);
gameSyncSocket.on('game:switched', (data) => {
  if (games[data.gameId]) {
    activeGame = games[data.gameId];
    console.log(`🔀 [TikTok connector] Game aktif diganti jadi: ${data.gameId}`);
  }
});

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('❌ tiktok-config.json tidak ditemukan. Harus di-set lewat /startlive di Telegram.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function postJson(routePath, body) {
  return new Promise((resolve, reject) => {
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
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function reportStatus(active, username, extra = {}) {
  try {
    await postJson('/api/live-status', { active, username, ...extra });
  } catch (e) {
    console.error('⚠️ Gagal lapor status live ke server:', e.message);
  }
}

async function main() {
  if (!activeGame) {
    console.error(`❌ Game "${activeGameId}" tidak ada di game-registry.js`);
    process.exit(1);
  }

  const { username } = loadConfig();
  if (!username) {
    console.error('❌ Username TikTok kosong di tiktok-config.json');
    process.exit(1);
  }

  console.log(`🔌 Menyambung ke TikTok LIVE @${username}... (game aktif: ${activeGame.id})`);

  const connectionOptions = {};
  if (process.env.EULER_API_KEY) {
    connectionOptions.signApiKey = process.env.EULER_API_KEY;
  }

  const connection = new TikTokLiveConnection(username, connectionOptions);

  connection.connect()
    .then((state) => {
      console.log(`✅ Terhubung ke roomId ${state.roomId}`);
      reportStatus(true, username);
    })
    .catch((err) => {
      console.error('❌ Gagal connect ke TikTok Live:', require('util').inspect(err, { depth: null }));
      reportStatus(false, username, { error: err.message || String(err) });
      process.exit(1);
    });

  connection.on(ControlEvent.ERROR, (err) => {
    console.error('🔎 Debug: ControlEvent.ERROR ->', require('util').inspect(err, { depth: null }));
  });

  connection.on(WebcastEvent.CHAT, async (data) => {
    const text = data.comment || data.content;
    const player = (data.user && (data.user.nickname || data.user.uniqueId)) || data.uniqueId || data.nickname || 'TikTokUser';
    if (!text) return;

    console.log(`💬 [TikTok] ${player}: "${text}"`);

    // Kirim semua chat ke frontend buat bubble
    postJson('/api/comment', { player, text })
      .catch((e) => console.error('⚠️ Gagal kirim comment ke server:', e.message));

    // Cek dulu apakah komentar ini relevan buat sistem vote "ganti"/"skip"/
    // pilihan game (dijalankan paralel, gak nge-block alur jawaban biasa
    // di bawah -- vote-controller sendiri yang mutusin relevan atau enggak).
    postJson('/api/vote-comment', { player, text })
      .catch((e) => console.error('⚠️ Gagal kirim vote-comment ke server:', e.message));

    // Parse & kirim jawaban kalau valid
    const parsed = await activeGame.parseComment(text);
    if (!parsed) return;

    console.log(`📩 [TikTok] ${player}: "${text}" → parsed:`, parsed);

    postJson('/api/answer', { ...parsed, player })
      .catch((e) => console.error('⚠️ Gagal kirim jawaban ke server:', e.message));
  });

  connection.on(WebcastEvent.GIFT, (data) => {
    const player = (data.user && data.user.uniqueId) || data.uniqueId || 'TikTokUser';
    console.log(`🎁 [TikTok] ${player} kirim gift: ${data.giftName} x${data.repeatCount}`);
    // TODO: mapping gift -> isi huruf acak, generic buat semua game
  });

  connection.on(WebcastEvent.DISCONNECTED, () => {
    console.log('🔌 Terputus dari TikTok Live');
    reportStatus(false, username);
  });

  connection.on(WebcastEvent.STREAM_END, () => {
    console.log('📴 Live TikTok sudah berakhir');
    reportStatus(false, username);
  });
}

main();

async function gracefulExit() {
  try {
    const { username } = loadConfig();
    await reportStatus(false, username);
  } catch (e) { /* ignore */ }
  process.exit(0);
}
process.on('SIGTERM', gracefulExit);
process.on('SIGINT', gracefulExit);
