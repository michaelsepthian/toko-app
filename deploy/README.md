# PostgreSQL dan Go dalam Docker

Semua perintah di bawah dijalankan dari **root project toko**, bukan folder backend.
`compose.yaml` menjalankan database dan backend, baik di laptop maupun di VPS.
Frontend lokal tetap dapat berjalan melalui Next.js atau Vercel. Untuk menempatkan
frontend juga di VPS, tambahkan `compose.vps.yaml`: Caddy, frontend Next.js, backend
Go, dan PostgreSQL berjalan dalam empat container, dengan satu domain dan HTTPS.

```text
Frontend → http://127.0.0.1:8080/api/v1 → container api → postgres:5432
                                              ↓
                                   volume postgres_data
```

`postgres` adalah nama service di jaringan Docker, bukan IP VPS. Di dalam container,
`localhost` menunjuk container itu sendiri. Backend karena itu memakai `DB_HOST=postgres`.
Supabase tidak diperlukan untuk instalasi baru; login username/password tetap tersedia.

## Menjalankan lokal

1. Jalankan Docker Desktop / Docker Engine beserta Compose.
2. Jika `.env.docker` belum ada, salin contohnya:

   ```sh
   cp .env.docker.example .env.docker
   ```

   Isi `POSTGRES_PASSWORD` untuk administrator dan `APP_DB_PASSWORD` untuk aplikasi.
   File ini diabaikan Git dan tidak dimasukkan ke image. Jika file sudah disiapkan,
   pertahankan password di dalamnya. Backend Docker tidak membaca `backend/.env`.

3. Jalankan:

   ```sh
   docker compose --env-file .env.docker up -d --build --wait
   docker compose --env-file .env.docker ps
   curl http://127.0.0.1:8080/readyz
   ```

   Saat volume masih kosong, PostgreSQL membuat role `toko_app` tanpa hak superuser
   dan menjalankan `database/schema.sql` serta migrasi tanggal pendapatan di
   `database/migrations/20261101_tanggal_pendapatan.sql` sebagai pemilik tabel. Sequence,
   trigger, satuan, dan metode pembayaran awal ikut dibuat. Backend menunggu
   PostgreSQL siap sebelum mulai menerima koneksi.

4. Pada `frontend/.env.local`, sesuaikan:

   ```dotenv
   NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080/api/v1
   ```

   Restart `npm run dev` setelah mengganti environment frontend. Buka frontend dan
   daftar akun pemilik untuk database baru. Data Supabase lama **tidak otomatis
   dipindahkan**. Frontend yang memakai database baru dapat meminta login ulang.

Jika port 8080 masih dipakai `go run` lama, hentikan proses itu sendiri sebelum
memakai port yang sama, atau ganti `API_PORT=8081` di `.env.docker`. URL frontend
dan perintah curl lalu memakai port 8081. Tidak perlu mengganti `HTTP_ADDR` di
container; port internal backend selalu 8080. Jika port PostgreSQL 5433 sudah
dipakai, ubah `DB_PORT_LOCAL` dan sesuaikan port saat mengakses dari host.

| Konfigurasi | Fungsi |
| --- | --- |
| `API_PORT` | Port API di laptop/VPS, default 8080, hanya bind localhost |
| `DB_PORT_LOCAL` | Port PostgreSQL di host, default 5433, hanya bind localhost |
| `POSTGRES_DB` | Nama database, default toko |
| `POSTGRES_PASSWORD` | Password admin PostgreSQL, dipakai saat inisialisasi |
| `APP_DB_PASSWORD` | Password role toko_app, dipakai saat inisialisasi dan koneksi API |
| `CORS_ORIGIN` | Alamat frontend persis, termasuk protokol dan port, tanpa slash akhir |
| `API_IMAGE` | Nama/tag image backend, default toko-api:local |

Untuk akses SQL dari laptop (misalnya DBeaver): host `127.0.0.1`, port `5433`,
database sesuai `POSTGRES_DB`, user `toko_app`, password sesuai `APP_DB_PASSWORD`.
Untuk `go run` di host, pakai contoh `backend/.env.example` dan isi password yang
sama dengan `.env.docker`, lalu jalankan service database saja:

```sh
docker compose --env-file .env.docker up -d --wait postgres
```

Konfigurasi backend dapat memakai `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD`, `DB_SSLMODE`. `DATABASE_URL` masih didukung dan diutamakan bila diisi.
Field terpisah menghindari kebutuhan URL encode password secara manual.
`sslmode=disable` pada Compose hanya untuk jaringan Docker lokal ini; koneksi
database melalui jaringan luar sebaiknya memakai TLS.

## Menghentikan, memperbarui, dan menyimpan data

```sh
docker compose --env-file .env.docker logs --tail=100 api
docker compose --env-file .env.docker down
docker compose --env-file .env.docker up -d --build --wait
```

`down` biasa tidak menghapus volume PostgreSQL. Jangan memakai `down -v` untuk
database berisi data yang ingin disimpan. Pertahankan nama project Compose `toko`
agar tetap memakai volume yang sama.

