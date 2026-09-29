// public/shared/vote-overlay.js
//
// Dipasang di frontend game yang ikut sistem "penonton kontrol game"
// (family100, sambung-kata). Butuh variabel global `socket` (dari
// `const socket = io();` yang dideklarasikan SEBELUM script ini di-include
// di index.html masing-masing game).
//
// Nampilin 2 hal:
// 1. Badge kecil pojok layar pas ada yang lagi ngumpulin komen "ganti"/"skip"
//    (jumlah + countdown detik).
// 2. Overlay penuh layar buat pilihan game, pas komen "ganti" udah nyampe
//    10x dalam 10 detik.

(function () {
  const GAME_LABELS = {
    family100: 'Family 100',
    'sambung-kata': 'Sambung Kata',
    'susun-kata-acak': 'Susun Kata Acak'
  };

  const style = document.createElement('style');
  style.textContent = `
    #voteBadge {
      position: fixed; top: 2vh; left: 50%; transform: translateX(-50%);
      z-index: 9998;
      background: rgba(20, 16, 31, 0.92);
      border: 3px solid #f5b942;
      border-radius: 999px;
      padding: 12px 28px;
      display: none;
      align-items: center; gap: 14px;
      font-family: 'Baloo 2', 'Inter', sans-serif;
      color: #f5f3fb;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    #voteBadge.show { display: flex; }
    /* Font digedein + text-shadow biar tetep kebaca walau sinyal live jelek/gambar blur/kompresi berat */
    #voteBadge .vb-label { font-weight: 800; font-size: clamp(18px, 2.6vw, 26px); color: #f5b942; text-transform: uppercase; letter-spacing: 0.5px; text-shadow: 0 2px 6px rgba(0,0,0,0.6); }
    #voteBadge .vb-count { font-weight: 700; font-size: clamp(18px, 2.6vw, 26px); text-shadow: 0 2px 6px rgba(0,0,0,0.6); }
    #voteBadge .vb-timer { font-weight: 700; font-size: clamp(18px, 2.6vw, 26px); color: #ff8a65; min-width: 40px; text-align: right; text-shadow: 0 2px 6px rgba(0,0,0,0.6); }

    #gameSelectOverlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(10, 8, 18, 0.88);
      display: none;
      flex-direction: column; align-items: center; justify-content: center;
      gap: 3vh;
      font-family: 'Baloo 2', 'Inter', sans-serif;
      color: #f5f3fb;
      text-align: center;
    }
    #gameSelectOverlay.show { display: flex; }
    /* Semua font di overlay digedein + text-shadow biar tetep kebaca walau sinyal live jelek/gambar blur/kompresi berat */
    #gameSelectOverlay .gs-title { font-size: clamp(26px, 4.5vw, 38px); font-weight: 800; color: #f5b942; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
    #gameSelectOverlay .gs-sub { font-size: clamp(16px, 2.4vw, 20px); color: #cfc9e6; text-shadow: 0 2px 6px rgba(0,0,0,0.7); }
    #gameSelectOverlay .gs-timer { font-size: clamp(32px, 5.5vw, 48px); font-weight: 800; color: #ff8a65; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
    #gameSelectOverlay .gs-options { display: flex; gap: 4vw; flex-wrap: wrap; justify-content: center; }
    #gameSelectOverlay .gs-option {
      background: #1f1a33; border: 3px solid #3a3360; border-radius: 16px;
      padding: 3vh 4vw; min-width: 160px;
      display: flex; flex-direction: column; gap: 1vh; align-items: center;
      transition: border-color 0.2s, transform 0.2s;
    }
    #gameSelectOverlay .gs-option.leading { border-color: #f5b942; transform: scale(1.04); }
    #gameSelectOverlay .gs-num {
      width: 52px; height: 52px; border-radius: 50%;
      background: #8b6ef5; color: #fff; font-weight: 800; font-size: 24px;
      display: flex; align-items: center; justify-content: center;
      text-shadow: 0 2px 4px rgba(0,0,0,0.6);
    }
    #gameSelectOverlay .gs-name { font-weight: 700; font-size: clamp(18px, 2.8vw, 22px); text-shadow: 0 2px 6px rgba(0,0,0,0.7); }
    #gameSelectOverlay .gs-votes { font-weight: 800; font-size: clamp(22px, 3.4vw, 30px); color: #f5b942; text-shadow: 0 2px 6px rgba(0,0,0,0.7); }
    #gameSelectOverlay .gs-result {
      font-size: clamp(20px, 3vw, 26px); font-weight: 800; color: #f5b942;
      text-shadow: 0 2px 8px rgba(0,0,0,0.7);
      display: none;
    }
  `;
  document.head.appendChild(style);

  // ---------- Badge ganti/skip ----------
  const badge = document.createElement('div');
  badge.id = 'voteBadge';
  badge.innerHTML = `
    <span class="vb-label"></span>
    <span class="vb-count"></span>
    <span class="vb-timer"></span>
  `;
  document.body.appendChild(badge);
  const badgeLabel = badge.querySelector('.vb-label');
  const badgeCount = badge.querySelector('.vb-count');
  const badgeTimer = badge.querySelector('.vb-timer');

  const BADGE_LABELS = {
    ganti: '🔀 Ganti Game',
    skip: '⏭️ Skip',
    nyerah: '🏳️ Nyerah'
  };

  function showBadge(type, count, threshold, remainingMs) {
    badgeLabel.textContent = BADGE_LABELS[type] || type;
    badgeCount.textContent = `${count}/${threshold}`;
    badgeTimer.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    badge.classList.add('show');
  }

  function hideBadge() {
    badge.classList.remove('show');
  }

  // ---------- Overlay pilihan game ----------
  const overlay = document.createElement('div');
  overlay.id = 'gameSelectOverlay';
  overlay.innerHTML = `
    <div class="gs-title">🗳️ PENONTON PILIH GAME!</div>
    <div class="gs-sub">Ketik angka di komentar buat vote</div>
    <div class="gs-timer" id="gsTimer">30s</div>
    <div class="gs-options" id="gsOptions"></div>
    <div class="gs-result" id="gsResult"></div>
  `;
  document.body.appendChild(overlay);
  const gsTimer = overlay.querySelector('#gsTimer');
  const gsOptions = overlay.querySelector('#gsOptions');
  const gsResult = overlay.querySelector('#gsResult');

  let currentOptions = [];

  function renderOptions(votes) {
    const maxVotes = Math.max(0, ...Object.values(votes || {}));
    gsOptions.innerHTML = currentOptions.map(opt => {
      const v = (votes && votes[opt.num]) || 0;
      const leading = maxVotes > 0 && v === maxVotes;
      return `
        <div class="gs-option${leading ? ' leading' : ''}">
          <div class="gs-num">${opt.num}</div>
          <div class="gs-name">${opt.label || GAME_LABELS[opt.id] || opt.id}</div>
          <div class="gs-votes">${v} suara</div>
        </div>
      `;
    }).join('');
  }

  socket.on('votecount:tick', ({ type, count, threshold, remainingMs }) => {
    showBadge(type, count, threshold, remainingMs);
  });

  socket.on('votecount:reset', () => {
    hideBadge();
  });

  socket.on('votecount:triggered', () => {
    hideBadge();
  });

  socket.on('gameselect:start', ({ options, durationMs }) => {
    currentOptions = options || [];
    gsResult.style.display = 'none';
    gsOptions.style.display = 'flex';
    gsTimer.style.display = 'block';
    renderOptions({});
    gsTimer.textContent = `${Math.ceil(durationMs / 1000)}s`;
    overlay.classList.add('show');
  });

  socket.on('gameselect:tick', ({ votes, remainingMs }) => {
    renderOptions(votes);
    gsTimer.textContent = `${Math.ceil(remainingMs / 1000)}s`;
  });

  socket.on('gameselect:vote', ({ votes }) => {
    renderOptions(votes);
  });

  socket.on('gameselect:end', ({ result, winner }) => {
    gsOptions.style.display = 'none';
    gsTimer.style.display = 'none';
    gsResult.style.display = 'block';
    if (result === 'win') {
      const opt = currentOptions.find(o => o.id === winner);
      gsResult.textContent = `✅ ${opt ? (opt.label || GAME_LABELS[winner] || winner) : winner} menang! Mengganti game...`;
    } else {
      gsResult.textContent = '❌ Vote gagal, kembali ke game sebelumnya.';
    }
    setTimeout(() => {
      overlay.classList.remove('show');
    }, 2500);
  });
})();