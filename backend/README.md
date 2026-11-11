# Backend toko kelontong — Go + GORM + PostgreSQL

Backend REST untuk satu toko, dengan pemilik dan kasir. Struktur sengaja dibuat
cukup sederhana untuk dipelajari: HTTP → service → repository/GORM → PostgreSQL.

## Fitur yang tersedia

- Registrasi awal dan login dengan username/password; password di-hash bcrypt.
- Sesi acak berlaku 12 jam, disimpan sebagai hash token dan dapat dicabut saat logout.
- Pemilik dapat menambah dan memperbarui kategori, satuan, produk, sumber pembelian,
  serta metode pembayaran. Pengguna aktif dapat membacanya.
- Penjualan dapat dibuat oleh pemilik/kasir; pembelian hanya oleh pemilik.
- Setiap transaksi memakai satu metode pembayaran, dan selesai dalam satu request.
- Harga jual diambil dari produk di database; harga beli dikirim pemilik.
- Subtotal, diskon, biaya, dan kembalian dihitung di server/database.
- Penjualan mengurangi stok; pembelian menambah stok. Penjualan tetap boleh dilakukan saat stok kurang sehingga saldo dapat negatif.
- Stok awal, penyesuaian stok, dan pembatalan hanya oleh pemilik.
- Pembatalan membuat mutasi pembalik; riwayat transaksi tetap tersimpan.
- Pembatalan pembelian ditolak jika akan membuat stok negatif.
- Nomor struk dan tarif snapshot mengikuti SQL yang sudah dibahas.

Tidak ada endpoint untuk mengubah detail transaksi selesai atau menghapus riwayat.
Kasir boleh melihat riwayat penjualan toko dan data master, tetapi tidak melihat
transaksi pembelian. Pengaturan akun/peran masih dilakukan lewat SQL Editor oleh pemilik.

## Docker lokal dan VPS

Untuk database PostgreSQL sendiri beserta backend Go dalam satu VPS, gunakan
[petunjuk Docker](../deploy/README.md). Compose di root project menyiapkan database,
volume persisten, schema/sequence/trigger, dan backend. Konfigurasi Docker berada
pada `.env.docker`, terpisah dari `backend/.env`. Image backend dapat dibangun di
laptop/CI lalu di-pull oleh VPS. Login baru tidak membutuhkan Supabase.

## Menjalankan aplikasi tanpa Docker untuk backend

1. Install Go **1.26 atau lebih baru** dari https://go.dev/dl/.
2. Jalankan `../database/schema.sql` melalui psql untuk PostgreSQL mandiri baru,
   atau SQL Editor untuk Supabase baru. Docker Compose sudah menjalankannya otomatis.
   Setelah schema, jalankan juga `migrations/20261101_tanggal_pendapatan.sql`.
   Instalasi Docker baru menjalankan migrasi ini otomatis; volume lama harus dimigrasi
   setelah backup sebelum menjalankan backend versi baru.
   Jika database sudah memakai SQL sebelumnya, jangan jalankan schema lagi. Jalankan
   `../database/migrations/ubah_format_nomor.sql` jika format nomor belum diperbarui.
3. Jika database sudah memakai schema lama, jalankan
   `../database/migrations/auth_username_password.sql` untuk menambahkan hash password dan sesi.
   Database baru memakai `schema.sql` dan migrasi tanggal pendapatan pada langkah 2.
   Pada halaman awal frontend, isi username dan password lalu klik **Daftar & Masuk**.
   Pengguna pertama otomatis menjadi pemilik. Nama diisi otomatis dari username;
   tidak ada email, konfirmasi, atau kode setup.
4. Salin `.env.example` ke `.env`, kemudian isi field `DB_*` sesuai database lokal
   atau gunakan `DATABASE_URL` (lebih diutamakan jika diisi).
   `SUPABASE_URL` dan `SUPABASE_ANON_KEY` tidak wajib untuk akun baru.
   Jika memakai Supabase, pilih direct connection atau session pooler
   dari menu **Connect**. Gunakan `sslmode=require` dan URL encode password.
   `PreferSimpleProtocol` juga disetel untuk kompatibilitas transaction pooler.
