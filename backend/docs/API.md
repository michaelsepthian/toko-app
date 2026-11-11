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
| GET | `/master-data`, `/master-data/version` | Pengguna aktif; sumber pembelian hanya pemilik |
| GET | `/katalog/produk` | Pengguna aktif; katalog produk berpaginasi cursor |
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

Endpoint list CRUD memakai `?limit=20&offset=0` (maksimum limit 100), tanpa total count.
Master mendukung `?q=beras` untuk pencarian nama.
Produk juga mencari SKU/barcode melalui `q`, atau mencocokkan barcode persis
melalui `/produk?barcode=0012345678901`. Barcode diperlakukan sebagai teks.
Metode pembayaran mendukung `?untuk=penjualan` atau `?untuk=pembelian`, yang hanya
menampilkan metode aktif dengan flag sesuai. Riwayat transaksi list berisi header;
ambil endpoint `/{id}` untuk detail barang dan nilai final struk.
Kedua flag metode pembayaran boleh `false` untuk menyembunyikannya dari kedua
menu tanpa menghapus riwayat. Transaksi tetap menolak metode tanpa flag yang
sesuai atau yang `aktif=false`. Database lama perlu menjalankan
`database/migrations/metode_pembayaran_visibilitas.sql` sebelum memakai backend terbaru.

## Menyiapkan produk

### Master ringan dan katalog produk

`GET /master-data` mengembalikan `version`, `categories`, `units`, `payments`,
dan `sources` (kosong untuk kasir). **Tidak memuat field atau membaca tabel produk.**
Frontend dan backend harus diperbarui bersamaan karena kontrak master berubah.

Ambil produk secara terpisah melalui:

```text
GET /katalog/produk?limit=50&sort=name-asc&aktif=true
GET /katalog/produk?q=beras&limit=50
GET /katalog/produk?exact=0012345678901&limit=2
```

```json
{"data":{"items":[],"has_next":false,"next_cursor":null,"version":"versi-katalog","cache_ttl_seconds":3600}}
```

- Default `limit=50`, maksimum 100. Backend membaca `limit + 1`, **tanpa total/count
  produk**. Jika `has_next=true`, teruskan `next_cursor` pada parameter `cursor`;
  pertahankan semua parameter pencarian/filter/sort sebelumnya.
- Cursor memakai keyset, bukan OFFSET. Cursor tidak boleh dipakai untuk query lain.
  Versi katalog berubah setelah mutasi master; cursor lama menghasilkan 409 dan
  frontend memulai ulang halaman pertama. Perubahan transaksi pada urutan terlaris
  dapat mengubah posisi antar-request; bukan snapshot transaksi lintas halaman.
- `q` mencari setiap kata pada nama, SKU, barcode, atau nama kategori. `%`/`_`
  diperlakukan sebagai karakter literal. `exact` hanya barcode/SKU persis (SKU
  tidak peka kapital; barcode teks dengan nol di depan dipertahankan), tanpa fallback fuzzy.
- `aktif=true` (default), `false`, atau `all`.
- `sort`: `recommended` (frekuensi transaksi SELESAI), `name-asc` (default),
  `name-desc`, `newest`, `price-asc`, `price-desc`. Nama diurutkan tanpa membedakan
  kapital, dengan ID sebagai penentu akhir agar pagination deterministik.
- `favorites_first=true` mengutamakan favorit sebelum sort yang dipilih.
- Cache backend hanya halaman pertama tanpa `q`/`exact`, maksimal 32 entri per
  proses, dipisahkan berdasarkan versi dan seluruh opsi query. TTL diatur lewat
  `PRODUCT_CACHE_TTL_SECONDS` pada environment backend, default **3600 detik (1 jam)**.
  Pencarian bebas dan halaman lanjutan langsung ke DB. `refresh=true` melewati
  cache halaman awal. Tidak membutuhkan Redis.
- Frontend menyimpan maksimal 100 halaman dengan TTL yang sama, dikirim backend
  melalui `cache_ttl_seconds` pada setiap respons katalog (fallback 1 jam untuk
  respons lama). Cache terpisah per sesi dan query/cursor, dihapus saat mutasi master, pergantian versi, muat ulang,
  atau logout. Request serentak untuk halaman yang sama digabungkan.
- Contoh: `PRODUCT_CACHE_TTL_SECONDS=7200` untuk 2 jam. Nilai harus bilangan bulat
  1–31536000 detik. Set di `backend/.env` untuk proses lokal atau `.env.docker`
  untuk Compose, lalu restart/recreate API. Tidak perlu rebuild frontend saat
  mengganti TTL; browser mengambil kebijakan baru setelah versi API berubah.
  Cache urutan terlaris juga mengikuti TTL ini; gunakan **Perbarui terlaris** atau
  **Muat ulang data** bila ingin memperbarui sebelum TTL habis.
- `GET /master-data?refresh=true` juga memperbarui versi untuk perubahan langsung
  melalui SQL Editor. Beberapa replika API memiliki cache/version lokal sendiri;
  gunakan satu replika atau sticky routing sampai tersedia invalidasi terdistribusi.

Jalankan migrasi `database/migrations/20261110_katalog_produk.sql` (terdaftar dalam
manifest deployment) untuk indeks pagination dan pencarian `pg_trgm`. Role migrasi
harus boleh memasang ekstensi tersebut. Endpoint CRUD `/produk` tetap tersedia.

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

Database yang memakai schema lama perlu menjalankan `../database/migrations/integrasi_kasir.sql`
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