Script init hanya berjalan sekali pada volume kosong. Mengganti `schema.sql` atau
password environment tidak mengubah database yang sudah terbentuk. Update skema
dilakukan lewat SQL migrasi, setelah backup. Misalnya untuk database lama yang
belum memiliki flag favorit:

```sh
docker compose --env-file .env.docker exec -T postgres \
  sh -c 'exec psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
  < database/migrations/produk_favorit.sql
```

Jangan menjalankan ulang seluruh `schema.sql` pada database yang sudah berisi tabel.

## Migrasi produk dan stok Excel ke PostgreSQL lokal

Setelah registrasi akun pemilik, file impor Excel dapat dijalankan langsung:

```sh
./deploy/migrate.sh database/private/impor_db_final.sql
docker compose --env-file .env.docker restart api
```

Lalu muat ulang data frontend. Helper juga dapat menjalankan file SQL migrasi lain
pada database Compose. Detail pemetaan dan pemeriksaan hasil ada di
[petunjuk impor](../database/IMPOR_DB_FINAL.md). File impor tidak dijalankan otomatis
agar stok awal tidak tercampur dengan transaksi yang sudah berjalan.

## Backup dan restore

Backup lengkap database aplikasi, termasuk sequence, schema, data, dan password hash:

```sh
mkdir -p backups
docker compose --env-file .env.docker exec -T postgres \
  sh -c 'exec pg_dump -U postgres -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > backups/toko.dump
```

Simpan salinan backup di luar VPS. Untuk mengembalikan backup aplikasi ke database
Docker tujuan yang telah diinisialisasi (akan mengganti objek/data tujuan):

```sh
docker compose --env-file .env.docker stop api
docker compose --env-file .env.docker exec -T postgres \
  sh -c 'exec pg_restore -U postgres -d "$POSTGRES_DB" --role=toko_app --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction' \
  < backups/toko.dump
docker compose --env-file .env.docker up -d --wait api
```

Perintah restore ini untuk dump database mandiri yang dibuat di atas. Migrasi data
dari Supabase membutuhkan penyesuaian referensi `auth.users` pada schema lama;
gunakan schema mandiri terbaru dan rencanakan transfer data tersendiri.

## Frontend + backend di satu VPS dengan Caddy

```text
Internet → https://toko.example.com → Caddy (80/443)
                                      ├─ /api/v1/* → api:8080 → postgres:5432
                                      └─ /*        → frontend:3000
```

1. Siapkan VPS Linux dengan Docker Engine dan plugin Docker Compose. Ubuntu 24.04
   LTS dapat digunakan. Tidak perlu memasang Node.js, Go, Nginx, atau PostgreSQL
   langsung di host. Pastikan port 80/443 tidak sedang dipakai web server lain.
2. Arahkan DNS A domain aplikasi ke IPv4 publik VPS. Jika memakai AAAA, pastikan
   IPv6-nya juga benar. Buka TCP 80/443 dan port SSH yang digunakan; jangan membuka
   port database/API/frontend ke publik. Bila ada firewall provider, atur juga di sana.
3. Siapkan `.env.docker` dari contoh **hanya jika belum ada**. Pertahankan password
   untuk volume database yang sudah terbentuk. Untuk database baru, ganti kedua
   password contoh dengan password kuat yang berbeda, lalu isi:

   ```dotenv
   APP_DOMAIN=toko.domain-anda.com
   API_IMAGE=toko-api:local
   FRONTEND_IMAGE=toko-frontend:local
   ```

   `APP_DOMAIN` harus hostname saja, tanpa protokol, port, atau path. Overlay VPS
   mengatur `CORS_ORIGIN=https://APP_DOMAIN` untuk API, menggantikan origin lokal.
   Konfigurasi lama `API_DOMAIN` diganti dengan `APP_DOMAIN`; domain ini sekarang
   melayani frontend **dan** API. `.env.docker` yang sudah ada tidak diubah otomatis.

4. Jika source project tersedia di VPS, jalankan dari root:

   ```sh
   docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml config --quiet
   docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml up -d --build --wait
   docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml ps
   ```

5. Buka `https://toko.domain-anda.com`. Caddy otomatis meminta dan memperbarui
   sertifikat; DNS dan akses port 80/443 harus siap lebih dahulu. Volume `caddy_data`
   menyimpan sertifikat agar tidak meminta ulang setiap container dibuat ulang.
   Buat akun pemilik sebelum membuka akses ke pengguna lain; untuk database baru,
   lakukan registrasi awal melalui akses privat/lokal terlebih dahulu sebagaimana
   panduan lokal di atas. Registrasi ditutup setelah pengguna pertama dibuat.

Frontend tidak memublikasikan port 3000. PostgreSQL dan API tetap terikat localhost
di host sesuai `compose.yaml`; akses internet hanya melalui Caddy. Caddy menjaga
prefix `/api/v1`, bukan menghapusnya. `/readyz` API tetap dapat diperiksa dari host
di `http://127.0.0.1:8080/readyz`, bukan melalui domain frontend.

