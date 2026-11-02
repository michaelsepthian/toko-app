# Database toko

Folder ini menyimpan struktur PostgreSQL yang diperlukan untuk deployment.

```text
database/
├── schema.sql          # Struktur awal dan data referensi bawaan
├── migrations/         # Perubahan struktur untuk database yang sudah ada
└── private/            # Data impor pribadi; diabaikan Git
```

Commit `schema.sql` dan `migrations/` bersama perubahan aplikasi. Jangan commit
data toko, dump database, password, atau `.env.docker`. File impor lokal berada
di `private/impor_db_final.sql` dan tidak diperlukan untuk database baru.

Compose membaca `schema.sql` dan migrasi tanggal pendapatan saat volume database
masih kosong. Migrasi lain merupakan pembaruan historis yang sudah tercakup dalam
schema awal; jangan menjalankan semua migrasi secara otomatis berdasarkan nama.

Untuk database yang sudah berisi data, backup dahulu dan jalankan hanya migrasi
yang diperlukan menggunakan `./deploy/migrate.sh database/migrations/NAMA.sql`.
Jangan menjalankan ulang schema awal atau menghapus volume untuk memperbarui tabel.

Lokasi file di host sudah disesuaikan pada `compose.yaml`; lokasi mount di dalam
container tetap `/schema/`. Nama service dan volume PostgreSQL tidak berubah.

Panduan lengkap: [deployment](../deploy/README.md).

Audit pengguna (20261102)
------------------------
`created_by` dan `updated_by` tersedia untuk kategori, satuan, produk,
sumber pembelian, metode pembayaran, penjualan, pembelian, dan catatan belanja.
Nilainya diisi server dari pengguna login; `created_by` tetap saat data diperbarui.
`updated_by` juga diisi pembuat pada pembuatan awal. Perubahan favorit produk dan
perincian catatan belanja turut memperbarui `updated_by`.

Pembatalan menyimpan `cancel_transaction_at` dan `cancel_transaction_by`, termasuk
catatan yang ikut dibatalkan bersama pembelian. Pembuat transaksi lama diambil
dari `pengguna_id`; pelaku perubahan/pembatalan dan waktu pembatalan lama yang
tidak diketahui tetap NULL. Master lama juga tetap NULL. Migrasi mempertahankan
`updated_at` dan aman dijalankan ulang.

Untuk database yang sudah ada, jalankan sebelum memperbarui aplikasi:

```sh
./deploy/migrate.sh database/migrations/20261102_audit_pengguna.sql
```

Database baru sudah mencakup audit dalam `schema.sql`.
