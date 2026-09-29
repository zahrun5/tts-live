# Kontrak Game Module

Tiap folder di `games/<nama-game>/index.js` WAJIB export fungsi-fungsi ini
biar `server.js` dan `tiktok-connector.js` bisa pakai game apapun tanpa
tau detail internalnya:

```js
module.exports = {
  id: 'nama-game',           // string, harus sama dengan key di game-registry.js

  init(),                     // (sync) load state awal / soal pertama saat server start

  buildStatePayload(),        // (sync) -> object yang dikirim ke client lewat event 'update'
                               // ini yang dipakai frontend buat render grid/tampilan

  buildClueList(),             // (sync, OPSIONAL) -> daftar clue/soal, kalau game-nya butuh
                               // (TTS pakai ini, Sambung Kata mungkin nggak perlu)

  handleAnswer({ number, answer, direction, player }),
                               // (sync) validasi 1 jawaban masuk, return:
                               // { ok: true, msg, points, meta } kalau benar
                               // { ok: false, msg } kalau salah/nomor nggak ada/dsb

  isComplete(),                // (sync) -> boolean, true kalau ronde ini udah selesai semua

  onComplete(),                // (async) generate ronde/soal berikutnya,
                               // return { success: true, source } atau { success: false, error }

  reset(),                     // (sync) reset ronde ke kondisi kosong (dipanggil /api/reset)

  parseComment(text),          // (async) khusus dipakai tiktok-connector.js buat parsing
                               // komentar mentah jadi payload buat handleAnswer(),
                               // return null kalau nggak bisa diparsing

  setBroadcaster(fn),          // (sync, OPSIONAL) cuma buat game yang punya perubahan state
                               // DI LUAR siklus request /api/answer biasa -- misal Susun Kata
                               // Acak yang ganti slot sendiri lewat setTimeout abis cooldown.
                               // server.js manggil ini sekali abis init()/switch-game, ngasih
                               // fungsi `() => safeEmit('update', buildStatePayload())`.
                               // Game yang nggak butuh nggak perlu implement ini sama sekali.
};
```

## Kenapa dibikin kontrak kayak gini

- `server.js` cuma manggil `activeGame.xxx()`, nggak pernah tau isi logic
  TTS atau Sambung Kata secara langsung.
- `tiktok-connector.js` juga sama — tinggal panggil `activeGame.parseComment(text)`,
  jadi tiap game bebas punya format komentar sendiri (TTS: "4.gas",
  Sambung Kata: cukup 1 kata polos).
- Nambah game baru = bikin folder baru + implement kontrak ini +
  daftarin di `game-registry.js`. Nggak perlu sentuh `server.js` sama sekali.