Image frontend dibuild dengan `NEXT_PUBLIC_API_BASE_URL=/api/v1`. Nilai ini relatif
terhadap domain aplikasi sehingga browser tidak memakai hostname internal Docker
atau `localhost` VPS. `.env.local` frontend tidak masuk build Docker. `NEXT_PUBLIC_*`
disisipkan saat build; mengubah environment runtime saja tidak akan mengubahnya.

Pada VPS kecil (misalnya RAM 3 GB), sebaiknya build di laptop/CI lalu pull image
seperti bagian berikut, agar build Next.js tidak berebut memori dengan database.

### Pull image sendiri di VPS

Backend dan frontend dapat dibangun di laptop/CI lalu dikirim ke registry milik
Anda. Contoh VPS AMD64 (sesuaikan namespace, versi, dan arsitektur VPS):

```sh
docker login ghcr.io
docker buildx build --platform linux/amd64 \
  -t ghcr.io/NAMESPACE/toko-api:1.0.0 --push ./backend
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api/v1 \
  -t ghcr.io/NAMESPACE/toko-frontend:1.0.0 --push ./frontend
```

Di VPS, salin `compose.yaml`, `compose.vps.yaml`, folder `deploy`, dan
folder `database` (kecuali `database/private`). Go, Node.js, dan source aplikasi tidak diperlukan untuk
menjalankan image yang sudah dibuat. Untuk database baru, siapkan `.env.docker`
dengan password VPS yang berbeda dari lokal, lalu isi:

```dotenv
API_IMAGE=ghcr.io/NAMESPACE/toko-api:1.0.0
FRONTEND_IMAGE=ghcr.io/NAMESPACE/toko-frontend:1.0.0
APP_DOMAIN=toko.domain-anda.com
```

Untuk registry privat, login di VPS terlebih dahulu. Jalankan:

```sh
docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml pull
docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml up -d --no-build --wait
```

`--no-build` memastikan VPS menggunakan image yang sudah di-pull. Selalu pertahankan
nama project dan volume saat update image. Jangan mengganti versi mayor PostgreSQL
langsung pada volume lama tanpa proses upgrade database.

Untuk update dan menghentikan stack lengkap, selalu sertakan kedua file Compose:

```sh
docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml logs --tail=100 proxy frontend api
docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml down
```

Jangan tambahkan `-v`: volume menyimpan data PostgreSQL dan sertifikat Caddy.
Backup database tetap perlu disalin ke luar VPS. Jika frontend tetap di Vercel dan
Anda memakai proxy sendiri untuk API, jalankan `compose.yaml` saja seperti
sebelumnya, arahkan proxy ke `127.0.0.1:8080`, dan atur `CORS_ORIGIN` sesuai origin
Vercel. Overlay `compose.vps.yaml` ditujukan untuk frontend dan API satu domain.

Referensi: [startup order Compose](https://docs.docker.com/compose/how-tos/startup-order/),
[inisialisasi PostgreSQL Docker](https://docs.docker.com/guides/postgresql/),
[multi-stage build](https://docs.docker.com/build/building/multi-stage/).

## Update tanggal pendapatan penjualan

Untuk database yang sudah berisi data, buat backup terlebih dahulu (lihat bagian
Backup dan restore). Sebelum menjalankan image API terbaru, jalankan dari root:

```sh
./deploy/migrate.sh database/migrations/20261101_tanggal_pendapatan.sql
```

Migrasi menambahkan kolom/index dan mengisi tanggal pendapatan transaksi lama dari
tanggal pencatatannya dalam WIB. Aman dijalankan ulang: pilihan tanggal yang sudah
ada tidak ditimpa. Waktu riwayat, nomor struk, dan isi laporan tersimpan tidak
diubah. Setelah migrasi berhasil, deploy image backend **dan** frontend terbaru.
Instalasi baru lewat Compose menjalankan migrasi ini otomatis pada volume kosong.
Jangan menjalankan ulang seluruh `schema.sql` atau menghapus volume untuk update ini.

## Update fitur ringkasan harian

Database yang sudah berjalan perlu migrasi tambahan, berurutan:

```sh
./deploy/migrate.sh database/migrations/catatan_belanja.sql
./deploy/migrate.sh database/migrations/ringkasan_harian.sql
./deploy/migrate.sh database/migrations/ringkasan_pengeluaran.sql
```

Migrasi menambahkan tabel dan catatan tertaut untuk pembelian lama, tanpa mengubah transaksi aslinya. Migrasi `ringkasan_pengeluaran.sql` juga mengizinkan sisa uang minus; bila dua migrasi sebelumnya sudah dijalankan, cukup jalankan migrasi ini. Instalasi baru
sudah mencakup seluruhnya melalui `database/schema.sql`. Setelah migrasi, gunakan
image API terbaru dan build frontend terbaru. Jangan menjalankan seluruh
`schema.sql` ulang pada database toko yang sudah berisi data.
