# Belajar Go melalui backend toko

Mulai dari satu request kecil, misalnya `GET /api/v1/produk`. Setelah memahami
alur tersebut, lanjutkan ke pembuatan penjualan yang melibatkan beberapa tabel.

## 1. Program dimulai dari mana?

Buka `cmd/api/main.go`. Dalam Go, program executable dimulai dari fungsi `main`
pada `package main`. Fungsi `main` memanggil `run`, sehingga proses persiapan dapat
mengembalikan `error` dan diuji/dibaca lebih mudah.

Urutannya: baca konfigurasi → buka koneksi database → buat repository → bangun
router HTTP → jalankan server. Saat menerima SIGTERM/Ctrl+C, server memberi waktu
request aktif untuk selesai sebelum koneksi database ditutup.

Konfigurasi pada `internal/config/config.go` memakai `godotenv.Read` untuk membaca
file `.env` sebagai map. Untuk setiap variabel, `os.LookupEnv` diperiksa dahulu:
pengaturan shell/hosting mengalahkan file lokal. Library tidak mengubah environment
global, dan error hanya menyebut nama variabel yang kurang tanpa mencetak nilainya.

`defer pool.Close()` berarti fungsi penutup dipanggil ketika `run` selesai.
Ini membantu agar resource tidak tertinggal pada jalur normal maupun ketika error.

## 2. Apa itu package, module, dan internal?

`go.mod` menyatakan nama module `toko/backend` dan versi dependency. Satu folder
Go umumnya merupakan satu package. Folder `internal` membatasi package agar tidak
diimpor sembarang proyek di luar induknya.

Pemisahan package di sini berdasarkan tanggung jawab nyata, tanpa menambahkan
interface untuk setiap struct. Interface baru berguna ketika benar-benar perlu
mengganti implementasi, misalnya mengganti penyedia pembayaran atau penyimpanan.

## 3. Struct dan pemetaan tabel

Lihat `internal/model/product.go`:

```go
type Produk struct {
    Base
    Nama string `json:"nama"`
    HargaJual decimal.Decimal `json:"harga_jual" gorm:"type:numeric(18,2)"`
}
```

Contoh di atas merupakan potongan, bukan seluruh struct. `struct` mengelompokkan
data yang berkaitan. `Base` di-embed sehingga field ID dan timestamp bisa dipakai
ulang. Tag `json` menentukan nama saat encoding JSON; tag `gorm` mengatur pemetaan
database. `TableName()` memastikan nama tabel sama dengan SQL, bukan pluralisasi
otomatis GORM.

Model dipisah per domain dalam satu package `model`. Respons HTTP **tidak**
mengirim struct model ini langsung: `internal/dto/` memiliki struct respons dan
mapper sendiri. Dengan begitu, kolom database baru tidak otomatis menjadi field API.

Field seperti `*string` dapat bernilai `nil`, cocok untuk kolom SQL yang opsional.
Field `string` biasa bernilai awal `""`; `bool` bernilai awal `false`.
Itulah alasan field `aktif` harus dikirim secara eksplisit pada input master.

`Subtotal` pada detail memiliki tag `gorm:"->"`: hanya dibaca karena PostgreSQL
menghitungnya sebagai generated column. Backend tidak mencoba menulis kolom itu.

## 4. Mengapa nominal bukan float64?

Bilangan desimal seperti 0,1 tidak selalu bisa direpresentasikan tepat dalam
floating point biner. Untuk uang kita memakai `decimal.Decimal`, yang juga
mendukung `database/sql` sehingga bisa dibaca/ditulis lewat GORM.

```go
subtotal := jumlah.Mul(harga).Sub(diskon).Round(2)
```

`Round(2)` mengikuti pembulatan nominal detail ke dua desimal. Trigger biaya
pembayaran pada SQL memakai `round(..., 0)` karena biaya dibulatkan ke rupiah penuh.
Frontend sebaiknya memakai pustaka decimal yang sesuai dan mengikuti aturan yang
sama. JSON nominal pada respons berupa string, misalnya `"15000"`.

## 5. Dari request HTTP ke data

Lihat `internal/httpapi/router.go` dan `master.go`. Kita memakai `net/http` standar,
termasuk routing method/path dari Go 1.22+. Contoh:

