const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const fs = require('fs');
const games = require('./games/game-registry');
const createVoteController = require('./vote-controller');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- Pelindung terhadap circular reference di payload emit ---
// Bug: kalau ada objek yang nyimpen referensi ke dirinya sendiri (langsung
// atau lewat rantai objek lain) terus di-emit lewat Socket.IO, library
// parsernya (hasBinary) bisa infinite recursion -> "RangeError: Maximum
// call stack size exceeded" -> proses Node.js CRASH TOTAL (bukan cuma
// request itu doang yang gagal). Ini kejadian nyata di production waktu
// pindah dari family100 ke game lain.
// safeEmit() bungkus io.emit() biasa: coba JSON.stringify dulu, kalau
// gagal karena circular, LOG PATH-nya biar ketauan field mana yang salah,
// terus SKIP emit itu doang -- server tetep hidup, gak restart paksa.
function findCircularPath(obj) {
  const seen = new WeakSet();
  function walk(val, path) {
    if (val && typeof val === 'object') {
      if (seen.has(val)) return path;
      seen.add(val);
      for (const key of Object.keys(val)) {
        const found = walk(val[key], `${path}.${key}`);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(obj, 'payload');
}

function safeEmit(event, payload) {
  try {
    JSON.stringify(payload); // trigger deteksi circular SEBELUM sampai ke socket.io
    io.emit(event, payload);
  } catch (err) {
    const circularPath = findCircularPath(payload);
    console.error(`❌ safeEmit('${event}') DIBATALKAN — payload bermasalah (kemungkinan circular reference di: ${circularPath || 'tidak terdeteksi, cek manual'}). Server tetap jalan. Error asli: ${err.message}`);
  }
}

function safeSocketEmit(socket, event, payload) {
  try {
    JSON.stringify(payload);
    socket.emit(event, payload);
  } catch (err) {
    const circularPath = findCircularPath(payload);
    console.error(`❌ safeSocketEmit('${event}') DIBATALKAN — payload bermasalah (kemungkinan circular reference di: ${circularPath || 'tidak terdeteksi, cek manual'}). Error asli: ${err.message}`);
  }
}
const PORT = process.env.PORT || 3010;

// ACTIVE_GAME di .env/ecosystem.config.js cuma dipakai sebagai FALLBACK kalau
// belum pernah ada yang pindah game sama sekali. Begitu ada yang pindah lewat
// /api/switch-game (misal dari Telegram), pilihannya disimpan ke active-game.json
// biar KEINGET terus walau server restart/reboot -- nggak balik ke .env lagi.
const ACTIVE_GAME_FILE = path.join(__dirname, 'active-game.json');

// MODE GAME: 'random' = semua game diputar acak tiap ronde selesai (default,
// perilaku rotasi yang selama ini jalan), 'fixed' = tetap di game yang
// sedang aktif dan tiap ronde selesai cuma generate soal baru di game yang
// sama. Dipilih admin lewat Telegram (/game random atau /game <nama>) dan
// ikut disimpan di active-game.json bareng gameId biar KEINGET pas restart.
const GAME_MODE_RANDOM = 'random';
const GAME_MODE_FIXED = 'fixed';
const RANDOM_MODE_ALIASES = ['random', 'acak'];

function loadActiveState() {
  try {
    if (fs.existsSync(ACTIVE_GAME_FILE)) {
      const saved = JSON.parse(fs.readFileSync(ACTIVE_GAME_FILE, 'utf8'));
      return {
        gameId: games[saved.gameId] ? saved.gameId : null,
        // File lama (cuma { gameId }) nggak punya field mode -> anggap random,
        // sama persis kayak perilaku sebelum fitur ini ada.
        mode: saved.mode === GAME_MODE_FIXED ? GAME_MODE_FIXED : GAME_MODE_RANDOM
      };
    }
  } catch (e) {
    console.error('⚠️ Gagal baca active-game.json, pakai fallback .env:', e.message);
  }
  return { gameId: null, mode: GAME_MODE_RANDOM };
}

function saveActiveState() {
  try {
    fs.writeFileSync(ACTIVE_GAME_FILE, JSON.stringify({ gameId: activeGameId, mode: gameMode }, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ Gagal simpan active-game.json (game/mode tetep ganti, tapi gak persist kalau restart):', e.message);
  }
}

// Dulu leaderboard cuma disimpan di variabel di memori doang -- akibatnya
// tiap kali server direstart (misal abis deploy kode baru), SEMUA poin
// viewer ilang total walau live/stream-nya masih jalan terus. Sekarang
// disimpen ke leaderboard.json tiap ada perubahan skor, jadi selamet
// walau proses Node.js-nya restart.
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

// MODE ROTASI ACAK: game aktif ganti sendiri tiap ronde selesai (lihat
// handleRoundCompleted), jadi leaderboard PER GAME (format lama) bikin
// papan skor keliatan "reset" tiap ganti game -- padahal cuma pindah ke
// bucket lain, bukan beneran direset. Ini bikin viewer yang udah 500+ poin
// kesel pas game pindah pas live. Sekarang leaderboard SATU GABUNGAN buat
// semua game, disimpen di key GLOBAL_LB_KEY, dan TERUS JALAN nembus
// pergantian game. Data lama per-game (kalau ada dari file leaderboard.json
// sebelumnya) dibiarin aja di file, cuma nggak dipakai lagi.
const GLOBAL_LB_KEY = '_global';

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
      const isOldFlatFormat = Object.values(data).some(v => typeof v === 'number');
      if (isOldFlatFormat) {
        // Migrasi otomatis: file lama isinya skor buat game yang lagi aktif
        // waktu itu -> taruh di bawah key activeGameId biar gak ilang.
        console.log('ℹ️ leaderboard.json format lama terdeteksi, migrasi ke format per-game...');
        return { [activeGameId]: data };
      }
      return data;
    }
  } catch (e) {
    console.error('⚠️ Gagal baca leaderboard.json, mulai dari kosong:', e.message);
  }
  return {};
}

function saveLeaderboard() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ Gagal simpan leaderboard.json (poin tetep nambah, tapi gak persist kalau restart):', e.message);
  }
}

