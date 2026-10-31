# Panduan API

Base URL: `http://127.0.0.1:8080/api/v1`.
Endpoint bisnis wajib header `Authorization: Bearer <token_sesi>`.
`GET /setup`, `POST /auth/register`, dan `POST /auth/login` tidak memerlukan token.
Body registrasi dan login hanya `{"username":"pemilik","password":"password-anda"}`.
Registrasi mengembalikan 201, login 200; `data` berisi `user`, `access_token`, dan
`expires_at`. Password/hash tidak dikembalikan. Registrasi ditutup jika sudah ada
pengguna. `POST /auth/logout` memakai Bearer token dan mencabut sesi saat ini.
Body request menggunakan `Content-Type: application/json`.

Respons berhasil dibungkus `{"data": ...}`. Respons gagal memakai
`{"error":{"message":"..."}}`. Error 400 berarti input tidak valid, 401 token
tidak valid, 403 tidak berhak, 404 data tidak ditemukan, 409 konflik data/stok.

## Endpoint

| Method | Path | Akses |
|---|---|---|
| GET | `/setup` | Publik, hanya status registrasi |
| POST | `/auth/register` | Publik, hanya ketika toko belum memiliki pengguna |
| POST | `/auth/login` | Publik, username/password |
| POST | `/auth/logout` | Pengguna aktif |
| GET | `/me` | Pengguna aktif |
| GET | `/kategori`, `/satuan`, `/produk`, `/sumber-pembelian`, `/metode-pembayaran` | Pengguna aktif |
| GET | Semua master di atas + `/{id}` | Pengguna aktif |
| GET | `/produk/popularitas` | Pengguna aktif |
| POST | Semua master di atas | Pemilik |
| PUT | Semua master di atas + `/{id}` | Pemilik |
| GET | `/penjualan`, `/penjualan/{id}` | Pengguna aktif |
| POST | `/penjualan` | Pengguna aktif |
| POST | `/penjualan/{id}/batal` | Pemilik |
| GET | `/pembelian`, `/pembelian/{id}` | Pemilik |
| POST | `/pembelian` | Pemilik |
| POST | `/pembelian/{id}/batal` | Pemilik |
| GET | `/stok`, `/produk/{id}/mutasi` | Pengguna aktif |
| POST | `/produk/{id}/mutasi` | Pemilik |

Endpoint list memakai `?limit=20&offset=0` (maksimum limit 100), tanpa total count.
Master mendukung `?q=beras` untuk pencarian nama.
Produk juga mencari SKU/barcode melalui `q`, atau mencocokkan barcode persis
melalui `/produk?barcode=0012345678901`. Barcode diperlakukan sebagai teks.
Metode pembayaran mendukung `?untuk=penjualan` atau `?untuk=pembelian`, yang hanya
menampilkan metode aktif dengan flag sesuai. Riwayat transaksi list berisi header;
ambil endpoint `/{id}` untuk detail barang dan nilai final struk.
Kedua flag metode pembayaran boleh `false` untuk menyembunyikannya dari kedua
menu tanpa menghapus riwayat. Transaksi tetap menolak metode tanpa flag yang
sesuai atau yang `aktif=false`. Database lama perlu menjalankan
`supabase/metode_pembayaran_visibilitas.sql` sebelum memakai backend terbaru.

## Menyiapkan produk

`POST /kategori`: `{"nama":"Sembako","deskripsi":"Kebutuhan harian"}`

`POST /satuan`: `{"nama":"karung"}`

`POST /produk` (gunakan ID kategori/satuan hasil API):

```json
{
  "kategori_id": 1,
  "satuan_id": 1,
  "sku": "BRG-001",
  "barcode": null,
  "nama": "Beras",
  "harga_jual": "15000.00",
  "stok_minimum": "5.000",
  "aktif": true
}
```

`POST /sumber-pembelian`:

```json
{
  "nama": "Pak Budi",
  "jenis": "SALES",
  "nama_toko_perusahaan": "Distributor ABC",
  "nama_kontak": "Pak Budi",
  "nomor_telepon": "08123456789",
  "alamat": null,
  "catatan": "Datang hari Senin",
  "aktif": true
}
```

`POST /metode-pembayaran` (tarif contoh, sesuaikan penyedia):

```json
{
  "nama": "QRIS Penjualan",
  "jenis": "QRIS",
  "tarif_persen": "0.7000",
  "tarif_tetap": "0.00",
  "penanggung_biaya": "TOKO",
  "untuk_penjualan": true,
  "untuk_pembelian": false,
  "aktif": true
}
```

## Stok awal atau koreksi

`POST /produk/1/mutasi`:

