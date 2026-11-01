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