`POST /api/v1/penjualan` menerima `tanggal_pendapatan` opsional (`YYYY-MM-DD`, hari
ini dalam WIB atau sebelumnya). Nilai yang tidak valid atau tanggal mendatang
menghasilkan 400. Pembelian menolak field ini. Tanpa field, database memakai hari
dari waktu pencatatan penjualan dalam WIB. Field opsional dihilangkan dari hash
request lama sehingga retry sebelum fitur ini tetap kompatibel.

Respons penjualan menyertakan `tanggal_pendapatan` secara terpisah dari `tanggal`.
Ringkasan harian dan pembatalan memakai tanggal pendapatan; `tanggal`, nomor struk,
mutasi stok, dan filter riwayat tetap mengikuti waktu transaksi sebenarnya.
Contoh: dicatat 1 November dengan `tanggal_pendapatan=2026-10-31` masuk pendapatan
31 Oktober, tetapi tetap tampil dalam riwayat 1 November. Pembatalan mengeluarkannya
dari pendapatan 31 Oktober tepat satu kali, tanpa mengubah laporan snapshot lama.

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
Invalidasi versi ini tidak menunggu TTL `PRODUCT_CACHE_TTL_SECONDS`. Pada tab yang
mengubah favorit, sinkronisasi master dan versi digabungkan sehingga satu klik
hanya memicu satu fetch ulang halaman katalog aktif, bukan dua fetch identik.

Untuk database yang sudah ada, jalankan `database/migrations/produk_favorit.sql` sebelum
menjalankan backend baru. Instalasi baru memakai `database/schema.sql` yang
sudah menyertakan kolom ini. Favorit lama di browser tidak otomatis dipindahkan;
pemilik perlu menandainya kembali sekali.

### Audit pengguna

Respons kategori, satuan, produk, sumber pembelian, metode pembayaran, penjualan,
pembelian, dan catatan belanja menyertakan `created_by` dan `updated_by`
(ID pengguna, nullable untuk data historis). Keduanya ditetapkan server dari sesi
pengguna; field audit tidak diterima sebagai input. Pada pembuatan awal keduanya
berisi ID pembuat; pembaruan mempertahankan `created_by`.
Respons penjualan, pembelian, dan catatan belanja juga menyertakan
`cancel_transaction_at` (timestamp dengan zona waktu) dan `cancel_transaction_by`
(ID pengguna). Keduanya NULL sebelum pembatalan atau bila audit historis tidak
tersedia. Pembatalan pembelian mengisi audit yang sama pada catatan terkait.

### Rencana belanja

Rencana belanja **tidak memengaruhi stok, transaksi pembelian, atau laporan kas**.
Semua path berikut relatif terhadap `/api/v1` dan memerlukan sesi login.

| Method/path | Akses | Keterangan |
| --- | --- | --- |
| `GET /rencana-belanja/kalender?bulan=2026-11` | PEMILIK, KASIR | Ringkasan per tanggal: `tanggal`, `total_item`, `sudah_dibeli` |
| `GET /rencana-belanja?tanggal=2026-11-10&limit=100&offset=0` | PEMILIK, KASIR | Daftar item aktif, pagination standar |
| `GET /rencana-belanja/sumber` | PEMILIK, KASIR | Nama tempat beli: hanya `id`, `nama`, `aktif` |
| `POST /rencana-belanja` | PEMILIK, KASIR | Tambah 1–100 item atomik; retry dengan key/body yang sama |
| `PUT /rencana-belanja/{id}/checklist` | PEMILIK, KASIR | Body `{"dibeli":true}` atau `{"dibeli":false}` |
| `POST /rencana-belanja/pindah` | PEMILIK | Pindahkan 1–100 item sekaligus ke tempat/tanggal lain |
| `PUT /rencana-belanja/{id}` | PEMILIK | Edit data barang, tanpa menerima tempat beli/tanggal |
| `POST /rencana-belanja/{id}/hapus` | PEMILIK | Soft-delete dengan audit pengguna |

Contoh tambah barang:

```json
{
  "idempotency_key": "11111111-1111-4111-8111-111111111111",
  "tanggal": "2026-11-10",
  "sumber_pembelian_id": null,
  "items": [
    { "produk_id": 1, "jumlah": null },
    { "produk_id": null, "nama_barang": "Kantong kemasan", "jumlah": "2.5", "satuan": "pak", "catatan": "Ukuran besar" }
  ]
}
```

`produk_id = null` berarti Lainnya; nama barang wajib diisi. Untuk produk master,
nama dan satuan selalu disalin server. `jumlah` boleh tidak dikirim atau NULL;
jika terisi harus positif dan maksimal tiga desimal. Satuan dan catatan boleh
kosong. Tempat beli NULL berarti Belum ditentukan. Referensi baru hanya menerima
produk/tempat beli aktif. Tanggal rencana boleh lampau atau mendatang.

Contoh pemindahan (jumlah, catatan, checklist, dan ID item dipertahankan):

```json
{ "ids": [1, 2], "sumber_pembelian_id": 3, "tanggal": "2026-11-12" }
```

`tanggal` pada pemindahan opsional; jika tidak dikirim tanggal lama dipertahankan.
Tempat beli NULL memindahkan ke Belum ditentukan. ID yang hilang/terhapus membuat
seluruh pemindahan gagal. Pengguna audit diambil dari sesi, bukan body. Ubah
schema database lama memakai `database/migrations/20261110_rencana_belanja.sql`.
