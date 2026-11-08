# Mint RedCeh — Radar Free Mint Agentic ID

Radar free mint untuk ekosistem **Binance Agentic ID (.ai)** di BNB Chain.
Setiap proyek boleh mengklaim "gratis" di halamannya — Mint RedCeh membenturkan
klaim itu dengan **fakta rantai** yang dibaca langsung dari kontraknya, lalu
mengelompokkan listing ke tiga ember berbukti: **Real**, **Berpotensi**, dan
**Indikasi Fee-Farm**.

## Cara kerja

1. **Penemuan** — kandidat free mint yang lagi tren di ekosistem Agent ID
   (situs resmi proyek, pengumuman resmi). Tidak ada sumber yang dipercaya
   mentah-mentah.
2. **Verifikasi on-chain** (`src/verify.js`) — untuk tiap kontrak, radar membaca
   sendiri dari BNB Chain: nama/simbol, suplai termint vs maks, status
   verifikasi Sourcify, plus probe khusus per proyek (mis. solvabilitas refund
   Agentic Coin: `refundOwed()` vs saldo BNB kontrak). Hasilnya `data/board.json`.
3. **Pembanding** (`src/seeds.js`) — klaim halaman vs fakta rantai, berdampingan,
   dengan sinyal berbukti di tiap kartu (fee tersembunyi per mint, kuota gratis
   yang sudah lewat di rantai, verifikasi yang masih demo, dsb).
4. **Memory** (`src/radar-memory.js`) — setiap putaran cek ditulis ke
   **Walrus Memory** (mainnet, namespace `mintredceh`, dicap checkpoint Sui via
   **Tatum** GraphQL). Kotak **Tanya Radar** menjawab hanya dari memory itu:
   kapan kontrak pertama terlihat, hasil tiap cek, apakah labelnya pernah
   berubah — lengkap dengan blob id sebagai bukti. Tidak ada di memory = radar
   bilang tidak tahu.

## Menjalankan

```bash
npm install
node src/verify.js               # segarkan data/board.json dari rantai
node --env-file=.env server.js   # http://localhost:8787
```

Endpoint: `/` papan · `/api/board` · `/api/status` · `/api/memories` ·
`/api/ask?q=<nama|alamat>` · `POST /api/refresh` (verifikasi ulang) ·
`POST /api/remember` (verifikasi + tulis memory baru). Tanpa kredensial
MemWal di `.env`, memory berjalan dalam mode lokal kering.

## Prinsip

- Baca-saja: radar tidak pernah memint, tidak memindahkan dana, tidak
  menjanjikan nilai.
- Angka fakta selalu dari rantai, bukan dari halaman proyek.
- Label ember adalah penilaian dari bukti yang ditampilkan — bukan vonis.

Dibangun oleh elle untuk Rev.
