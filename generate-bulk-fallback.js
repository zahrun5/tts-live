const fs = require('fs');
const path = require('path');

const FALLBACK_DIR = path.join(__dirname, 'games/family100/fallback');
const MAX_PER_FILE = 100;

// Data untuk variasi pertanyaan
const data = [
  { q: "Menurutmu, apa alasan klasik orang pura-pura tidur?", ans: ["MALAS DISURUH", "DITAGIH HUTANG", "MENGHINDAR", "TIDAK MAU MAKAN", "MALU", "NGAJU", "MINTA UANG", "MARAHAN", "TAKUT DIMARAHI", "GAK MAU MANDI", "MENGHINDARI TAMU", "GAK MAU KERJA", "NUNGGU DIAJAK", "BANYAK PIKIRAN", "CAPEK"] },
  { q: "Apa yang biasanya kamu lakukan jika lampu mati malam-malam?", ans: ["CARI LILIN", "MAIN HP", "TIDUR", "CARI SENTER", "NYALAIN FLASHLIGHT", "TAKUT", "KELUAR RUMAH", "KIPAS KIPAS", "PANIK", "TELEPON TEMAN", "BERDOA", "MARAH MARAH", "DUDUK DIAM", "CARI NYAMUK", "NANGIS"] },
  { q: "Benda apa yang paling sering hilang atau terselip di dalam kamar?", ans: ["REMOT AC", "JEPIT RAMBUT", "KAOS KAKI", "KUNCI MOTOR", "UANG RECEH", "EARPHONE", "DOMPET", "FLASHDISK", "IKAT RAMBUT", "CHARGER HP", "KOREK API", "GUNTING KUKU", "SISIR", "KACAMATA", "JAM TANGAN"] },
  { q: "Bagaimana reaksi orang ketika kepergok ngupil di tempat umum?", ans: ["PURA PURA GARUK", "MALU", "SALAH TINGTING", "LANGSUNG BUANG", "KETAWA KAKU", "MELENGOS", "NUNDUK", "PURA PURA BERSIN", "BUANG MUKA", "CUCI TANGAN", "TUTUP HIDUNG", "LARI", "SENYUM SENYUM", "MINTA MAAF", "KAGET"] },
  { q: "Kalau kamu jadi miliarder mendadak, apa yang pertama kali kamu beli?", ans: ["RUMAH MEWAH", "MOBIL SPORT", "HP BARU", "TANAH", "EMAS", "SAHAM", "PULAU", "TAS BRANDED", "PERHIASAN", "LAPTOP", "TIKET LIBURAN", "APARTEMEN", "KAPAL PESIAR", "PESAWAT PRIBADI", "MAKANAN ENAK"] },
  { q: "Apa alasan orang telat balas chat padahal lagi online?", ans: ["MALAS BALAS", "BINGUNG JAWAB", "LAGI MAIN GAME", "NONTON FILM", "LUPA", "CHAT TENGGELAM", "MENGHINDAR", "MARAH", "LAGI MAKAN", "BACA DOANG", "KASIH PELAJARAN", "NUNGGU MOOD", "SIBUK KERJA", "LAGI DI JALAN", "TIDUR"] },
  { q: "Hal apa yang paling ditakuti oleh mahasiswa tingkat akhir?", ans: ["DOSEN PEMBIMBING", "SKRIPSI", "REVISI", "SIDANG", "PERTANYAAN KAPAN LULUS", "UANG KULIAH", "NILAI JELEK", "DO", "NGGAK LULUS", "PERTANYAAN KAPAN NIKAH", "SUSAH CARI KERJA", "IPK TURUN", "JUDUL DITOLAK", "LAPTOP RUSAK", "TEMAN LULUS DULUAN"] },
  { q: "Apa yang biasanya terlintas di pikiran saat tahu kuota internet habis?", ans: ["CARI WIFI", "BINGUNG", "MINTA TETHERING", "BELI KUOTA", "KESAL", "PANIK", "BOSAN", "MATI GAYA", "TIDUR SAJA", "MAU NANGIS", "PINJAM HP TEMAN", "CEK SISA PULSA", "MARAH KE PROVIDER", "KELUAR RUMAH", "BACA BUKU"] },
  { q: "Jika kamu terdampar di pulau tak berpenghuni, apa yang paling kamu cari?", ans: ["AIR MINUM", "MAKANAN", "TEMPAT BERLINDUNG", "API", "KAPAL LEWAT", "SINYAL HP", "TEMAN", "SENJATA", "ALAT PANCING", "BAJU GANTI", "PETA", "OBAT", "KAYU BAKAR", "KELAPA", "GUA"] },
  { q: "Menurutmu, apa kebohongan yang paling sering dikatakan oleh pedagang?", ans: ["BARU DATANG", "HARGA PAS", "MODALNYA SEGINI", "NUNGGU KEMBALIAN", "SUDAH MURAH", "TINGGAL SATU", "GAK AMBIL UNTUNG", "ASLI", "AWET", "BISA DITUKAR", "RUGI SAYA", "BANYAK YANG CARI", "BARANG BAGUS", "BESOK HARGA NAIK", "BELUM LAKU"] },
  { q: "Apa ciri-ciri orang yang sedang jatuh cinta diam-diam?", ans: ["SALAH TINGTING", "SERING SENYUM", "CURI PANDANG", "CARI PERHATIAN", "STALKING SOSMED", "GUGUP", "KETAWA TERUS", "JADI WANGI", "DANDAN MAKSIMAL", "SUSAH TIDUR", "TIBA TIBA RAJIN", "NANYA NANYA TEMAN", "BALAS CHAT CEPAT", "BAPERAN", "MELAMUN"] },
  { q: "Hal apa yang paling sering dilakukan saat terjebak macet?", ans: ["MAIN HP", "DENGAR MUSIK", "MARAH MARAH", "NGEMIL", "TIDUR", "NONTON VIDEO", "NYANYI", "TELEPON TEMAN", "BUNYIKAN KLAKSON", "BACA BERITA", "CEK MAPS", "MEROKOK", "DANDAN", "MAKAN", "BENGONG"] },
  { q: "Seandainya kamu kembali ke masa lalu, apa yang ingin kamu ubah?", ans: ["KESALAHAN", "PILIHAN JURUSAN", "MANTAN PACAR", "BELI BITCOIN", "LEBIH RAJIN BELAJAR", "NABUNG", "PILIHAN KERJA", "JAGA KESEHATAN", "TIDAK NAKAL", "PILIH TEMAN", "BELI TANAH", "MINTA MAAF", "CEGAH KECELAKAAN", "LEBIH BANYAK MAIN", "NEMBAK GEBETAN"] },
  { q: "Apa alasan klasik yang dipakai saat bolos sekolah atau kerja?", ans: ["SAKIT", "BAN BOCOR", "MACET TOTA", "KEHUJANAN", "KUNJUNGAN KELUARGA", "ADA ACARA", "MOTOR MOGOK", "BANJIR", "KESIANGAN", "NUNGGU PAKET", "MENGANTAR ORANG TUA", "RUMAH KEBANJIRAN", "KETINGGALAN KERETA", "KECELAKAAN KECIL", "HEWAN PELIHARAAN SAKIT"] },
  { q: "Jika kamu diberi kekuatan super, apa yang kamu pilih?", ans: ["TERBANG", "BACA PIKIRAN", "MENGHILANG", "TELEPORTASI", "KEBAL", "SUPER KUAT", "KAYA MENDADAK", "KENDALIKAN WAKTU", "CEPAT KILAT", "BISA SEMBUHIN ORANG", "AWET MUDA", "PAHAM SEMUA BAHASA", "BERNAFAS DI AIR", "MENGELUARKAN API", "PINTAR INSTAN"] }
];

function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

// Generate duplikat agar berjumlah 150 soal (tapi dengan shuffle jawaban)
const allQuestions = [];
for (let i = 0; i < 10; i++) {
  data.forEach(item => {
    // Sedikit variasi string
    let suffix = i === 0 ? "" : ` (Bagian ${i+1})`;
    allQuestions.push({
      question: item.q.replace('?', suffix + '?'),
      answers: shuffle([...item.ans]) // Jawaban di-shuffle biar bobotnya beda
    });
  });
}

// Write to files
let fileIndex = 2; // Mulai dari bank-002.json (karena bank-001 udah dipakai worker)
for (let i = 0; i < allQuestions.length; i += MAX_PER_FILE) {
  const chunk = allQuestions.slice(i, i + MAX_PER_FILE);
  const fileName = `bank-${String(fileIndex).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(FALLBACK_DIR, fileName), JSON.stringify(chunk, null, 2), 'utf8');
  console.log(`Created ${fileName} with ${chunk.length} questions`);
  fileIndex++;
}

console.log(`Total Generated: ${allQuestions.length} questions.`);