```json
{"jenis":"AWAL","perubahan":"20.000","catatan":"Stok sebelum mulai memakai aplikasi"}
```

Untuk koreksi, gunakan jenis `PENYESUAIAN`. Perubahan `"-2.000"` berarti stok
dikurangi dua. Nilai ini adalah selisih, bukan stok akhir yang diinginkan.
Stok awal hanya boleh dicatat satu kali per produk. Stok dari pembelian baru
dicatat lewat endpoint pembelian, bukan ditambah lagi lewat penyesuaian.

## Penjualan

`POST /penjualan`:

```json
{
  "metode_pembayaran_id": 1,
  "diskon_transaksi": "0.00",
  "jumlah_dibayar": "50000.00",
  "nomor_referensi": null,
  "catatan": null,
  "items": [
    {"produk_id":1,"jumlah":"2.000","diskon":"0.00"}
  ]
}
```

Harga jual berasal dari produk. Diskon pada item merupakan nominal per baris,
bukan diskon per unit. `diskon_transaksi` adalah diskon tambahan setelah seluruh
subtotal baris dijumlahkan. Jumlah barang maksimal 3 angka desimal; uang maksimal
2 angka desimal. Produk yang sama tidak boleh muncul dua kali pada satu request.

Status langsung `SELESAI` jika semua valid. Pembayaran kurang
akan membatalkan seluruh perubahan. Untuk pembayaran nontunai, kirim jumlah yang
benar-benar dibayar sesuai total final, jangan nominal uang tunai contoh di atas.
API ini mencatat pembayaran; tidak memanggil gateway atau memverifikasi settlement QRIS.

Respons memuat `nomor`, `subtotal_barang`, `total_belanja`, `biaya_pembayaran`,
`total_tagihan`, `jumlah_dibayar`, `kembalian`, dan `detail` untuk cetak struk.
Setiap detail memuat `nama_produk` yang disalin saat transaksi dibuat.
Waktu nomor mengikuti saat INSERT di WIB, bukan waktu yang dikirim frontend.

## Pembelian

`POST /pembelian`:

```json
{
  "metode_pembayaran_id": 1,
  "sumber_pembelian_id": 1,
  "nomor_nota": "NOTA-ABC-10",
  "diskon_transaksi": "0.00",
  "nomor_referensi": null,
  "catatan": "Pembelian stok mingguan",
  "items": [
    {"produk_id":1,"jumlah":"10.000","harga_beli":"12000.00","diskon":"0.00"}
  ]
}
```

`sumber_pembelian_id` opsional. Biaya pembayaran pembelian selalu menjadi pengeluaran
toko. Transaksi diasumsikan sudah lunas; belum mencakup utang/cicilan. Pembelian tidak
mengubah harga jual master produk secara otomatis.

## Pembatalan

`POST /penjualan/1/batal` atau `POST /pembelian/1/batal`:

```json
{"alasan":"Salah input transaksi"}
```

Hanya pemilik dan hanya transaksi `SELESAI`. Pembatalan kedua ditolak. Mutasi lama
dipertahankan dan ditambah mutasi `PEMBALIKAN`. Pembatalan bukan fitur retur sebagian.

## Idempotency

Body penjualan maupun pembelian dapat berisi `idempotency_key` UUID. Frontend kasir
mengirimkannya pada setiap checkout. Request ulang harus memakai key, body, dan
pengguna yang sama. Backend menyerialkan request dengan advisory lock PostgreSQL
dan mengembalikan transaksi yang sudah dibuat, tanpa menulis stok lagi. Penggunaan
key yang sama untuk body atau pengguna berbeda menghasilkan 409.

## Migrasi integrasi kasir

Database yang memakai schema lama perlu menjalankan `../supabase/integrasi_kasir.sql`
sekali. Untuk database baru cukup `schema.sql` terbaru. Kolom `jenis` metode
pembayaran menerima CASH/QRIS/DEBIT/TRANSFER/LAINNYA; pemilihan cash tidak lagi
didasarkan pada nama metode. Snapshot nama untuk detail lama diisi dari nama
produk saat migrasi; perubahan nama historis sebelum migrasi tidak bisa dipulihkan.

Penjualan tetap dapat disimpan jika stok nol atau kurang dari jumlah barang. Mutasi penjualan tetap mengurangi saldo sehingga stok dapat negatif. Frontend menampilkan peringatan stok; pembatalan pembelian tetap ditolak jika stok sudah digunakan.


## Data master untuk frontend kasir

`GET /api/v1/master-data` mengembalikan `{data: {version, products, categories, units, payments, sources}}` tanpa pagination. Kelima daftar diambil dalam satu request HTTP; backend membaca tabel hanya ketika cache kosong atau dibatalkan. Pengguna kasir menerima `sources: []`, pemilik menerima sumber pembelian. Endpoint tetap memerlukan autentikasi.