const savedActiveState = loadActiveState();
let activeGameId = savedActiveState.gameId || process.env.ACTIVE_GAME || 'tts';
let gameMode = savedActiveState.mode;
let activeGame = games[activeGameId];

if (!activeGame) {
  console.error(`❌ Game "${activeGameId}" tidak ada di game-registry.js`);
  process.exit(1);
}

let leaderboard = loadLeaderboard(); // { namaPlayer: skor } -- sekarang persist ke leaderboard.json
let liveStatus = { active: false, username: null, updatedAt: null };
let isGeneratingNext = false;
let unlockedLevels = { 2: false, 3: false }; // track level unlock status

function getHighestScore() {
  const board = leaderboard[GLOBAL_LB_KEY] || {};
  return Math.max(0, ...Object.values(board));
}

function checkLevelUnlock() {
  const highScore = getHighestScore();
  const unlocked = [];
  
  if (highScore >= 300 && !unlockedLevels[2]) {
    unlockedLevels[2] = true;
    unlocked.push(2);
  }
  if (highScore >= 500 && !unlockedLevels[3]) {
    unlockedLevels[3] = true;
    unlocked.push(3);
  }
  
  return unlocked;
}

function getRandomLevel() {
  const available = [1];
  if (unlockedLevels[2]) available.push(2);
  if (unlockedLevels[3]) available.push(3);
  return available[Math.floor(Math.random() * available.length)];
}