```go
mux.HandleFunc("GET /api/v1/produk/{id}", handler)
```

`http.ResponseWriter` untuk menulis respons; `*http.Request` berisi request.
Path parameter dibaca melalui `r.PathValue("id")`, kemudian divalidasi sebelum
dipakai. Query SQL memakai placeholder `?`, sehingga nilai input tidak dirangkai
menjadi teks SQL.

`decode` menolak field JSON tidak dikenal dan membatasi ukuran body. DTO merupakan
struct input yang hanya berisi field yang boleh diatur client. Client tidak boleh
mengirim `pengguna_id`, nomor struk, tarif, atau status transaksi.

Data master memakai helper generik `resource` dengan tipe request, command bisnis,
model, dan respons. Handler meneruskan request ke `MasterService`, lalu memetakan
hasilnya ke DTO. Ini mengurangi pengulangan CRUD sederhana. Logika transaksi
tetap ditulis eksplisit karena aturan bisnisnya jauh berbeda dari CRUD master.

Query berada di `internal/repository/`, bukan di handler atau service. Interface
`masterRepository` didefinisikan di service sebagai pemakai; unit test dapat
memasukkan repository in-memory tanpa membuat interface untuk setiap tabel.

## 6. Autentikasi dan otorisasi

Middleware memvalidasi signature dan klaim Bearer JWT, lalu mencari
sesi yang belum kedaluwarsa dan pengguna yang masih aktif. Hanya hash refresh token yang
disimpan di database. Profil dimasukkan ke context request; middleware `owner`
memeriksa peran sebelum operasi khusus pemilik.

Registrasi dan login berada di `service/registration.go`. Password dibuat menjadi
hash bcrypt, lalu diperiksa dengan `CompareHashAndPassword`. Username pertama
menjadi pemilik secara atomik dengan advisory lock. Role tidak diterima dari
frontend. Nama profil diisi dari username agar kompatibel dengan tabel yang ada.
Akun memakai username dan password lokal. JWT berlaku 30 menit; cookie refresh
HttpOnly merotasi token otomatis sampai batas sesi absolut 17 jam.

## 7. Service: alur bisnis penjualan

Buka `internal/service/transaction.go`, fungsi `CreateSale` dan `CreatePurchase`:

1. Validasi metode, jumlah item, nominal, dan produk duplikat.
2. Mulai unit of work menggunakan `Store.Transaction`; callback menerima repository.
3. Kunci seluruh produk yang terlibat, urut berdasarkan ID.
4. Baca harga jual dari database dan validasi produk/metode pembayaran.
5. Hitung subtotal detail, jumlahkan, lalu periksa diskon transaksi.
6. Buat header `DRAFT`. Trigger SQL mengambil snapshot tarif dan menghitung biaya.
7. Baca header kembali untuk memperoleh hasil trigger; validasi pembayaran cukup.
8. Simpan detail dan mutasi pengurangan stok.
9. Ubah header menjadi `SELESAI`, lalu baca kembali beserta detailnya.
10. Callback sukses mengakibatkan COMMIT; error mengakibatkan ROLLBACK.

`return err` dalam callback bukan sekadar menghentikan fungsi: GORM membatalkan
seluruh transaksi, termasuk header, detail, dan mutasi yang sudah sempat ditulis.
Namun sequence PostgreSQL tidak di-rollback; nomor yang melompat itu normal.

Pembelian memakai alur serupa, dengan harga beli dari input pemilik dan mutasi positif.
Kita tidak memakai goroutine untuk memparalelkan query dalam satu transaksi karena
semua operasi bergantung pada koneksi dan urutan yang konsisten.

## 8. Mengapa perlu row lock?

Misalnya stok tinggal satu, dan dua kasir menjual barang itu bersamaan. Bila
keduanya hanya membaca stok tanpa lock, keduanya dapat melihat angka satu.

`repository.LockProducts` memakai `SELECT ... FOR UPDATE`. Kasir kedua menunggu
sampai transaksi kasir pertama selesai, kemudian membaca stok yang sudah berubah.
Semua penulis stok mengambil lock produk, termasuk pembelian, pembatalan, dan
penyesuaian. Pengurutan ID membantu menghindari deadlock ketika transaksi berisi
beberapa produk dalam urutan berbeda.