5. Dari folder `backend`, jalankan:

   ```sh
   go mod download
   go run ./cmd/api
   ```

   Backend otomatis membaca `.env` pada working directory, atau `backend/.env`
   jika dijalankan dari workspace root. Tidak perlu `source .env`. Environment
   dari shell/hosting tetap lebih diutamakan daripada file. Lokasi khusus dapat
   dipilih menggunakan `ENV_FILE=/lokasi/backend/.env`. Quote nilai yang mengandung
   karakter khusus; URL encode karakter khusus pada password connection string.
6. Periksa server:

   ```sh
   curl http://127.0.0.1:8080/healthz
   curl http://127.0.0.1:8080/readyz
   ```

Frontend login melalui `POST /api/v1/auth/login` dengan username/password.
Backend mengembalikan token sesi acak yang dikirim lewat header Bearer untuk API
bisnis. Password tidak disimpan sebagai teks; token sesi di database juga berupa
hash. Logout mencabut sesi tersebut. Sesi berakhir setelah 12 jam.

Registrasi awal hanya dibuka ketika tabel pengguna kosong. Pembuatan akun/peran
lain tetap menjadi kewenangan pemilik. Akun Supabase Auth lama yang sudah memiliki
profil pengguna dapat login memakai username dan password lamanya: bila konfigurasi
Supabase Auth masih tersedia, backend memverifikasi password lama sekali, kemudian
menyimpan hash lokal untuk login berikutnya. Tidak ada email yang perlu diisi di UI.

## TTL cache produk

