# Frontend aplikasi kasir

Next.js + React, terhubung ke backend Go di `../backend`. Data contoh sudah
dihapus dari aplikasi. Login dan registrasi memakai username/password melalui backend Go. Data toko dan
transaksi juga melalui API Go; Supabase digunakan sebagai database PostgreSQL.

## Persiapan database dan backend

1. Database baru: jalankan `../database/schema.sql` terbaru sekali di SQL Editor.
   Lanjutkan dengan `../database/migrations/20261101_tanggal_pendapatan.sql` untuk
   memisahkan tanggal pendapatan dari waktu pencatatan transaksi.
2. Database yang sudah memakai schema versi sebelumnya: jalankan
   `../database/migrations/integrasi_kasir.sql` sekali. Migrasi menambahkan jenis pembayaran,
   snapshot nama produk, serta idempotency key. Jangan jalankan migrasi ini sesudah
   memasang schema terbaru, karena kolomnya sudah tersedia.
3. Jika format nomor struk belum diperbarui, jalankan juga
   `../database/migrations/ubah_format_nomor.sql`.
4. Jika database menggunakan schema lama, jalankan juga
   `../database/migrations/auth_username_password.sql`. Database baru mengikuti langkah 1.
   Registrasi pemilik dilakukan langsung pada frontend dengan username/password.
5. Jalankan backend sesuai README-nya. Untuk frontend lokal default, set:

   ```env
   CORS_ORIGIN=http://localhost:3000
   ```

## Menjalankan frontend

Gunakan Node.js 22 atau 24 dan npm. Proyek menggunakan satu lockfile npm agar
instalasi lokal dan deployment konsisten.

```sh
cd frontend
cp .env.example .env.local
# Isi NEXT_PUBLIC_API_BASE_URL pada .env.local.
npm ci
npm run dev
```

Buka http://localhost:3000. URL API contoh `http://127.0.0.1:8080/api/v1`.
Jangan masukkan password database atau Supabase service-role key ke frontend.

Di Vercel, gunakan **Root Directory: frontend**, install command `npm ci`, build
command `npm run build`. Isi environment URL API dari `.env.example` pada project
settings. URL API harus berupa URL HTTPS backend yang sudah di-host. Set
`CORS_ORIGIN` backend ke origin Vercel/domain produksi secara persis, tanpa slash
penutup. Redeploy frontend sesudah mengubah `NEXT_PUBLIC_*`.

Build menggunakan Webpack; pemeriksaan TypeScript tetap aktif. Aplikasi dapat
dibuild sebelum kredensial diisi, tetapi akan menampilkan petunjuk konfigurasi
sampai URL API tersedia.

### Docker dan VPS satu domain

Frontend memiliki Dockerfile multi-stage berbasis Node.js 24 dan output Next.js
`standalone`. Runtime berjalan sebagai user non-root, tanpa development server.
File `.env.local`, `node_modules`, dan hasil build lokal tidak dikirim ke build Docker.

Jalankan dari root project bersama Caddy, backend, dan PostgreSQL:

```sh
docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml up -d --build --wait
```

