// vote-controller.js
//
// Sistem "penonton kontrol game" lewat komentar:
// - Komen "ganti" 10x dalam 30 detik (window RESET tiap ada komen baru,
//   bukan window tetap) -> munculin overlay pilihan game.
// - Komen "skip" 10x dalam 30 detik (mekanisme sama) -> langsung skip
//   ke soal berikutnya di game yang lagi aktif (panggil performForceNext).
// - Komen "nyerah" 10x dalam 30 detik (mekanisme sama) -> buka 1 jawaban
//   acak yang belum ketemu di game yang lagi aktif (panggil performReveal),
//   TANPA nambah skor ke siapa-siapa.
// - Overlay pilihan game nampilin 2 opsi (Family 100 / Sambung Kata),
//   jalan 30 detik. Penonton komen angka (1/2) buat vote. Angka pertama
//   yang nyampe 10 vote LANGSUNG menang & ganti game.
// - Kalau 30 detik habis dan belum ada angka yang nyampe 10 vote
//   (termasuk kalau 0 vote sama sekali) -> overlay ditutup, GAGAL,
//   balik ke game yang sedang berjalan (tidak ada switch).
//
// Modul ini sengaja gak tau apa-apa soal Express/socket.io/TikTok --
// cuma nerima beberapa fungsi dari server.js (safeEmit, performSwitchGame,
// performForceNext, performReveal) + daftar game yang boleh divoting.

const VOTE_THRESHOLD = 10;
const GANTI_SKIP_WINDOW_MS = 30 * 1000;
const GAMESELECT_DURATION_MS = 30 * 1000;
const TICK_MS = 1000;

function createVoteController({ safeEmit, performSwitchGame, performForceNext, performReveal, votableGames }) {
  // votableGames contoh: [{ num: 1, id: 'family100', label: 'Family 100' }, { num: 2, id: 'sambung-kata', label: 'Sambung Kata' }]

  const gantiSkip = {
    ganti: { count: 0, deadline: null, tickId: null },
    skip: { count: 0, deadline: null, tickId: null },
    nyerah: { count: 0, deadline: null, tickId: null }
  };

  let gameSelect = null; // { votes: {1:0,2:0}, deadline, tickId }

  function clearGantiSkip(type) {
    const s = gantiSkip[type];
    if (s.tickId) clearInterval(s.tickId);
    s.count = 0;
    s.deadline = null;
    s.tickId = null;
  }

  function emitGantiSkipTick(type) {
    const s = gantiSkip[type];
    const remainingMs = Math.max(0, s.deadline - Date.now());
    safeEmit('votecount:tick', { type, count: s.count, threshold: VOTE_THRESHOLD, remainingMs });

    if (remainingMs <= 0) {
      clearGantiSkip(type);
      safeEmit('votecount:reset', { type, reason: 'timeout' });
    }
  }

  async function bumpGantiSkip(type) {
    const s = gantiSkip[type];
    s.count += 1;
    s.deadline = Date.now() + GANTI_SKIP_WINDOW_MS; // reset window tiap komen baru masuk

    if (s.tickId) clearInterval(s.tickId);
    // Tick pertama langsung (biar UI kebaca instan), lanjut tiap 1 detik
    emitGantiSkipTickImmediate(type);
    s.tickId = setInterval(() => emitGantiSkipTick(type), TICK_MS);

    if (s.count >= VOTE_THRESHOLD) {
      clearGantiSkip(type);
      safeEmit('votecount:triggered', { type });

      if (type === 'ganti') {
        startGameSelect();
      } else if (type === 'skip') {
        try {
          await performForceNext();
        } catch (err) {
          console.error('❌ vote-controller: gagal eksekusi skip hasil vote:', err.message);
        }
      } else if (type === 'nyerah') {
        try {
          await performReveal();
        } catch (err) {
          console.error('❌ vote-controller: gagal eksekusi nyerah hasil vote:', err.message);
        }
      }
    }
  }

  function emitGantiSkipTickImmediate(type) {
    const s = gantiSkip[type];
    safeEmit('votecount:tick', { type, count: s.count, threshold: VOTE_THRESHOLD, remainingMs: GANTI_SKIP_WINDOW_MS });
  }

  function startGameSelect() {
    if (gameSelect) return; // udah ada overlay jalan, jangan tumpuk

    const votes = {};
    votableGames.forEach(g => { votes[g.num] = 0; });

    gameSelect = {
      votes,
      deadline: Date.now() + GAMESELECT_DURATION_MS
    };

    safeEmit('gameselect:start', {
      options: votableGames,
      durationMs: GAMESELECT_DURATION_MS,
      threshold: VOTE_THRESHOLD
    });

    gameSelect.tickId = setInterval(() => {
      if (!gameSelect) return;
      const remainingMs = Math.max(0, gameSelect.deadline - Date.now());
      safeEmit('gameselect:tick', { votes: gameSelect.votes, remainingMs });

      if (remainingMs <= 0) {
        clearInterval(gameSelect.tickId);
        gameSelect = null;
        safeEmit('gameselect:end', { result: 'timeout', winner: null });
      }
    }, TICK_MS);
  }

  async function handleVoteComment(text, player) {
    const clean = (text || '').toString().trim().toLowerCase();
    if (!clean) return { handled: false };

    // --- Mode: overlay pilihan game lagi aktif, cek vote angka ---
    if (gameSelect && /^[0-9]+$/.test(clean)) {
      const num = Number(clean);
      if (Object.prototype.hasOwnProperty.call(gameSelect.votes, num)) {
        gameSelect.votes[num] += 1;
        safeEmit('gameselect:vote', { num, player, votes: gameSelect.votes });

        if (gameSelect.votes[num] >= VOTE_THRESHOLD) {
          const winner = votableGames.find(g => g.num === num);
          clearInterval(gameSelect.tickId);
          gameSelect = null;
          safeEmit('gameselect:end', { result: 'win', winner: winner.id });
          try {
            await performSwitchGame(winner.id);
          } catch (err) {
            console.error('❌ vote-controller: gagal switch game hasil vote:', err.message);
          }
        }
        return { handled: true };
      }
      // Angka valid tapi bukan salah satu opsi -> abaikan, jangan diteruskan sbg jawaban game
      return { handled: false };
    }

    // --- Komen "ganti" / "skip" / "nyerah" ---
    if (clean === 'ganti') {
      await bumpGantiSkip('ganti');
      return { handled: true };
    }
    if (clean === 'skip') {
      await bumpGantiSkip('skip');
      return { handled: true };
    }
    if (clean === 'nyerah') {
      await bumpGantiSkip('nyerah');
      return { handled: true };
    }

    return { handled: false };
  }

  function getStatus() {
    return {
      ganti: { count: gantiSkip.ganti.count },
      skip: { count: gantiSkip.skip.count },
      nyerah: { count: gantiSkip.nyerah.count },
      gameSelect: gameSelect ? { votes: gameSelect.votes } : null
    };
  }

  return { handleVoteComment, getStatus };
}

module.exports = createVoteController;
