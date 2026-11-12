# Impor produk dan stok dari DB Final.xlsx

File yang dijalankan: `private/impor_db_final.sql`.
Sumber: `DB Final.xlsx`, sheet `Sheet1`, baris 3–4277; baris 2 kosong.
SHA-256 sumber: `ae9af56264dfd77015e1657a0bb095418a1d1a57d299a0820fd3c973782ff6b6`.

## Hasil yang disiapkan

| Jenis | Jumlah produk | Stok awal |
| --- | ---: | ---: |
| Kategori Umum, satuan Unit | 4.273 | 478.600 Unit |
| Kategori Produk Timbangan, satuan Kg | 2 | 20 Kg |
| Semua produk | 4.275 | Dipisahkan menurut satuan |

Produk timbangan mengikuti keputusan untuk dijual per kg:

| Baris Excel | Produk | Barcode | Stok di Excel | Stok yang diimpor | Harga jual per kg |
| --- | --- | --- | ---: | ---: | ---: |
| 43 | Telur Ayam (timbang) | TSN190029 | 10.000 gram | 10 Kg | Rp32.500 |
| 359 | Sumedang per Kg (timbang) | TSN190026 | 10.000 gram | 10 Kg | Rp20.500 |

Kategori dan satuan produk lainnya tidak tersedia dalam Excel, sehingga dipakai Umum / Unit. Tidak ada pengelompokan kategori yang ditebak dari nama produk. Kategori dan satuan baru dibuat jika nama yang sama belum tersedia.

## Pemetaan kolom

| Excel | Tujuan |
| --- | --- |
| Nama | `produk.nama` |
| Harga | `produk.harga_jual` |
| Barcode | `produk.barcode`; juga menjadi SKU untuk produk baru |
| Stock | `mutasi_stok.perubahan`, jenis `AWAL` |
| Reminder Stock | `produk.stok_minimum`; seluruh sumber kosong sehingga diisi 0 untuk produk baru |
| Timbangan | Dua nilai `100` menentukan satuan Kg dan konversi stok gram / 1.000 |
| Modal | Disimpan dalam arsip impor; seluruh nilainya 0. Tidak dibuat pembelian atau harga beli fiktif |
| Reminder Exp (Hari) | Disimpan dalam arsip impor; seluruh sumber kosong |

Seluruh kolom sumber dan nomor baris Excel disimpan dalam JSON pada `public.riwayat_impor_data.data_sumber`. Barcode asli dan barcode setelah normalisasi dicatat terpisah. Tabel ini hanya untuk log/arsip impor; RLS aktif dan tidak diberikan akses langsung kepada anon/authenticated.

Primary key serta sequence tetap mengikuti identity database. SQL tidak menetapkan ID produk secara manual dan tidak perlu reset sequence. Stok dicatat sebagai mutasi, bukan kolom stok baru pada produk.

## Menjalankan pada PostgreSQL lokal di Docker

1. Pastikan container PostgreSQL berjalan dan akun pemilik sudah diregistrasikan
   melalui aplikasi. Schema terbaru dibuat otomatis saat volume Docker pertama
   kali diinisialisasi. Jangan menjalankan ulang `schema.sql` pada database berisi tabel.
2. Jika ada beberapa pemilik aktif, isi `v_username_pemilik` di SQL dengan username
   yang diinginkan. Bila hanya satu pemilik, biarkan `NULL` agar dipilih otomatis.
3. Dari root project jalankan:

   ```sh
   ./deploy/migrate.sh database/private/impor_db_final.sql
   ```

   Helper membaca `.env.docker` dan menjalankan SQL sebagai `toko_app`, pemilik
   tabel aplikasi. Database tujuan mengikuti `POSTGRES_DB`, bukan nama database
   yang ditebak. File SQL ini tidak membutuhkan schema identitas eksternal, `anon`, atau
   `authenticated` pada PostgreSQL mandiri. Tidak perlu mengubah data Excel.
