// Daftar semua game yang tersedia di platform ini.
// Tinggal tambah baris baru di sini tiap kali bikin game baru,
// server.js dan tiktok-connector.js otomatis bisa pakai lewat ACTIVE_GAME.
module.exports = {
  tts: require('./tts'),
  'sambung-kata': require('./sambung-kata'),
  'cari-kata': require('./cari-kata'),
  trivia: require('./trivia'),
  family100: require('./family100'),
  'susun-kata-acak': require('./susun-kata-acak'),
  'susun-kalimat': require('./susun-kalimat'),
};
