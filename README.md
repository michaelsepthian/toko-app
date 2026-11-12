# Aplikasi toko / kasir

Frontend Next.js dan backend Go untuk operasional satu toko. Petunjuk menjalankan
aplikasi tersedia di [`frontend/README.md`](frontend/README.md),
[`backend/README.md`](backend/README.md), dan [`deploy/README.md`](deploy/README.md).

## Peta kode dan alur aplikasi

### Frontend

```text
frontend/
├── app/                         # Halaman, layout, dan stylesheet Next.js
├── components/
│   ├── pos-app.tsx               # Menyatukan sesi, navigasi, dan layar operasional
│   ├── pos/
│   │   ├── auth-gate.tsx         # Login dan registrasi sebelum masuk workspace
│   │   ├── workspace-header.tsx  # Menu, tema, jam toko, dan tombol header
│   │   ├── sale-checkout.tsx     # Koordinasi keranjang dan pembayaran penjualan
│   │   ├── checkout.tsx          # Pembelian
│   │   └── ...                  # UI per fitur: master, riwayat, belanja, perangkat
│   └── ui/                      # Komponen UI yang dipakai lintas fitur
├── lib/
│   ├── use-workspace-data.ts    # Pemuatan master, pemeriksaan versi, dan stok
│   ├── use-*.ts                 # State/effect React untuk satu tanggung jawab
│   ├── api.ts                   # HTTP, sesi, dan cache snapshot master
│   ├── types.ts                 # Kontrak data frontend/backend
│   └── ...                      # Fungsi domain, cache, format uang, printer
└── tests/                       # Unit test dan Playwright
```

Alur pembukaan aplikasi:

```text
app/page.tsx → PosApp → AuthGate → Workspace
                                  ├── useWorkspaceData → API master/stok
                                  ├── WorkspaceHeader → aksi navigasi/perangkat
                                  └── komponen fitur → hook/helper → api.ts
```

Master ringan terpisah dari katalog produk dan stok. Perubahan master membatalkan
cache katalog; stok hanya dimuat ketika dibutuhkan di Pembelian. Komponen penjualan
tetap terpasang saat berpindah menu agar draf keranjang tidak hilang.

### Backend

```text
backend/
├── cmd/api/                     # Startup, dependency wiring, shutdown
├── test/                        # Unit black-box, integrasi, arsitektur, dan helper
└── internal/
    ├── config/                  # Environment dan validasinya
    ├── database/                # Koneksi PostgreSQL
    ├── httpapi/
    │   ├── router.go            # Merangkai route publik dan route terautentikasi
    │   ├── middleware.go        # Request ID, recovery, logging, CORS, timeout
    │   ├── health.go            # Liveness/readiness
    │   ├── session.go           # Profil sesi dan logout
    │   ├── transactions.go      # Endpoint penjualan/pembelian dan pembatalan
    │   ├── stock.go             # Pembacaan dan penyesuaian mutasi stok
    │   └── ...                  # Endpoint fitur lainnya
    ├── dto/                     # Request/response HTTP dan mapper eksplisit
    ├── service/
    │   ├── transaction.go       # CreateSale/CreatePurchase dan koordinasi bisnis
    │   ├── transaction_input.go # Command bisnis dan validasi transaksi
    │   ├── transaction_sale.go  # Penyimpanan penjualan dan mutasi keluar
    │   ├── transaction_purchase.go # Pembelian, mutasi masuk, catatan pengeluaran
    │   ├── transaction_cancel.go # Aturan pembatalan dan pembalikan stok
    │   ├── stock.go             # Aturan stok awal/penyesuaian
    │   └── ...                  # Aturan bisnis per fitur
    ├── repository/              # Seluruh SQL/GORM, persistence, dan lock per domain
    ├── model/                   # user, product, payment, sale, purchase, stock, dll.
    └── apperror/                # Error bisnis yang aman dikirim ke pengguna
```