// Avatar mini viewer -- cuma emoji simpel (bukan upload custom), di-assign
// SEKALI per viewer per SESI LIVE waktu dia pertama kali dapet poin.
// Direset total tiap kali live baru mulai (bukan permanen).
// MAX 10 avatar (yang terakhir komen), auto hilang kalau 2 menit gak komen.
const AVATAR_POOL = [
  '🐱','🐶','🐰','🦊','🐻','🐼','🐨','🐯','🐸','🐵','🦁','🐷','🐹','🐮',
  '🐔','🐧','🐦','🦉','🐺','🐗','🐴','🦄','🐝','🐛','🐢','🐍','🦎','🐙',
  '🐳','🐬','🦈','🐊','🦒','🐘','🦏','🦛','🦘','🦥','🦦','🦡','🦨','🐿️',
  '🦔','🐐','🐑','🦙','🐫','🦌','🐇','🦫'
];
let sessionAvatars = {}; // { namaPlayer: { emoji, lastActive, timer } }
const MAX_AVATARS = 20;
const AVATAR_TIMEOUT = 120000; // 2 menit

function removeAvatar(player) {
  if (!sessionAvatars[player]) return;
  clearTimeout(sessionAvatars[player].timer);
  delete sessionAvatars[player];
  safeEmit('avatar:remove', { player });
  console.log(`🗑️ Avatar ${player} dihapus (idle 2 menit)`);
}

function updateAvatarActivity(player) {
  if (!sessionAvatars[player]) return;
  
  clearTimeout(sessionAvatars[player].timer);
  sessionAvatars[player].lastActive = Date.now();
  sessionAvatars[player].timer = setTimeout(() => removeAvatar(player), AVATAR_TIMEOUT);
}

function assignAvatarIfNeeded(player) {
  const name = player || 'Anonim';
  
  // Kalau udah ada avatar, update activity aja
  if (sessionAvatars[name]) {
    updateAvatarActivity(name);
    return null;
  }

  // Kalau udah 10 avatar, hapus yang paling lama gak aktif
  if (Object.keys(sessionAvatars).length >= MAX_AVATARS) {
    const entries = Object.entries(sessionAvatars).sort((a, b) => a[1].lastActive - b[1].lastActive);
    const [oldestPlayer] = entries[0];
    removeAvatar(oldestPlayer);
  }

  const used = new Set(Object.values(sessionAvatars).map(a => a.emoji));
  const available = AVATAR_POOL.filter(e => !used.has(e));
  const pool = available.length > 0 ? available : AVATAR_POOL;

  const emoji = pool[Math.floor(Math.random() * pool.length)];
  const timer = setTimeout(() => removeAvatar(name), AVATAR_TIMEOUT);
  
  sessionAvatars[name] = { emoji, lastActive: Date.now(), timer };
  return emoji;
}

function resetSessionAvatars() {
  sessionAvatars = {};
  safeEmit('avatar:reset');
}

activeGame.init();
// Hook opsional: game yang butuh broadcast di LUAR siklus request biasa
// (misal Susun Kata Acak, yang ganti slot sendiri lewat setTimeout abis
// cooldown) bisa daftar di sini. Game lain yang nggak butuh (TTS, Sambung
// Kata, dst) nggak perlu implement setBroadcaster sama sekali -- aman.
if (activeGame.setBroadcaster) activeGame.setBroadcaster(() => safeEmit('update', activeGame.buildStatePayload()));

app.use(express.json());

// Tiap game punya folder public sendiri (public/tts, public/sambung-kata).
// Dulu di-mount sekali pakai express.static biasa (fixed path) -- sekarang
// dibungkus middleware tipis biar ngikutin activeGameId TERKINI setiap
// request masuk, jadi bisa ganti game tanpa restart server.
const staticHandlers = {}; // cache 1 instance express.static per game, biar gak dibikin ulang tiap request
function serveActiveGamePublic(req, res, next) {
  if (!staticHandlers[activeGameId]) {
    // Penting: index.html HARUS no-cache. Domain ini publik (bukan localhost),
    // jadi browser/CDN gampang nyimpen index.html versi game LAMA -- begitu
    // ganti game, viewer masih liat halaman game sebelumnya (nyangkut di
    // 'Menunggu soal...' selamanya) walau server & data soal udah bener.
    // Aset lain (CSS/JS/gambar) masih boleh di-cache normal biar tetep cepat.
    staticHandlers[activeGameId] = express.static(path.join(__dirname, 'public', activeGameId), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    });
  }
  staticHandlers[activeGameId](req, res, next);
}
app.use(serveActiveGamePublic);