`GET /api/v1/master-data/version` hanya mengembalikan `{data: {version}}` dari memori. Versi berubah setelah POST/PUT master berhasil (produk, kategori, satuan, metode pembayaran, sumber pembelian). Penjualan, pembelian, pembatalan, dan mutasi stok tidak membatalkan cache master.

`GET /api/v1/master-data?refresh=true` membatalkan dan memuat ulang cache secara eksplisit, misalnya setelah perubahan langsung dari SQL Editor. Cache berada di memori satu proses backend, hilang saat restart. Perubahan langsung di database tidak terdeteksi otomatis; gunakan muat ulang eksplisit. Deployment beberapa instance memerlukan invalidasi bersama sebelum memakai cache ini lintas instance.

`GET /api/v1/stok/ringkasan` (pemilik) mengembalikan seluruh saldo stok tanpa pagination, dihitung langsung dari mutasi. Frontend memanggilnya saat membuka Pembelian serta setelah pembelian/penyesuaian, terpisah dari master.

Endpoint daftar lama tetap tersedia untuk kompatibilitas; riwayat transaksi tetap menggunakan pagination.


## Filter tanggal riwayat

`GET /api/v1/penjualan?tanggal=2026-10-29&limit=20&offset=0` menampilkan transaksi pada satu tanggal berdasarkan WIB (Asia/Jakarta). Tanpa `tanggal`, riwayat penjualan otomatis memakai hari ini. Tanggal wajib valid dalam format `YYYY-MM-DD`; nilai tidak valid menghasilkan 400. Filter diterapkan sebelum pagination dengan rentang `tanggal >= awal_hari AND tanggal < awal_hari_berikutnya`, sehingga transaksi tepat tengah malam hari berikutnya tidak ikut.

Riwayat pembelian tetap menampilkan semua tanggal secara default; API pembelian juga menerima parameter `tanggal` jika diperlukan.

## Urutan produk di kasir

`GET /produk/popularitas` mengembalikan seluruh produk yang pernah muncul pada
penjualan berstatus `SELESAI`, tanpa pagination. Contoh data:

```json
[{"produk_id": 12, "transaksi": 24}, {"produk_id": 30, "transaksi": 8}]
```

`transaksi` adalah jumlah transaksi berbeda yang memuat produk tersebut, bukan
jumlah unit. Produk tanpa riwayat dianggap memiliki frekuensi 0; transaksi DRAFT
dan BATAL tidak dihitung. Endpoint hanya membaca data; tidak membutuhkan migrasi.
Frontend mengambil ringkasan saat kasir dibuka, setelah penjualan selesai, atau
ketika tombol **Perbarui terlaris** ditekan. Master produk tidak diunduh ulang.

Urutan awal **Paling sering dibeli** memakai frekuensi transaksi, lalu nama A–Z
sebagai pembanding jika nilainya sama. Checkbox **Utamakan favorit** menempatkan produk favorit di atas produk lain.
Urutan yang dipilih berlaku di dalam kedua kelompok, dan semua produk tetap
ditampilkan sesuai pencarian.
Pilihan urutan lainnya: nama A–Z/Z–A, produk terbaru (ID), dan harga rendah/tinggi.
Pengurutan dilakukan sebelum pencarian, dan tetap memakai katalog virtual.
Favorit disimpan pada kolom `produk.is_favorit` (boolean, default `false`) di
database, sehingga berlaku untuk semua pengguna dan perangkat. Pemilik dapat
mengubahnya melalui bintang di penjualan atau checkbox **Favorit toko** di menu
Produk. Kasir hanya melihat tanda favorit. Pilihan jenis urutan tetap tersimpan
per akun di browser; ID favorit lama dari browser tidak digunakan lagi.

`PUT /produk/{id}/favorit` (khusus PEMILIK), body `{"is_favorit": true}` atau
`{"is_favorit": false}`, mengembalikan produk terbaru dan membatalkan cache master.
Pengguna lain menerima perubahan melalui pemeriksaan versi master (maksimal
sekitar 30 detik selama halaman aktif). Flag juga tersedia pada create/update
produk biasa. Frekuensi transaksi tetap berasal dari database toko.

Untuk database yang sudah ada, jalankan `supabase/produk_favorit.sql` sebelum
menjalankan backend baru. Instalasi baru memakai `supabase/schema.sql` yang
sudah menyertakan kolom ini. Favorit lama di browser tidak otomatis dipindahkan;
pemilik perlu menandainya kembali sekali.
