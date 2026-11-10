// Optional untuk cache/fixture lama; respons server mengirim null bila audit belum diketahui.
export type AuditFields = { created_by?: number | null; updated_by?: number | null }
export type CancellationFields = { cancel_transaction_at?: string | null; cancel_transaction_by?: number | null }
export type Amount = string
export type User = { id: number; nama: string; username?: string; peran: 'PEMILIK' | 'KASIR' }
export type SetupStatus = { initialized: boolean; registration_open: boolean }
export type LoginResult = { user: User; access_token: string; expires_at: string }
export type Category = AuditFields & { id: number; nama: string; deskripsi?: string | null }
export type Unit = AuditFields & { id: number; nama: string }
export type Product = AuditFields & { id: number; nama: string; sku: string; barcode: string | null; kategori_id: number; satuan_id: number; harga_jual: Amount; stok_minimum: Amount; aktif: boolean; is_favorit: boolean }
export type Stock = { id: number; stok: Amount; stok_minimum: Amount }
export type Source = AuditFields & { id: number; nama: string; jenis: 'TOKO' | 'SALES'; nama_toko_perusahaan?: string | null; nama_kontak?: string | null; nomor_telepon?: string | null; alamat?: string | null; catatan?: string | null; aktif: boolean }
export type Payment = AuditFields & { id: number; nama: string; jenis: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER' | 'LAINNYA'; tarif_persen: Amount; tarif_tetap: Amount; penanggung_biaya: 'TOKO' | 'PELANGGAN'; untuk_penjualan: boolean; untuk_pembelian: boolean; aktif: boolean }
export type Line = { id: number; produk_id: number; nama_produk: string; jumlah: Amount; diskon: Amount; harga_jual?: Amount; harga_beli?: Amount; subtotal: Amount }
export type Transaction = AuditFields & CancellationFields & { nama_kasir?: string; id: number; nomor: string; tanggal: string; tanggal_pendapatan?: string; status: 'DRAFT' | 'SELESAI' | 'BATAL'; metode_pembayaran_id: number; sumber_pembelian_id?: number | null; subtotal_barang: Amount; diskon_transaksi: Amount; total_belanja: Amount; biaya_pembayaran: Amount; total_tagihan?: Amount; total_pembayaran?: Amount; jumlah_dibayar?: Amount; kembalian?: Amount; penanggung_biaya?: string; detail?: Line[] }
export type CartLine = { product: Product; quantity: string; price: string; discount: string }
export type TransactionInput = { idempotency_key?: string; tanggal_pendapatan?: string; catatan_belanja_id?: number; metode_pembayaran_id: number; diskon_transaksi: Amount; jumlah_dibayar?: Amount; sumber_pembelian_id?: number | null; nomor_nota?: string | null; nomor_referensi?: string | null; catatan?: string | null; items: { produk_id: number; jumlah: Amount; diskon: Amount; harga_beli?: Amount }[] }
export type Data = { products: Product[]; categories: Category[]; units: Unit[]; payments: Payment[]; sources: Source[]; stocks: Stock[] }

export type MasterData = Omit<Data, 'stocks'> & { version: string }

export type DailyPayment = { metode_pembayaran_id: number; nama: string; jenis: Payment['jenis']; jumlah_selesai: number; jumlah_batal: number; total_selesai: Amount; total_batal: Amount; biaya_toko: Amount }
export type DailySnapshot = { versi?: number; total_pembelian?: Amount; alokasi_sebelumnya?: Amount; alokasi_sebelumnya_id?: number | null; selisih_belanja?: Amount; pembelian?: DailyPurchase[]; tanggal: string; dihitung_pada: string; hash_sumber: string; jumlah_selesai: number; jumlah_batal: number; total_selesai: Amount; total_batal: Amount; total_sebelum_pembatalan: Amount; total_cash: Amount; total_non_cash: Amount; biaya_toko: Amount; total_bersih: Amount; pembelian_cash: Amount; pembelian_belum_dirinci: Amount; metode: DailyPayment[] }
export type DailySummaryInput = { versi_perhitungan?: number; idempotency_key: string; tanggal: string; hash_sumber: string; nama_toko: string; email_tujuan: string; kas_aktual: Amount; belanja_besok: Amount; catatan: string }
export type DailySummaryRecord = { id: number; tanggal: string; pengguna_id: number; nama_pencatat: string; nama_toko: string; email_tujuan: string | null; kas_aktual: Amount; belanja_besok: Amount; total_dana_seharusnya: Amount; total_dana_aktual: Amount; kas_seharusnya: Amount; selisih_kas: Amount; sisa_kas: Amount; catatan: string; snapshot: DailySnapshot; created_at: string }
export type DailySummaryEmail = { subject: string; html: string; text: string; to: string | null }

export type CashPurchaseNoteInput = { idempotency_key: string; tanggal: string; total: Amount; catatan: string }
export type CashPurchaseNote = AuditFields & CancellationFields & { id: number; tanggal: string; total: Amount; catatan: string; status: "TERBUKA" | "SELESAI" | "BATAL"; pembelian_id: number | null }

export type DailyPurchase = { catatan_id: number | null; pembelian_id: number | null; nomor: string; metode: string; total: Amount; belum_dirinci: boolean; catatan: string; items: { nama: string; jumlah: Amount; subtotal: Amount }[] }

export type ShoppingSource = { id: number; nama: string; aktif: boolean }
export type ShoppingItem = AuditFields & { id: number; tanggal: string; sumber_pembelian_id: number | null; produk_id: number | null; nama_barang: string; jumlah: Amount | null; satuan: string; catatan: string; dibeli_at: string | null; dibeli_by: number | null }
export type ShoppingDay = { tanggal: string; total_item: number; sudah_dibeli: number }