Isi `APP_DOMAIN` di `.env.docker` dengan domain yang DNS-nya mengarah ke VPS,
misalnya `toko.example.com`. Buka `https://toko.example.com`; Caddy mengurus HTTPS
dan meneruskan `/api/v1` ke backend. Port frontend 3000 tidak dibuka ke publik.
Panduan DNS, deployment image, backup, dan update ada di
[`../deploy/README.md`](../deploy/README.md#frontend--backend-di-satu-vps-dengan-caddy).

Build Docker memakai `NEXT_PUBLIC_API_BASE_URL=/api/v1`, sehingga image dapat
dipakai pada domain berbeda tanpa rebuild. URL relatif ini memerlukan reverse
proxy Caddy di depannya; akses langsung ke container frontend tidak mem-proxy API.
Untuk image dengan API di domain terpisah, berikan
`--build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api/v1` saat
`docker build`. Mengubah environment saat container start saja tidak mengubah
nilai `NEXT_PUBLIC_*` yang sudah dibundel. Pengembangan lokal melalui `npm run dev`
tetap memakai `.env.local` seperti sebelumnya.

## Menu dan penggunaan

### Tanggal pendapatan dan pembatalan

Pada menu Penjualan, **Tanggal pendapatan (WIB)** menentukan hari pemasukan masuk
Ringkasan Harian. Default hari ini; tanggal sebelumnya boleh dipilih, tanggal
mendatang ditolak. Pilihan tersimpan per tab transaksi dan tetap sama saat retry.
Setelah pembayaran utama selesai, transaksi berikutnya kembali ke hari ini.

Contoh: penjualan dicatat 1 November untuk pendapatan 31 Oktober. Angkanya masuk
ringkasan 31 Oktober, tetapi riwayat, filter riwayat, nomor struk, dan mutasi stok
tetap mengikuti waktu pencatatan sebenarnya. Detail riwayat menampilkan tanggal
pendapatan secara terpisah. Pembelian tidak memakai tanggal pendapatan penjualan.

Pendapatan = penjualan sebelum pembatalan − transaksi dibatalkan. Angka berhasil,
tunai, dan non-tunai sudah mengecualikan pembatalan; tidak dipotong dua kali.
Pembatalan mengurangi pendapatan pada tanggal pendapatan asal, bukan tanggal refund.
Klik **Muat ulang** untuk melihat data terbaru; halaman juga memperbarui data saat
kembali aktif. Laporan tersimpan tetap menjadi snapshot. Jika sumber berubah,
peringatan menyediakan akses ke pendapatan terbaru untuk disimpan sebagai versi baru.

### Registrasi dan login sederhana

Saat belum ada pengguna, halaman awal menampilkan form **Registrasi** dengan dua
field: username dan password. Klik **Daftar & Masuk** untuk langsung masuk sebagai
pemilik. Tidak ada nama, email, konfirmasi email, atau kode setup.

Setelah pengguna pertama dibuat, halaman menjadi form **Masuk** dengan dua field
yang sama. Username 3–50 karakter (huruf, angka, titik, garis bawah, tanda hubung),
password baru minimal 8 karakter dan maksimal 72 byte. Username tidak peka huruf
besar/kecil. Profil lama tetap dipertahankan; tidak perlu menghapus data toko.

Sesi disimpan pada `sessionStorage` browser dan berlaku maksimal 12 jam. Logout
mencabut token pada backend. Sesi hanya berlaku pada tab/browser session tersebut.
Password tidak disimpan pada browser. Akun baru tidak memakai Supabase Auth.

### Operasional kasir

Halaman penjualan menggunakan dua panel mengikuti tampilan kasir awal: keranjang
di kiri, katalog di kanan, dan ringkasan pembayaran tetap di bawah keranjang.
Di desktop, kedua panel menggulir sendiri agar tombol Bayar tetap terlihat.
Menu Pembelian, Data Master, Perangkat, dan Keluar tersedia di tombol **…** pada header.

Alur keyboard: langsung ketik saat tidak mengedit field lain untuk memulai pencarian;
↑/↓ memilih produk, Enter menambahkan hasil yang disorot, Esc mengosongkan pencarian.
F2 memilih teks pencarian, F3 mengedit jumlah barang terakhir/dipilih; pada jumlah,
↑/↓ menambah/mengurangi dan Enter kembali ke pencarian. F4 membuka tunai, F5 QRIS,
F6 debit, F8 membuka/menyelesaikan pembayaran. Pada dialog, uang diterima langsung
terfokus dan ditampilkan dengan pemisah ribuan. Enter menyimpan, Esc kembali;
setelah berhasil, Enter pada tombol Selesai kembali menyiapkan pencarian berikutnya.
Ketikan pada field lain dan shortcut Ctrl/Cmd tidak dialihkan ke pencarian.

- **Penjualan:** cari produk/nama/SKU, scan barcode, jumlah pecahan hingga 3 desimal,
  diskon item dan transaksi, pilih metode aktif, konfirmasi pembayaran, cetak struk.
- **Pembelian (pemilik):** pilih tempat beli/sales, nomor nota, barang, jumlah,
  harga beli aktual, diskon, dan metode yang diizinkan untuk pembelian. Penyimpanan
  langsung menambah stok melalui transaksi backend.
- **Produk:** daftar produk dan stok. Pemilik dapat menambah/mengedit produk,
  menonaktifkannya, mencatat stok awal sekali, serta membuat penyesuaian stok.
- **Riwayat:** halaman penjualan/pembelian, detail, cetak ulang, dan pembatalan
  oleh pemilik dengan alasan. Pembatalan mencatat mutasi pembalik.
- **Data Master (pemilik):** kategori, satuan, tempat beli/sales, metode pembayaran,
  jenis CASH/QRIS/DEBIT/TRANSFER/LAINNYA, tarif, dan flag penggunaan.
- **Perangkat (pemilik):** identitas toko pada struk, printer 58/80 mm, QZ Tray,
  serta pengaturan pembukaan laci setelah cash berhasil.

Mulai dari kategori/satuan → produk → tempat beli/sales bila diperlukan → catat
pembelian stok → penjualan. Stok awal untuk barang yang sudah ada sebelum aplikasi
digunakan, bukan untuk menduplikasi stok pembelian baru.

Frontend menampilkan estimasi menggunakan `decimal.js`, dengan pembulatan yang
sama seperti SQL. Nilai final untuk struk selalu diambil dari respons backend.
Biaya yang ditanggung toko tidak menaikkan tagihan pelanggan. Pembayaran nontunai
masih dikonfirmasi manual; aplikasi belum terhubung ke payment gateway/EDC.

## Scanner, printer, dan laci USB

**Scanner:** atur mode USB HID/keyboard dan suffix Enter. Fokus kolom pencarian
dengan F2, lalu scan. Saat fokus di luar input, burst scan cepat juga ditangani.
Barcode harus cocok persis; angka nol di awal tetap disimpan sebagai teks.
Barcode yang tidak ditemukan tidak menambahkan produk pertama secara otomatis.

**Printer melalui browser:** install driver printer USB pada komputer, pilih mode
dialog browser, lalu pilih printer thermal pada dialog cetak. Pilih lebar 58/80 mm.
Browser tidak dapat mengonfirmasi bahwa kertas benar-benar tercetak.

**Printer ESC/POS melalui QZ Tray:** install driver printer dan
[QZ Tray](https://qz.io/download/) pada komputer kasir. Jalankan QZ, buka Perangkat,
pilih mode QZ, hubungkan, lalu pilih nama printer. Izinkan dialog QZ saat diminta.
Integrasi ini menggunakan request unsigned sehingga dapat meminta persetujuan QZ.
Browser juga dapat meminta izin jaringan lokal untuk menghubungi QZ pada komputer
ini; izinkan untuk domain kasir. Helper resmi QZ LNA dipasang dengan alias `lna`
sesuai nama modul opsional yang dicari QZ Tray 2.3.
Cetak senyap tanpa dialog kepercayaan memerlukan sertifikat dan signing tersendiri;
private key signing tidak boleh diletakkan pada frontend.

**Laci melalui printer:** pulsa ESC/POS dikirim ke printer USB, lalu printer
meneruskan ke port drawer. Sesuaikan pin 2/5 dengan manual perangkat. Opsi otomatis
hanya berjalan setelah backend mengonfirmasi penjualan CASH selesai. Gangguan
printer/laci tidak membatalkan transaksi yang sudah disimpan.

**Laci USB langsung ke komputer:** belum diaktifkan karena vendor/controller dapat
memerlukan perintah USB/HID/serial yang berbeda. Dibutuhkan model perangkat dan
protokolnya. Jangan menganggap pulsa printer akan membuka laci USB langsung.
Implementasi belum diuji pada printer, scanner, atau laci fisik milik pengguna.

Referensi: [QZ raw printing](https://qz.io/docs/what-is-raw-printing),
[signing QZ](https://qz.io/docs/signing),
[dialog cetak browser](https://developer.mozilla.org/en-US/docs/Web/API/Window/print).

## Request ulang dan koneksi putus

Sebelum checkout, aplikasi menyimpan payload dan UUID request di `sessionStorage`
yang dipisah per pengguna/jenis transaksi. Jika koneksi putus, gunakan tombol
**Periksa / lanjutkan transaksi**. Body dan UUID yang sama dikirim ulang; backend
mengembalikan transaksi yang sama tanpa menambah mutasi stok kedua.

Jangan membuat transaksi baru untuk menggantikan transaksi yang belum diketahui
hasilnya. Data pending ini bertahan selama tab/browser session tersedia, bukan
penyimpanan offline permanen. Checkout offline dan sinkronisasi offline belum tersedia.

## Pengujian

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Alternatif jika Google Chrome sudah tersedia:
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

Unit test memeriksa pembulatan, biaya pembayaran, validasi, dan sanitasi struk.
Test browser memeriksa kontrak API dengan respons jaringan yang di-mock khusus
test: registrasi username/password, login, scan, checkout, pembelian, pembatasan menu, dan retry. Test browser
tidak memakai akun Supabase asli atau perangkat USB. Backend memiliki integration
test terpisah terhadap PostgreSQL yang menjalankan skema SQL asli.

### Peringatan stok dan shortcut tambahan

Produk dengan stok nol/negatif tetap dapat dipilih dan dijual. Peringatan muncul pada kartu produk, keranjang, dan konfirmasi pembayaran; saldo stok dapat menjadi negatif setelah transaksi.

- **F9**: kosongkan daftar belanja saat tidak ada dialog pembayaran atau transaksi yang menunggu kepastian.
- **F10**: kirim perintah buka laci, menggunakan pengaturan QZ Tray/printer yang sama dengan tombol Buka Laci.
- Kartu produk aktif memiliki bingkai dan latar biru; gunakan panah atas/bawah lalu Enter untuk menambahkannya.
- Dropdown Produk, Data Master, Pembelian, dan Perangkat dapat dicari. Gunakan Tab untuk menuju dropdown, Enter untuk membuka, ketik pencarian, panah untuk memilih, Enter untuk menerapkan, atau Escape untuk menutup.
- Indikator Next.js disembunyikan melalui `devIndicators: false`. Restart server frontend jika perubahan konfigurasi belum terlihat.

### Lebar panel penjualan

Area kerja mengikuti lebar jendela, termasuk monitor QHD, ultrawide, dan 4K; tidak
lagi dibatasi 1920 px. Header, Penjualan, Pembelian, Produk, Riwayat/Ringkasan,
Data Master, dan Perangkat memakai ruang layar dengan jarak tepi yang konsisten.
Form login dan dialog pembayaran/detail tetap dibatasi agar nyaman dibaca.

Pada layar desktop (minimal 1024 px), geser pembatas antara Daftar Belanja dan Pilih Produk ke kiri/kanan. Lebar disimpan pada browser. Pembatas juga dapat difokuskan dengan Tab lalu diatur memakai panah kiri/kanan; Home/End menuju batas minimum/maksimum. Klik dua kali mengembalikan lebar awal. Pada layar kecil, panel tetap tersusun vertikal.

Jumlah kolom katalog menyesuaikan lebar panel, bukan hanya 2–3 kolom. Saat jendela
diperkecil, kedua panel menjaga lebar minimum; ketika diperbesar lagi, rasio pilihan
kembali dipakai. Keranjang tidak dihapus ketika ukuran berubah. Pada layar tinggi,
halaman produk berikutnya dimuat sampai area katalog cukup terisi dan dapat digulir;
virtualisasi tetap membatasi jumlah kartu yang dipasang di DOM.

Tes browser mencakup viewport 1920×1080, 2560×1440, 3440×1440, dan 3840×2160,
pergantian ukuran, akses produk terakhir, serta regresi layar ponsel/tablet.

Metode awal adalah Tunai jika tersedia dan aktif untuk penjualan, termasuk setelah menyelesaikan transaksi. Tombol Bayar berada selebar bagian bawah Daftar Belanja; ukuran total mengikuti lebar panel.


### Pemuatan master dan tampilan stok

Frontend memakai satu `GET /master-data` tanpa paging. Produk, kategori, satuan, metode pembayaran, dan sumber pembelian disimpan di memori frontend selama sesi halaman aktif. Request serentak digabungkan; menyelesaikan penjualan tidak memuat ulang data master. Pencarian nama/SKU/barcode dilakukan di frontend, termasuk pemeriksaan barcode yang tidak ditemukan.

Perubahan master melalui aplikasi langsung membatalkan cache dan memuat snapshot terbaru. Tab/komputer lain memeriksa `GET /master-data/version` setiap 30 detik saat halaman terlihat, serta saat jendela kembali aktif. Hanya saat versi berubah data lengkap diambil lagi. Muat ulang halaman memulai cache frontend baru; tombol **Muat ulang data** membaca ulang cache backend juga (untuk perubahan langsung melalui SQL Editor).

Saldo dan peringatan stok tidak ditampilkan pada penjualan atau daftar Produk. Stok, stok awal, dan penyesuaian tersedia di **Pembelian**; saldo dimuat saat membuka menu tersebut dan setelah perubahan stok. Penjualan tetap diizinkan meskipun stok nol/negatif. Data master tidak dicampur dengan saldo stok yang sering berubah.

Cache backend berlaku untuk satu proses. Jika kelak memakai beberapa instance backend, invalidasi harus dibagikan antar instance terlebih dahulu.

## Transaksi penjualan dinamis

Penjualan dimulai dengan satu tab. Ikon **+** hanya pada tab terakhir menambah tab baru dan
langsung mengaktifkannya. Tab lama tetap tersedia dan dapat digulir mendatar.
Klik tab atau gunakan **Alt + 1–9** untuk sembilan tab pertama (Option di Mac). Fokus otomatis kembali
ke pencarian agar scanner bisa langsung digunakan. Angka kecil di tab menunjukkan
jumlah jenis produk pada keranjang tersebut.

Keranjang, jumlah barang, metode bayar, uang diterima, referensi, dan pilihan cetak
tersimpan terpisah pada setiap tab. Data disimpan di sessionStorage per akun dan tab browser;
refresh memulihkan seluruh keranjang beserta tab terakhir yang aktif. Ini belum
merupakan keranjang bersama antar komputer. Menutup sesi browser atau menghapus
penyimpanannya dapat menghilangkan draf yang belum dibayar.

Pembayaran dan retry memakai kunci terpisah per tab; tab pertama dan kedua tetap mengenali
request pending dari versi sebelumnya. Dua keranjang dari versi lama tetap
dipertahankan saat memakai fitur tab dinamis. Saat modal pembayaran terbuka, perpindahan
tab dikunci. Pembayaran berhasil hanya membersihkan keranjang yang dibayar.
**Kosongkan** juga hanya memengaruhi tab aktif dan meminta konfirmasi.
Tidak ada perubahan API atau migrasi database untuk fitur ini.

Tombol **×** menutup transaksi. Keranjang berisi barang meminta konfirmasi;
transaksi dengan pembayaran yang sedang berjalan atau belum terkonfirmasi tidak
bisa ditutup. Tab pertama adalah tab utama; tombol tutup selalu disembunyikan pada tab ini,
meskipun ada tab tambahan.
Nama tab selalu diurutkan kembali dari Transaksi 1 mengikuti posisi tab yang
terbuka. Identitas internal tetap terpisah, sehingga retry pembayaran tetap aman
meskipun tab di tengah dihapus. Shortcut Alt + angka mengikuti posisi tab yang
masih terbuka. Keranjang lama dimigrasikan otomatis tanpa menghapus barangnya.

Sesudah pembayaran berstatus SELESAI dikonfirmasi server, tab tambahan yang dibayar
langsung ditutup dan tab utama aktif kembali. Keranjang utama serta tab lain tetap
utuh. Pop-up kembalian dan cetak ulang tetap tersedia sampai tombol Selesai ditekan.
Jika tab utama yang dibayar, tabnya tetap ada dengan keranjang kosong. Gagal simpan
atau timeout tidak menutup tab; retry tetap memakai identitas transaksi semula.