Alur transaksi:

```text
request → middleware → autentikasi → DTO request → handler (+ cek peran)
  → command service → aturan bisnis → repository
  → validasi input → satu transaksi database:
      replay idempotency → lock catatan/produk/metode → hitung subtotal
      → simpan penjualan atau pembelian → detail → mutasi stok → SELESAI
  → commit → hasil service → mapper DTO response → respons JSON
```

`CreateSale` mengembalikan `model.Penjualan`; `CreatePurchase` mengembalikan
`model.Pembelian`. Pembatalan juga terpisah menjadi `CancelSale`/`CancelPurchase`.
Helper bisnis menerima repository dengan `tx` yang sama melalui
`Store.Transaction`; tidak membuka transaksi baru. Urutan lock, idempotency, total dari trigger,
rollback, dan hak akses harus dipertahankan saat menambah fitur.

Model database tidak diserialisasi langsung oleh handler. DTO respons memiliki
field sendiri dan mapper eksplisit, sehingga penambahan kolom model tidak otomatis
menambah field API. `null`, array kosong, nominal string, dan nama field API lama
dipertahankan dan diperiksa oleh tes kontrak JSON.

Tag JSON pada command idempotent dan snapshot tersimpan sengaja dipertahankan:
mengubahnya dapat mengubah hash retry atau merusak laporan lama. Tag pada model
lama bukan sumber kontrak HTTP; sumber kontraknya adalah `internal/dto/`.

Interface kecil `masterRepository` berada di service sebagai pemakai dan dipakai
untuk unit test tanpa database. Tidak ada interface/salinan entity tambahan untuk
setiap tabel. Integrasi SQL, lock, rollback, dan replay diuji pada PostgreSQL asli.

Autentikasi juga melewati `SessionService`: middleware membaca bearer token,
service memvalidasi signature/klaim JWT dan menentukan penolakan sesi/akun, lalu repository
mencari pengguna aktif dan sesi yang belum kedaluwarsa. Interface kecil
`sessionRepository` memungkinkan aturan ini diuji tanpa HTTP atau PostgreSQL.

## Konvensi kode

- Frontend: indentasi **2 spasi**, single quote, tanpa semicolon; gunakan Prettier.
  Pemeriksaan format mencakup source, CSS, unit test, test browser, dan konfigurasi.
- Backend: gunakan **gofmt** (tab), bukan indentasi manual.
- Pisahkan deklarasi, langkah proses, dan cabang JSX agar tidak padat satu baris.
- Komponen mengurus UI; hook mengurus state/effect; helper domain tidak bergantung
  pada React. Hindari memindahkan semua fitur ke satu komponen utama.
- Handler membaca/menulis HTTP; service mengoordinasikan aturan bisnis; repository
  menjalankan query. Jangan akses `Store.DB` atau import GORM dari handler/service.
  SQL skema
  tetap bersumber dari `database/`, bukan `AutoMigrate`.
- Jangan mengubah bentuk payload API, perhitungan uang, atau perilaku retry hanya
  untuk merapikan kode.

Perintah dari `frontend/`: `npm run format`, `npm run format:check`,
`npm run typecheck`, `npm test`, dan `npm run test:e2e`.

Perintah dari `backend/`: `make fmt`, `make fmt-check`, `make test`, dan `make vet`.
`make test-unit` menjalankan unit test; `make test-integration` mewajibkan
`TEST_DATABASE_URL`. Integrasi dan tes black-box berada di `backend/test/`;
unit test private tetap dekat kode produksi. Lihat `backend/test/README.md`.

Tes arsitektur menjaga arah dependency: model tidak bergantung pada layer lain,
repository tidak bergantung pada service/handler/DTO, dan service tidak bergantung
pada HTTP atau DTO. Tes juga menolak akses ORM dari handler/service serta model
persistence yang disisipkan langsung sebagai field DTO.
