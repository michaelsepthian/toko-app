# Deployment otomatis dari master ke VPS

Setiap push ke `master` yang menyentuh backend, frontend, database, konfigurasi
Compose, atau deployment menjalankan `.github/workflows/deploy.yml`.

1. GitHub Actions menguji skrip dan migrasi pada PostgreSQL terpisah.
2. Backend/frontend dibangun di runner GitHub, lalu dikirim ke GHCR.
   Tag `tree-<hash folder>-amd64` memastikan isi folder yang sama memakai image
   yang sudah tersedia. Push yang hanya mengubah frontend tidak membangun backend.
   Pada deployment pertama kedua image dibangun. Menghapus image dari GHCR akan
   membuatnya dibangun lagi pada push berikutnya. Dependensi di luar folder tidak
   termasuk hash; bila kelak build memakai berkas bersama, tambahkan ke kunci image.
3. GitHub terhubung ke VPS lewat SSH. Checkout VPS dipindahkan ke commit yang tepat.
4. VPS menarik kedua image, memastikan PostgreSQL siap, membuat backup bila ada
   migrasi pending, lalu menjalankan migrasi dan ledger dalam satu transaksi.
5. Compose memperbarui layanan yang image/konfigurasinya berubah, menunggu health
   check, dan mencatat commit sukses. Push baru menunggu deployment aktif;
   deployment commit lama dilewati bila `master` sudah lebih baru.

Build dilakukan sebelum migrasi. Migrasi gagal menghentikan deployment dan
mengembalikan seluruh batch SQL beserta ledger. Jika health check aplikasi gagal
setelah migrasi berhasil, migrasi tetap terpasang: **tidak ada rollback database
atau image otomatis**. Gunakan migrasi tambahan untuk koreksi dan buat perubahan
schema yang tetap kompatibel dengan aplikasi lama (tambah kolom terlebih dahulu;
hapus/rename pada deployment terpisah). Migrasi saja tidak otomatis me-restart API;
jika mengubah data yang dicache, sertakan perubahan backend atau restart API.

## Persiapan VPS satu kali

Target workflow ini **VPS Linux AMD64**, dengan frontend dan API di satu domain
melalui `compose.yaml` + `compose.nginx.yaml`. Domain/HTTPS diteruskan oleh proxy provider ke Nginx pada port 80. Overlay Caddy `compose.vps.yaml` tetap tersedia untuk deployment manual VPS dengan IP publik sendiri; workflow ini memakai Nginx. Untuk ARM64, ubah platform dan akhiran
tag pada workflow serta `auto-deploy.sh` bersama-sama.

VPS membutuhkan Git, Python 3, `flock` (util-linux), Docker Engine, dan Docker
Compose versi yang mendukung `up --wait`. Pengguna SSH harus dapat menjalankan
Docker tanpa prompt sudo. Gunakan direktori checkout khusus deployment; jangan
mengedit source di VPS. Skrip menolak working tree kotor.

1. Clone repo ke direktori tetap, misalnya `/opt/toko`. Direktori ini harus dimiliki
   pengguna deployment. Repo privat memerlukan deploy key **read-only** di VPS
   agar `git fetch origin master` berhasil. Tambahkan host GitHub ke `known_hosts`
   VPS dengan fingerprint yang telah diverifikasi.
2. Siapkan `/opt/toko/.env.docker` dengan password database yang benar dan
   `APP_DOMAIN`. Jangan menimpa password untuk volume database yang sudah ada.
   Arahkan DNS domain ke VPS dan buka port 80/443. Untuk database lama, pastikan
   migrasi historis ringkasan/catatan belanja sudah diterapkan sesuai README.
   Database baru diinisialisasi otomatis dari `schema.sql`.
3. Untuk GHCR privat, login Docker **di VPS sebagai pengguna deployment**:

   ```sh
   docker login ghcr.io -u USERNAME_GITHUB
   ```

   Masukkan token classic dengan `read:packages` di prompt password. Pastikan akun
   tersebut punya akses ke package. Token login ini tersimpan hanya di VPS; token
   bawaan GitHub Actions dipakai untuk publish. Untuk image publik, login VPS
   tidak diperlukan.
4. Buat key SSH khusus GitHub Actions → VPS. Pasang public key ke
   `~/.ssh/authorized_keys` pengguna deployment di VPS.

Pertahankan project Compose `toko` dan volume yang sama agar data tetap digunakan.
Folder `.deploy/` berisi backup, lock, referensi image, dan commit sukses; diabaikan
Git. Backup berisi data toko/password hash, hanya bisa dibaca pemilik. Salin backup
ke penyimpanan terpisah dan atur retensinya; skrip tidak menghapus backup otomatis.

## Pengaturan GitHub

Di repository → **Settings → Environments**, buat environment `production`.
Tambahkan secrets berikut (bisa juga repository secrets):

| Secret | Isi |
| --- | --- |
| `VPS_HOST` | IP/hostname VPS, tanpa protokol |
| `VPS_USER` | Pengguna SSH deployment |
| `VPS_PORT` | Port SSH; opsional, default `22` |
| `VPS_APP_PATH` | Path absolut checkout, misalnya `/opt/toko`, tanpa spasi |
| `VPS_SSH_KEY` | Private key untuk SSH ke VPS, tanpa passphrase |
| `VPS_KNOWN_HOSTS` | Entri known_hosts VPS yang sudah diverifikasi; untuk port khusus bentuknya `[host]:port ...` |