Lock ini menjaga aturan aplikasi ketika semua penulis mengikuti protokol yang
sama. Ia tidak melindungi dari SQL manual yang mengubah mutasi tanpa mengunci produk.

## 9. Context, pointer, receiver, dan error

- `ctx context.Context` membawa pembatalan/deadline request sampai query database.
  Query dapat dibatalkan saat client putus atau batas waktunya tercapai.
- Receiver `(s *Service)` berarti fungsi adalah method milik `Service`, dengan
  pointer ke instance yang menyimpan dependency repository.
- Return `(model.Penjualan, error)` atau `(model.Pembelian, error)` mengembalikan
  hasil bertipe tanpa type assertion. Adapter `(any, error)` hanya ada pada
  fixture test lama, bukan pada service produksi.
- Pola `if err != nil { return err }` membuat alur error eksplisit. Error bisnis
  memakai `apperror`; error database diterjemahkan ke HTTP pada satu tempat.
- `nil` pada error berarti operasi berhasil. Error bukan exception; `panic`
  dicadangkan untuk kondisi tidak terduga dan ditangkap middleware sebagai batas terakhir.

## 10. Membaca pengujian

Mulai dari `test/unit/service/validation_test.go`: table-driven test memeriksa beberapa input dan
hasil tanpa database. `http_test.go` memakai `httptest` untuk memeriksa JSON, auth,
dan CORS tanpa menjalankan server sungguhan.

Registrasi sederhana langsung memanggil backend dengan username/password.
Test memastikan dua registrasi bersamaan hanya menghasilkan satu pemilik, password
salah ditolak, dan token tidak dapat digunakan lagi setelah logout/kedaluwarsa.

`test/integration/service/integration_test.go` menjalankan SQL asli dan GORM pada PostgreSQL lokal. Test
konkurensi memakai dua goroutine yang dilepas bersamaan oleh channel untuk
memeriksa konsistensi transaksi dan mutasi. Penjualan tetap boleh membuat stok
negatif; lock menjaga urutan perubahan, bukan melarang penjualan saat stok kurang.

Latihan yang bisa dikerjakan berikutnya: tambah pencarian produk berdasarkan SKU,
filter tanggal riwayat penjualan, laporan penjualan harian, lalu idempotency key
untuk mencegah submit ganda ketika jaringan terputus. Setiap perubahan sebaiknya
memiliki test yang memeriksa perilaku bisnis yang ingin dijamin.

Test black-box dan integrasi ditempatkan di `test/`. Unit test yang mengakses
fungsi private, seperti cache internal dan validasi command, tetap berada di
package asal. Go tidak mengizinkan package lain mengakses fungsi private hanya
karena file tersebut berakhiran `_test.go`. `go test ./...` tetap menemukan semua
suite; gunakan `make test-unit` atau `make test-integration` untuk memilih jenisnya.


## Menyimpan banyak detail dengan batch insert GORM

Go menggunakan slice untuk menampung banyak model. Pada helper penjualan dan
pembelian, detail dikumpulkan dahulu lalu dikirim ke `CreateSaleDetails` atau
`CreatePurchaseDetails` milik repository. Repository menjalankan satu batch INSERT
dan mengisi ID detail dari PostgreSQL. Service menyusun mutasi menggunakan ID
tersebut, lalu memanggil `CreateMovements` untuk batch INSERT berikutnya.

Perulangan tetap digunakan untuk menyiapkan data di memori, tetapi tidak lagi menjalankan query untuk setiap item. Untuk N item, bagian penyimpanan detail dan mutasi berubah dari 2N INSERT menjadi 2 INSERT. Header, pembacaan data, dan perubahan status tetap memiliki query tersendiri. Jumlah item dibatasi 200 oleh validasi request.

Keduanya menggunakan transaksi database `tx` yang sama. Bila penyimpanan mutasi gagal, detail dan header ikut dibatalkan. Gunakan `Create` untuk data baru; `Save` juga bisa melakukan update berdasarkan primary key sehingga tidak sesuai untuk detail transaksi baru ini. Untuk data yang jauh lebih banyak, GORM menyediakan `CreateInBatches(&models, batchSize)`.