// Folder khusus buat aset yang dipakai LINTAS game (bukan punya 1 game doang),
// misal script overlay vote "ganti"/"skip"/pilihan-game yang dipasang di
// beberapa frontend game sekaligus (family100, sambung-kata).
app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));

function addScore(player, points) {
  const name = player || 'Anonim';
  if (!leaderboard[GLOBAL_LB_KEY]) leaderboard[GLOBAL_LB_KEY] = {};
  leaderboard[GLOBAL_LB_KEY][name] = (leaderboard[GLOBAL_LB_KEY][name] || 0) + points;
  saveLeaderboard();
}

function buildLeaderboardPayload() {
  const board = leaderboard[GLOBAL_LB_KEY] || {};
  return Object.entries(board)
    .map(([player, score]) => ({ player, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// --- MODE ROTASI ACAK ---
// Tiap ronde selesai, game aktif GANTI SENDIRI ke game lain yang dipilih
// acak dari game-registry.js (bukan cuma generate soal baru di game yang
// sama). Leaderboard tetap gabungan (GLOBAL_LB_KEY) jadi nggak keliatan
// reset tiap ganti. Frontend tiap game beda file/tampilan total, jadi abis
// switch kita juga broadcast 'game:switched' -- shared/game-switch-watcher.js
// yang di-include di semua halaman game bakal reload halaman biar kelihatan.
function pickRandomGameId(excludeId) {
  const allIds = Object.keys(games);
  const pool = allIds.filter(id => id !== excludeId);
  const candidates = pool.length > 0 ? pool : allIds;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function hasReadyFrontend(gameId) {
  return fs.existsSync(path.join(__dirname, 'public', gameId, 'index.html'));
}

// Pindah ke `nextId` dan langsung generate ronde baru buat game itu (bukan
// cuma reload state lama yang mungkin udah "selesai" dari terakhir kali
// game itu dimainkan).
async function switchGameAndGenerateRound(nextId) {
  const nextGame = games[nextId];

  try {
    await nextGame.init();
  } catch (err) {
    console.error(`❌ Gagal init game "${nextId}" pas rotasi acak:`, err.message);
    safeEmit('puzzle:error', { message: `Gagal menyiapkan game "${nextId}"` });
    return;
  }

  console.log(`🎲 Rotasi acak: ${activeGame.id} → ${nextId}`);
  activeGame = nextGame;
  activeGameId = nextId;
  saveActiveState();
  if (activeGame.setBroadcaster) activeGame.setBroadcaster(() => safeEmit('update', activeGame.buildStatePayload()));

  isGeneratingNext = true;
  safeEmit('puzzle:completed', { message: `Ronde selesai! Ganti ke game "${nextId}"...` });

  try {
    const level = getRandomLevel();
    const result = await activeGame.onComplete(level);

    if (!result || result.success === false) {
      console.error(`❌ Gagal generate ronde awal buat "${nextId}":`, result && result.error);
      safeEmit('puzzle:error', { message: `Gagal membuat soal buat game "${nextId}"` });
      return;
    }

    const statePayload = activeGame.buildStatePayload();
    // Kirim game:switched DULU dengan state yang udah fresh -- biar page
    // yang reload langsung dapet soal baru pas connect ulang, bukan state
    // basi dari kunjungan game ini terakhir kali.
    safeEmit('game:switched', { gameId: nextId, state: statePayload, mode: gameMode });
    safeEmit('leaderboard:update', buildLeaderboardPayload());
    safeEmit('update', statePayload);
    safeEmit('puzzle:new', {
      clues: activeGame.buildClueList ? activeGame.buildClueList() : null,
      source: result.source || 'random-rotation',
      level: result.level
    });
    console.log(`✓ Game "${nextId}" siap (sumber: ${result.source || 'generated'})`);

    setTimeout(() => {
      safeEmit('update', activeGame.buildStatePayload());
    }, 500);
  } catch (err) {
    console.error(`❌ Error generate ronde awal "${nextId}":`, err.message);
    console.error(err.stack);
    safeEmit('puzzle:error', { message: 'Error internal saat ganti game' });
  } finally {
    isGeneratingNext = false;
  }
}

// Ronde di game yang sama (MODE 'fixed'): nggak pindah game, cukup minta game
// aktif generate soal baru -- jalurnya sama kayak skip (performForceNext).
async function startNextRoundInSameGame() {
  console.log(`🔁 Ronde selesai! Mode game tetap, lanjut ronde baru di "${activeGame.id}"...`);

  isGeneratingNext = true;
  safeEmit('puzzle:completed', { message: 'Ronde selesai! Menyiapkan soal berikutnya...' });

  try {
    const result = await performForceNext('next-round');
    if (!result.ok) {
      console.error(`❌ Gagal generate ronde baru di "${activeGame.id}":`, result.error);
      safeEmit('puzzle:error', { message: 'Gagal membuat soal baru' });
    }
  } finally {
    isGeneratingNext = false;
  }
}

async function handleRoundCompleted() {
  if (gameMode === GAME_MODE_FIXED) {
    return startNextRoundInSameGame();
  }

  console.log('🎉 Ronde selesai! Cari game acak berikutnya...');

  const previousId = activeGameId;
  let nextId = pickRandomGameId(previousId);

  // Kalau folder frontend game hasil random itu ternyata belum siap
  // (kejadian lama: public/<game>/ kosong), coba game lain satu-satu
  // sebelum nyerah dan tetap di game sekarang.
  if (!hasReadyFrontend(nextId)) {
    console.error(`⚠️ Rotasi acak lewati "${nextId}" (folder public belum siap)`);
    const fallbackId = Object.keys(games).find(id => id !== previousId && hasReadyFrontend(id));
    nextId = fallbackId || null;
  }

  if (!nextId) {
    console.error('❌ Nggak ada game lain yang siap dipakai, generate ulang di game sekarang aja');
    nextId = previousId;
  }

  await switchGameAndGenerateRound(nextId);
}

app.get('/api/game', (req, res) => res.json({ id: activeGame.id, mode: gameMode, available: Object.keys(games) }));

// Ganti mode game. Return true kalau mode-nya BENERAN berubah. Cuma ngubah
// flag + simpan + kabarin client (event 'mode:changed'), TIDAK ganti game
// yang lagi jalan -- jadi ronde yang sedang berlangsung nggak keputus.
function setGameMode(mode) {
  if (gameMode === mode) return false;
  gameMode = mode;
  saveActiveState();
  console.log(`🎛️ Mode game diganti: ${mode === GAME_MODE_RANDOM ? 'ACAK (rotasi semua game)' : `TETAP di "${activeGame.id}"`}`);
  safeEmit('mode:changed', { mode: gameMode, gameId: activeGame.id });
  return true;
}

// Logic inti ganti game, dipisah dari route Express biar bisa dipanggil
// juga oleh vote-controller.js (hasil vote penonton), bukan cuma dari
// HTTP request /api/switch-game (Telegram admin).
async function performSwitchGame(gameId) {
  const nextGame = games[gameId];

  if (!nextGame) {
    return { ok: false, status: 400, error: `Game "${gameId}" tidak ada. Pilihan: ${Object.keys(games).join(', ')}` };
  }

  // Cek dulu folder frontend-nya beneran ada isinya SEBELUM pindah --
  // kejadian kemarin: folder public/<game>/ ada tapi kosong (file kesasar
  // ke folder games/ bukan public/), jadinya "Cannot GET /" di layar.
  const indexPath = path.join(__dirname, 'public', gameId, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return {
      ok: false,
      status: 400,
      error: `Folder public/${gameId}/index.html belum ada/kosong. Taruh dulu file frontend-nya di situ sebelum pindah ke game ini.`
    };
  }

  if (gameId === activeGame.id) {
    return { ok: true, id: activeGame.id, unchanged: true };
  }

  try {
    await nextGame.init();
  } catch (err) {
    console.error(`❌ Gagal init game "${gameId}":`, err.message);
    return { ok: false, status: 500, error: `Gagal menyiapkan game "${gameId}": ${err.message}` };
  }

  console.log(`🔀 Game aktif diganti: ${activeGame.id} → ${gameId}`);
  activeGame = nextGame;
  activeGameId = gameId;
  saveActiveState();
  if (activeGame.setBroadcaster) activeGame.setBroadcaster(() => safeEmit('update', activeGame.buildStatePayload()));

  try {
    const state = activeGame.buildStatePayload();
    safeEmit('game:switched', { gameId, state, mode: gameMode });
    safeEmit('leaderboard:update', buildLeaderboardPayload());
  } catch (err) {
    console.error(`⚠️ Gagal build state setelah ganti game: ${err.message}`);
  }

  return { ok: true, id: activeGame.id };
}

// Dipanggil dari Telegram admin (/game <nama> atau tombol di Daftar Game):
// - gameId "random"/"acak" -> nyalain MODE ACAK (rotasi semua game tiap ronde).
//   Ronde yang lagi jalan tetap lanjut dulu, rotasi mulai pas ronde ini kelar.
// - gameId game tertentu -> pindah ke game itu dan KUNCI di situ (mode 'fixed'):
//   tiap ronde selesai cuma soal baru di game yang sama, nggak pindah-pindah.
// Ganti game lewat VOTE penonton (vote-controller) sengaja nggak lewat sini,
// jadi nggak ngubah mode.
app.post('/api/switch-game', async (req, res) => {
  const requested = String(req.body.gameId || '').trim().toLowerCase();

  if (RANDOM_MODE_ALIASES.includes(requested)) {
    const changed = setGameMode(GAME_MODE_RANDOM);
    return res.json({ ok: true, id: activeGame.id, mode: gameMode, modeChanged: changed, unchanged: !changed });
  }

  const result = await performSwitchGame(req.body.gameId);
  if (result.ok) {
    result.modeChanged = setGameMode(GAME_MODE_FIXED);
    result.mode = gameMode;
  }
  const status = result.status || 200;
  delete result.status;
  res.status(status).json(result);
});

app.get('/api/grid', (req, res) => res.json(activeGame.buildStatePayload()));

app.post('/api/answer', (req, res) => {
  // Tiap game module yang nentuin sendiri gimana cara validasi jawabannya
  // (TTS: cocokin number+direction+answer, Sambung Kata: cocokin 1 kata aja, dst).
  // server.js nggak perlu tau detail internal game.
  const result = activeGame.handleAnswer(req.body);

  if (!result.ok) {
    return res.json(result);
  }

  addScore(req.body.player, result.points || 0);

  // Cek level unlock setelah score update
  const newUnlocked = checkLevelUnlock();
  if (newUnlocked.length > 0) {
    newUnlocked.forEach(level => {
      const msg = level === 2 
        ? '🎉 Level 2 terbuka! Grid 10x10 + diagonal unlocked (high score ≥300)'
        : '🔥 Level 3 terbuka! Grid 12x12 unlocked (high score ≥500)';
      safeEmit('level:unlock', { level, message: msg });
      console.log(`🔓 Level ${level} unlocked (high score: ${getHighestScore()})`);
    });
  }

  const newAvatarEmoji = assignAvatarIfNeeded(req.body.player);
  if (newAvatarEmoji) {
    safeEmit('avatar:spawn', { player: req.body.player || 'Anonim', emoji: newAvatarEmoji });
  }

  safeEmit('update', activeGame.buildStatePayload());
  safeEmit('leaderboard:update', buildLeaderboardPayload());
  safeEmit('answer:correct', {
    player: req.body.player || 'Anonim',
    points: result.points || 0,
    ...(result.meta || {})
  });

  // Catatan: dulu di sini ada pre-generate soal baru pas 50% jalan buat
  // mempercepat transisi ronde. Sekarang nggak dipakai lagi karena ronde
  // berikutnya PASTI di game yang berbeda (rotasi acak) -- pre-generate
  // buat game yang lagi aktif jadi kerjaan sia-sia (AI-nya nggak dipakai).

  if (activeGame.isComplete()) {
    handleRoundCompleted();
  }

  return res.json(result);
});

// Dipanggil oleh tiktok-connector.js buat lapor status koneksi ke TikTok Live
app.post('/api/live-status', (req, res) => {
  const { active, username, error } = req.body;
  const isNewSessionStart = !!active && !liveStatus.active; // transisi offline -> online = sesi baru
  liveStatus = { active: !!active, username: username || null, error: error || null, updatedAt: Date.now() };
  safeEmit('live:status', liveStatus);
  if (isNewSessionStart) resetSessionAvatars();
  res.json({ ok: true });
});

app.get('/api/live-status', (req, res) => res.json(liveStatus));

// Dipanggil oleh telegram-bot.js (testing manual) atau nanti tiktok-connector.js
// (pas udah live TikTok beneran) SETIAP ada komentar masuk dari viewer --
// apapun isinya, entah itu jawaban benar, salah, atau cuma chat biasa.
// Beda sama /api/answer yang cuma jalan kalau jawabannya valid.
app.post('/api/comment', (req, res) => {
  const player = req.body.player || 'Anonim';
  const text = (req.body.text || '').toString().slice(0, 120); // batasin panjang biar gak kepanjangan di layar

  // Viewer yang baru pertama kali komen (belum pernah dapet poin) juga
  // langsung dikasih avatar, biar keliatan di layar walau belum jawab benar.
  const newAvatarEmoji = assignAvatarIfNeeded(player);
  if (newAvatarEmoji) {
    safeEmit('avatar:spawn', { player, emoji: newAvatarEmoji });
  }

  safeEmit('chat:comment', { player, text });
  res.json({ ok: true });
});

app.post('/api/reset', (req, res) => {
  activeGame.reset();
  safeEmit('update', activeGame.buildStatePayload());
  res.json({ ok: true });
});

app.post('/api/reset-leaderboard', (req, res) => {
  if (!leaderboard[GLOBAL_LB_KEY]) {
    return res.json({ ok: true, message: 'Leaderboard sudah kosong' });
  }
  
  leaderboard[GLOBAL_LB_KEY] = {};
  saveLeaderboard();
  unlockedLevels = { 2: false, 3: false }; // Reset level unlock juga
  
  safeEmit('leaderboard:update', buildLeaderboardPayload());
  console.log('🗑️ Leaderboard gabungan direset');
  res.json({ ok: true });
});

app.get('/api/bank-stats', (req, res) => {
  if (activeGame && activeGame.getBankStats) {
    res.json({ ok: true, stats: activeGame.getBankStats() });
  } else {
    res.json({ ok: false, error: 'Game aktif tidak mendukung fitur bank soal' });
  }
});

app.post('/api/bank-reset-cycle', (req, res) => {
  if (activeGame && activeGame.resetBankCycle) {
    activeGame.resetBankCycle();
    res.json({ ok: true });
  } else {
    res.json({ ok: false, error: 'Game aktif tidak mendukung fitur bank soal' });
  }
});

// Logic inti skip soal, dipisah dari route Express biar bisa dipanggil
// juga oleh vote-controller.js (hasil vote "skip" penonton).
async function performForceNext(fallbackSource = 'skip') {
  if (!activeGame || !activeGame.onComplete) {
    return { ok: false, error: 'Game aktif tidak mendukung fitur skip' };
  }

  try {
    const level = getRandomLevel();
    // Memaksa game generate/ambil puzzle baru saat ini juga
    const result = await activeGame.onComplete(level);

    if (!result || result.success === false) {
      return { ok: false, error: result ? result.error : 'Gagal skip soal' };
    }

    safeEmit('update', activeGame.buildStatePayload());
    safeEmit('puzzle:new', {
      clues: activeGame.buildClueList ? activeGame.buildClueList() : null,
      source: result.source || fallbackSource,
      level: result.level
    });

    // Broadcast ulang sekali lagi buat mastiin UI ke-refresh
    setTimeout(() => {
      safeEmit('update', activeGame.buildStatePayload());
    }, 500);

    return { ok: true, source: result.source };
  } catch (err) {
    console.error('Error force next:', err);
    return { ok: false, error: 'Internal error saat skip' };
  }
}

// Endpoint untuk skip/force next question (dipanggil Telegram admin)
app.post('/api/force-next', async (req, res) => {
  const result = await performForceNext();
  res.json(result);
});

// Daftar game yang boleh dipilih lewat overlay vote "ganti". Sengaja
// cuma yang generatenya cepat/lokal dulu -- cari-kata masih pakai AI
// generator yang belum stabil buat dipanggil mendadak lewat vote.
const VOTABLE_GAMES = [
  { num: 1, id: 'family100', label: 'Family 100' },
  { num: 2, id: 'sambung-kata', label: 'Sambung Kata' },
  { num: 3, id: 'susun-kata-acak', label: 'Susun Kata Acak' }
];

const voteController = createVoteController({
  safeEmit,
  performSwitchGame,
  performForceNext,
  performReveal,
  votableGames: VOTABLE_GAMES
});

// Dipanggil tiktok-connector.js (dan telegram-player-bot.js buat testing)
// untuk SETIAP komentar masuk, di luar/sebelum alur parseComment biasa.
// Vote-controller yang nentuin apakah komentarnya relevan ("ganti"/"skip"/
// angka pilihan game) atau bukan -- kalau bukan, gak ngaruh apa-apa ke
// game yang lagi jalan.
app.post('/api/vote-comment', async (req, res) => {
  const { text, player } = req.body;
  try {
    const result = await voteController.handleVoteComment(text, player);
    res.json(result);
  } catch (err) {
    console.error('❌ Error di /api/vote-comment:', err.message);
    res.json({ handled: false });
  }
});

// Logic inti buka jawaban acak ("nyerah"), dipisah dari route Express biar
// bisa dipanggil juga oleh vote-controller.js (hasil vote "nyerah" penonton).
// Sengaja TIDAK manggil addScore -- buka paksa gak boleh nambah skor siapa-siapa.
async function performReveal() {
  if (!activeGame || !activeGame.revealRandomAnswer) {
    return { ok: false, error: 'Game aktif tidak mendukung fitur nyerah/buka jawaban' };
  }

  const result = activeGame.revealRandomAnswer();
  if (!result.ok) {
    return { ok: false, error: result.msg || 'Gagal membuka jawaban' };
  }

  safeEmit('update', activeGame.buildStatePayload());
  safeEmit('answer:revealed', result.meta || {});

  if (activeGame.isComplete()) {
    await handleRoundCompleted();
  }

  return { ok: true, meta: result.meta };
}

// Endpoint untuk buka jawaban acak (dipanggil Telegram admin buat testing)
app.post('/api/reveal', async (req, res) => {
  const result = await performReveal();
  res.json(result);
});

io.on('connection', (socket) => {
  console.log('🔌 Client connected');
  try {
    const statePayload = activeGame.buildStatePayload();
    console.log('✓ buildStatePayload() OK, keys:', Object.keys(statePayload));
    safeSocketEmit(socket, 'update', statePayload);
  } catch (err) {
    console.error('❌ Error buildStatePayload():', err.message);
  }
  
  try {
    const lbPayload = buildLeaderboardPayload();
    console.log('✓ buildLeaderboardPayload() OK, length:', lbPayload.length);
    safeSocketEmit(socket, 'leaderboard:update', lbPayload);
  } catch (err) {
    console.error('❌ Error buildLeaderboardPayload():', err.message);
  }
  
  safeSocketEmit(socket, 'live:status', liveStatus);
  safeSocketEmit(socket, 'avatar:sync', Object.entries(sessionAvatars).map(([player, data]) => ({ player, emoji: data.emoji })));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server jalan (game aktif: ${activeGame.id}, mode: ${gameMode}) di port ${PORT}`);
});