Jangan menyalin private key ke repo. Fingerprint host harus dicocokkan dengan
console/provider VPS sebelum menyimpan `VPS_KNOWN_HOSTS`. Workflow menolak host
SSH yang tidak sesuai; tidak menggunakan `StrictHostKeyChecking=no`.

Environment `production` dapat dibatasi ke `master`. Bila ingin deployment
langsung otomatis, jangan aktifkan required reviewers. Workflow memiliki
`packages: write` untuk publish image; pastikan kebijakan organisasi mengizinkan
Actions/GHCR. Build pertama membuat `<owner>/<repo>-api` dan `-frontend` di GHCR.

Commit dan push seluruh workflow, skrip, manifest, **beserta migrasi audit dan kode
aplikasi yang ditambahkan sebelumnya**. Pantau tab **Actions → Deploy master to
VPS**. Workflow juga bisa dijalankan ulang melalui **Run workflow** pada master.
Belum ada deployment yang dilakukan hanya dengan menambahkan berkas ini.

## Menambahkan migrasi berikutnya

1. Buat `database/migrations/YYYYMMDD_nama.sql`.
2. Tambahkan namanya di **akhir** `database/migrations/manifest.txt` sesuai urutan
   dependensi. Manifest menjadi sumber urutan; jangan mengandalkan sort nama.
3. SQL harus transaksional. Wrapper BEGIN/COMMIT terluar boleh ada; runner mengambil
   alih transaksi. Jangan memakai perintah psql, VACUUM, CREATE DATABASE, atau
   CREATE INDEX CONCURRENTLY di migrasi otomatis.
4. Jangan mengubah/menghapus migrasi yang sudah tercatat. Buat berkas baru untuk
   koreksi. Checksum berbeda menghentikan deployment.

Migrasi historis tanpa tanggal sengaja tidak dimasukkan ke manifest: sebagian
bersifat sekali jalan dan sudah tercakup di schema awal. Dua migrasi bertanggal
saat ini aman dijalankan ulang saat pertama kali ledger dibuat, termasuk jika
sebelumnya sudah dijalankan manual. Untuk migrasi baru, gunakan runner ini sejak
awal; menjalankan manual tidak menambahkan ledger otomatis.

Di VPS, melihat rencana tanpa mengubah database:

```sh
cd /opt/toko
python3 deploy/migrate-pending.py --plan
```

## Operasional setelah otomasi aktif

Workflow menggunakan tag image yang berbeda dari default `toko-api:local`.
Untuk perintah Compose manual setelah deployment sukses, sertakan referensi image
terakhir agar tidak kembali ke image lokal lama:

```sh
cd /opt/toko
docker compose --env-file .env.docker --env-file .deploy/images.env \
  -f compose.yaml -f compose.nginx.yaml ps
docker compose --env-file .env.docker --env-file .deploy/images.env \
  -f compose.yaml -f compose.nginx.yaml logs --tail=100 api frontend
```

Jika deployment gagal, lihat log Actions dan container. Periksa ledger sebelum
mengulang; migrasi yang sukses akan dilewati. `last-successful-commit` diperbarui
hanya setelah health check semua layanan lulus. Jangan gunakan `down -v`.

Referensi: [GitHub Container Registry workflow](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images),
[Compose up](https://docs.docker.com/reference/cli/docker/compose/up/).

## Transisi VPS yang sudah memakai Nginx lokal

Workflow ini mempertahankan nama project `toko`, layanan `nginx`, port `80` dan
`127.0.0.1:18000`, serta volume PostgreSQL. `API_PORT=18080` yang sudah diisi di
`.env.docker` tetap dipertahankan; jangan ubah menjadi 8080 karena port itu dapat
dipakai stack lain seperti `test-docker`. Stack lain tidak dihentikan.

Pada deployment pertama, hanya dua file yang **belum tercatat Git** boleh diadopsi:
`compose.nginx.yaml` dan `deploy/nginx/default.conf`. Keduanya dipindahkan ke
`.deploy/nginx-before-tracking-<waktu>-<pid>/` sebelum checkout konfigurasi baru.
Path dan isi konfigurasi lama tersimpan di backup; file `.env.docker` tetap ada.
Perubahan file tracked dan file untracked lain tetap menghentikan deployment.
Pastikan isi file lokal memang sesuai konfigurasi Nginx yang sudah ditinjau sebelum
menjalankan workflow ini. Jika checkout/deployment terhenti, backup tetap tersedia.

Nginx baru memakai resolver DNS Docker agar dapat menemukan IP API/frontend baru
setelah container diperbarui. Saat konfigurasi Nginx berubah, skrip membuat ulang
container Nginx agar bind mount membaca file terbaru. Skrip juga memeriksa `/` dan
`/api/v1/setup` melalui `http://127.0.0.1:18000` sebelum menandai deployment sukses.
Frontend/API menunggu health check; downtime singkat masih dapat terjadi ketika
container diganti. Domain provider tidak diubah otomatis oleh workflow.

Setelah kode perubahan ini di-push ke `master`, jalankan workflow **terbaru**.
Re-run job dari commit lama masih memakai skrip Caddy/penanganan file yang lama.
