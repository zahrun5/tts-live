// game-switch-watcher.js
// Dipasang di SEMUA halaman game (tts, sambung-kata, cari-kata, trivia,
// family100, susun-kata-acak, susun-kalimat). Tiap game punya HTML/CSS/JS
// yang beda total, jadi pas server ganti activeGame (rotasi acak tiap
// ronde selesai, atau switch manual dari Telegram), halaman yang lagi
// kebuka HARUS reload buat narik file game yang baru -- listener biasa
// ke event 'update' aja nggak cukup karena strukturnya beda.
//
// Butuh variabel global `socket` (dari `const socket = io()`) udah ada
// SEBELUM script ini dimuat.
(function () {
  if (typeof socket === 'undefined' || !socket || typeof socket.on !== 'function') {
    console.warn('⚠️ game-switch-watcher: variabel `socket` belum ada, watcher nggak aktif.');
    return;
  }

  socket.on('game:switched', function (payload) {
    var nextId = payload && payload.gameId;
    console.log('🔀 Game aktif berganti ke "' + nextId + '", reload halaman...');
    // Delay dikit biar log kekirim dan nggak reload di tengah animasi lain.
    setTimeout(function () {
      window.location.reload();
    }, 300);
  });
})();
