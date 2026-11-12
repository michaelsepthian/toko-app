# Pengujian backend Go

```text
test/
├── unit/
│   ├── config/       # Konfigurasi melalui API publik
│   ├── dto/          # Kontrak JSON dan mapper
│   └── service/      # Validasi bisnis melalui API publik
├── integration/
│   ├── httpapi/      # Request HTTP, autentikasi, katalog, dan PostgreSQL
│   └── service/      # Transaksi, laporan, audit, migrasi, dan rencana belanja
├── architecture/    # Batas dependency antarlayer
└── testutil/         # Pencarian root backend dan lokasi fixture SQL
```

Unit test yang membutuhkan fungsi/field private tetap berada di
`internal/httpapi/` dan `internal/service/`, mengikuti aturan package Go. Tidak ada
API produksi yang dibuka hanya agar test dapat dipindahkan. Suite integrasi
menggunakan API publik service/router dan tidak bergantung pada akses private.

Jalankan dari folder `backend/`:

```sh
make test-unit       # Unit test private, black-box, dan arsitektur
make test            # Semua test; integrasi dilewati jika env DB kosong
make test-cover      # Coverage kode internal, termasuk test dari package berbeda
make fmt-check       # Memeriksa format source dan test
```

Untuk pengujian integrasi, gunakan PostgreSQL lokal khusus test:

```sh
docker compose -f compose.test.yaml up -d --wait
TEST_DATABASE_URL='postgresql://postgres:toko_test_only@127.0.0.1:55439/toko_test?sslmode=disable' make test-integration
docker compose -f compose.test.yaml down
```

`make test-integration` menolak env DB kosong agar tidak memberikan kesan lulus
padahal suite dilewati. Test tetap menolak host selain localhost/127.0.0.1 dan nama
database selain `toko_test`. Fixture dibaca dari `database/` melalui `testutil`,
bukan dari path relatif yang bergantung pada kedalaman folder test.

`go test ./...` tetap dapat digunakan tanpa build tag atau test runner tambahan.
Untuk coverage lintas package, gunakan `-coverpkg=./internal/...`, bukan hanya
`-cover`, agar kode produksi yang dipanggil dari folder test ikut dihitung.