Set `PRODUCT_CACHE_TTL_SECONDS` di `backend/.env` (proses lokal) atau `.env.docker`
(Docker Compose). Default `3600` detik / **1 jam**; contoh `7200` untuk 2 jam.
Nilai harus bilangan bulat 1–31536000 detik. Setelah mengubahnya, restart proses
atau recreate container API. Backend meneruskan TTL lewat respons katalog agar
cache frontend mengikuti pengaturan yang sama tanpa rebuild frontend.
Mutasi produk, pergantian versi, dan tombol **Muat ulang data** tetap membatalkan
cache sebelum TTL habis. Detail ada di [`docs/API.md`](docs/API.md#master-ringan-dan-katalog-produk).

## Struktur folder

```text
cmd/api/main.go                  # entry point, dependency wiring, shutdown
internal/config/config.go        # membaca dan memvalidasi environment
internal/database/postgres.go    # koneksi GORM dan connection pool
internal/model/models.go         # pemetaan tabel bisnis dan sesi login
internal/repository/store.go     # query pengguna, row lock, agregasi stok
internal/service/validation.go   # validasi uang/jumlah serta subtotal detail
internal/service/transaction.go  # alur penjualan, pembelian, pembatalan, stok
internal/httpapi/                # routing, DTO master, auth, JSON, error
internal/apperror/               # error bisnis yang boleh ditampilkan ke client
docs/BELAJAR_GO.md               # penjelasan kode untuk belajar
docs/API.md                      # endpoint dan contoh request
compose.test.yaml               # PostgreSQL lokal khusus test
```

SQL struktur di `../database/` tetap menjadi sumber skema. Backend **tidak memakai
AutoMigrate** dan tidak membuat skema saat server mulai. Tidak ada salinan DDL kedua
agar model aplikasi dan SQL mudah dibandingkan.

## Pengujian

```sh
go test -race ./...
go vet ./...
go build ./cmd/api
```

Pengujian integrasi otomatis dilewati jika `TEST_DATABASE_URL` kosong. Untuk
menjalankannya pada PostgreSQL lokal yang terpisah:

```sh
docker compose -f compose.test.yaml up -d --wait
TEST_DATABASE_URL='postgresql://postgres:toko_test_only@127.0.0.1:55439/toko_test?sslmode=disable' go test -race -count=1 ./...
docker compose -f compose.test.yaml down
```

Test transaksi menyediakan fixture akun Supabase lama, sementara test registrasi
memakai database mandiri tanpa schema `auth`. Keduanya mengaplikasikan SQL asli. Test menolak host selain localhost/127.0.0.1 dan database
selain `toko_test`. Test memeriksa transaksi, rollback, tarif snapshot, flag metode,
pembatalan, dua kasir memperebutkan stok terakhir, auth HTTP, dan izin pemilik/kasir.

## Hal penting saat menghubungkan frontend

- Nominal JSON memakai string, misalnya `"12500.00"`, untuk mempertahankan presisi.
- `PUT` mengganti seluruh field master yang dapat diedit. Selalu kirim `aktif`,
  flag metode, dan field lain yang ingin dipertahankan. Field bool yang tidak dikirim
  bernilai `false`; gunakan `aktif: true` ketika membuat data aktif.
- Endpoint master tidak menghapus data; ubah `aktif` menjadi `false` bila tersedia.
- Jangan isi nomor, pengguna, status, harga jual transaksi, subtotal, tarif, atau
  total transaksi dari frontend. DTO menolak field yang tidak diperbolehkan.
- Setelah submit, gunakan hasil backend sebagai total final untuk struk.
- CORS mengizinkan satu origin sesuai `CORS_ORIGIN`; default contoh port 3000.
- Koneksi database backend memakai kredensial server yang dapat melewati RLS.
  Karena itu autentikasi dan pemeriksaan peran wajib melalui backend. Jangan kirim
  `DATABASE_URL` ke frontend. Tabel melalui Supabase Data API tetap tertutup tanpa policy.
- Semua perubahan stok harus melalui backend ini agar mengikuti penguncian produk.
  Penulisan SQL manual atau backend lain yang tidak mengambil lock dapat melanggar invariant stok.
- Transaksi mendukung `idempotency_key` UUID: request ulang dengan pengguna, key,
  dan body sama mengembalikan transaksi yang sama tanpa menambah mutasi kedua.
  Key yang dipakai untuk body berbeda ditolak. Frontend menyimpan request pending
  selama browser session dan memakai key yang sama saat retry. Pembatalan tidak
  otomatis memproses refund ke bank/penyedia QRIS.

## Integrasi frontend kasir

Frontend tersedia pada `../frontend`; lihat README di sana untuk environment,
login, menu pembelian, scanner, printer, dan laci. Database yang sudah memakai
schema lama perlu menjalankan `../database/migrations/integrasi_kasir.sql` sekali sebelum
menjalankan backend versi ini. Database baru cukup memakai `schema.sql` terbaru.

Referensi: [struktur modul Go](https://go.dev/doc/modules/layout),
[koneksi GORM](https://gorm.io/docs/connecting_to_the_database.html),
[transaksi GORM](https://gorm.io/docs/transactions.html),
[koneksi Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Ringkasan harian dan pengeluaran yang belum dirinci

Menu **Riwayat → Ringkasan Harian** tersedia untuk pemilik. Tanggal memakai WIB.
Penjualan berhasil dan dibatalkan dipisahkan, termasuk jumlah/nominal per metode.
DRAFT tidak masuk laporan; pembatalan mengikuti tanggal penjualan asal.

Perhitungan versi 2:

- Penjualan mencakup semua metode (tunai, QRIS, debit, dan lainnya).
- Belanja hari ini mencakup semua metode pembelian dan pengeluaran terbuka yang
  belum dirinci. Catatan yang sudah ditautkan tidak dihitung dua kali.
- Alokasi dari kemarin = `belanja_besok` dari versi laporan terbaru pada tanggal
  sebelumnya. Jika belum ada laporan, nilainya nol dan UI memberi keterangan.
- Sisa/kekurangan anggaran belanja = alokasi dari kemarin − belanja hari ini.
- Total dana seharusnya = penjualan + alokasi dari kemarin − belanja hari ini.
- Pemilik memasukkan total uang aktual (gabungan tunai dan non-tunai tersedia).
- Selisih = total aktual − dana seharusnya.
- Uang diterima sesungguhnya = total aktual − alokasi belanja besok. Nilai ini
  boleh minus, begitu juga sisa menurut perhitungan. Nominal alokasi tetap positif.

Membawa alokasi kemarin ke hari ini menjaga uang yang telah disisihkan tidak
berkurang dua kali. Nilai non-tunai diperiksa pemilik; aplikasi tidak membaca saldo
bank otomatis. Alokasi besok belum membuat transaksi pembelian atau mutasi stok.

Setiap pembelian berhasil otomatis membuat `catatan_belanja` berstatus SELESAI,
tertaut lewat `pembelian_id` unik, pada tanggal pembelian dalam WIB. Pembuatan
catatan, rincian, stok dan header berada dalam satu transaksi. Retry mengembalikan
pembelian yang sama tanpa catatan atau stok ganda. Migrasi juga menambahkan
catatan untuk pembelian lama yang belum tertaut, tanpa mengubah transaksi aslinya.

**Pengeluaran uang tak terduga** memakai `POST /api/v1/catatan-belanja` dengan
`idempotency_key` UUID, `tanggal`, `total`, dan `catatan`. Nominal langsung masuk
pengeluaran hari itu, tanpa perubahan stok. Di menu Pembelian, pilih catatannya
lalu isi barang dengan total final yang sama. Semua metode pembayaran pembelian
boleh digunakan. Tanggal uang keluar tetap tanggal catatan awal; stok berubah saat
rincian dilengkapi. Pembatalan pembelian membatalkan catatan terkait dalam satu
transaksi. Catatan terbuka dapat dibatalkan melalui `/{id}/batal`.

Endpoint ringkasan (khusus pemilik):

- `GET /api/v1/ringkasan-harian/preview?tanggal=YYYY-MM-DD`: perhitungan terkini,
  daftar pembelian beserta barangnya, sumber alokasi kemarin, dan `hash_sumber`.
- `POST /api/v1/ringkasan-harian`: `versi_perhitungan: 2`, `idempotency_key`,
  `tanggal`, `hash_sumber`, `nama_toko`, `kas_aktual` (total uang aktual di versi 2),
  `belanja_besok`, `catatan`, dan `email_tujuan` opsional.
- `GET /api/v1/ringkasan-harian?tanggal=YYYY-MM-DD&limit=10&offset=0`: histori.
- `GET /api/v1/ringkasan-harian/{id}`: satu laporan.
- `GET /api/v1/ringkasan-harian/{id}/email`: subject, HTML, teks dan tujuan email.

Perhitungan sumber memakai satu statement SQL agar semua bagian memakai snapshot
baca yang sama. Hash mencakup alokasi kemarin dan rincian belanja; perubahan data
sebelum simpan ditolak dan perlu dimuat ulang. Setiap penyimpanan menjadi versi
tetap; laporan lama mempertahankan angka dan format hitungnya. Snapshot baru
memakai `versi: 2`. Replay request lama yang sudah tersimpan tetap mengembalikan
laporan yang sama. Request lama yang belum tersimpan harus diperbarui dahulu.

Advisory lock dan UUID mencegah simpan ganda. Frontend menyimpan request pending
di sessionStorage dan mengulang body/key yang sama jika koneksi gagal.
`daily_summary_email.go` memakai `html/template` untuk meng-escape nama/catatan.
Email memakai snapshot tersimpan, tersedia untuk pratinjau dan unduh HTML.
Pengiriman email/SMTP belum diaktifkan.