4. Sesudah berhasil, kosongkan cache master backend dan muat ulang frontend:

   ```sh
   docker compose --env-file .env.docker restart api
   ```

   Lalu pilih **Muat ulang data** pada frontend. Buka Pembelian untuk melihat stok.
   SQL langsung tidak mengirim invalidasi cache ke backend yang sedang berjalan.

Perintah Docker yang setara jika tidak memakai helper:

```sh
docker compose --env-file .env.docker exec -T postgres \
  sh -c 'exec psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SET ROLE toko_app" -f -' \
  < database/private/impor_db_final.sql
```

Untuk PostgreSQL tanpa Docker, jalankan sebagai pemilik tabel dengan psql:

```sh
psql -h 127.0.0.1 -p 55432 -U toko_app -d toko -W \
  -v ON_ERROR_STOP=1 -f database/private/impor_db_final.sql
```

Port 55432 mengikuti konfigurasi lokal yang sudah disiapkan; sesuaikan host, port,
nama database, dan user jika berbeda. Password diminta interaktif. Bisa juga
menjalankan seluruh SQL melalui query editor DBeaver/pgAdmin sebagai pemilik tabel.

File dijalankan melalui psql. Pembatasan hak akses role client dilakukan hanya
jika role tersebut tersedia.

## Data lama dan menjalankan ulang

- Barcode adalah kunci pencocokan produk, bukan nama produk.
- Produk yang barcodenya sudah ada dipakai kembali; nama, harga jual, SKU, kategori, status aktif, dan stok minimum master lama tidak ditimpa. Satuannya harus sama dengan satuan impor. Data Excel tetap disimpan dalam arsip.
- SKU yang sudah dipakai produk dengan barcode berbeda/kosong menyebabkan impor dibatalkan, agar tidak menghubungkan barang yang salah.
- Bila produk terkait sudah mempunyai mutasi stok apa pun, impor pertama dibatalkan seluruhnya. Stok dari Excel adalah stok awal; tidak ditambahkan ke stok yang sudah berjalan. Untuk produk tersebut gunakan penyesuaian stok.
- File yang sama setelah berhasil diimpor akan dilewati bila dijalankan kembali. Hal ini tetap berlaku setelah produk mulai bertransaksi. Untuk memperbaiki stok setelah impor, gunakan penyesuaian; jangan hapus log impor untuk memaksa impor ulang.
- Seluruh impor berjalan dalam satu transaksi. Jika validasi/constraint gagal, perubahan data dan arsip dalam transaksi dibatalkan.

## Catatan data sumber

- Barcode `8998866109949 ` pada baris 3058 dibersihkan menjadi `8998866109949` (spasi belakang dihapus).
- Ada 12 barcode bertipe angka di Excel. Nilainya dikonversi menjadi teks tanpa notasi ilmiah atau tambahan nol; Excel tidak menyimpan informasi nol awal untuk sel angka berformat General.
- Empat nama berikut masing-masing muncul dua kali dengan barcode berbeda, sehingga tidak digabung: Racik Tepung Bumbu AyamKrispi 210gr; Yuri HS Pump Lemon 410 mL; Jaz1 DeterGel 38gr; Kertas Coklat. Pada dua nama terakhir harga juga berbeda.
- Nilai stok non-timbangan 100 atau 1.000 dipertahankan sesuai Excel; tidak dianggap sebagai satuan kemasan.

## Verifikasi setelah dijalankan

Lihat ringkasan tanpa menampilkan arsip data yang panjang:

```sql
select kode, jumlah_produk, ringkasan, created_at
from public.riwayat_impor_data
where kode = 'db_final_ae9af56264df';
```

Periksa stok awal dua produk timbangan (masing-masing 10):

```sql
select p.barcode, p.nama, u.nama as satuan, m.perubahan as stok_awal
from public.produk p
join public.satuan u on u.id = p.satuan_id
join public.mutasi_stok m on m.produk_id = p.id and m.jenis = 'AWAL'
where p.barcode in ('TSN190029', 'TSN190026')
order by p.barcode;
```

File SQL sudah dibandingkan dengan seluruh baris sumber. Penyesuaian PostgreSQL lokal diuji pada database Docker terpisah; impor tidak dijalankan otomatis pada database toko.
