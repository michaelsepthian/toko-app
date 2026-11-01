// Package model memetakan tabel SQL secara eksplisit. Decimal dipakai agar uang
// tidak terkena kesalahan representasi float64. JSON nominal dikirim sebagai string.
package model

import (
	"github.com/shopspring/decimal"
	"time"
)

type Base struct {
	ID        int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type Pengguna struct {
	Base
	AuthUserID   *string `json:"auth_user_id"`
	Nama         string  `json:"nama"`
	Username     string  `json:"username"`
	PasswordHash *string `json:"-"`
	Peran        string  `json:"peran"`
	Aktif        bool    `json:"aktif"`
}

func (Pengguna) TableName() string { return "pengguna" }

type SesiPengguna struct {
	TokenHash  string    `json:"-" gorm:"primaryKey"`
	PenggunaID int64     `json:"-"`
	ExpiresAt  time.Time `json:"expires_at"`
	CreatedAt  time.Time `json:"created_at"`
}

func (SesiPengguna) TableName() string { return "sesi_pengguna" }

type Kategori struct {
	Base
	Nama      string  `json:"nama"`
	Deskripsi *string `json:"deskripsi"`
}

func (Kategori) TableName() string { return "kategori" }

type Satuan struct {
	Base
	Nama string `json:"nama"`
}

func (Satuan) TableName() string { return "satuan" }

type Produk struct {
	Base
	KategoriID  int64           `json:"kategori_id"`
	SatuanID    int64           `json:"satuan_id"`
	SKU         string          `json:"sku" gorm:"column:sku"`
	Barcode     *string         `json:"barcode"`
	Nama        string          `json:"nama"`
	HargaJual   decimal.Decimal `json:"harga_jual" gorm:"type:numeric(18,2)"`
	StokMinimum decimal.Decimal `json:"stok_minimum" gorm:"type:numeric(18,3)"`
	Aktif       bool            `json:"aktif"`
	IsFavorit   bool            `json:"is_favorit"`
}

func (Produk) TableName() string { return "produk" }

type SumberPembelian struct {
	Base
	Nama               string  `json:"nama"`
	Jenis              string  `json:"jenis"`
	NamaTokoPerusahaan *string `json:"nama_toko_perusahaan"`
	NamaKontak         *string `json:"nama_kontak"`
	NomorTelepon       *string `json:"nomor_telepon"`
	Alamat             *string `json:"alamat"`
	Catatan            *string `json:"catatan"`
	Aktif              bool    `json:"aktif"`
}

func (SumberPembelian) TableName() string { return "sumber_pembelian" }

type MetodePembayaran struct {
	Base
	Jenis           string          `json:"jenis" gorm:"default:LAINNYA"`
	Nama            string          `json:"nama"`
	TarifPersen     decimal.Decimal `json:"tarif_persen" gorm:"type:numeric(7,4)"`
	TarifTetap      decimal.Decimal `json:"tarif_tetap" gorm:"type:numeric(18,2)"`
	PenanggungBiaya string          `json:"penanggung_biaya"`
	UntukPenjualan  bool            `json:"untuk_penjualan"`
	UntukPembelian  bool            `json:"untuk_pembelian"`
	Aktif           bool            `json:"aktif"`
}

func (MetodePembayaran) TableName() string { return "metode_pembayaran" }

// Header berisi kolom bersama penjualan dan pembelian.
// Nomor dan tanggal dihasilkan oleh PostgreSQL saat INSERT.
type Header struct {
	Base
	IdempotencyKey     *string         `json:"idempotency_key,omitempty"`
	RequestHash        string          `json:"-"`
	Nomor              string          `json:"nomor" gorm:"default:(-)"`
	PenggunaID         int64           `json:"pengguna_id"`
	MetodePembayaranID int64           `json:"metode_pembayaran_id"`
	Tanggal            time.Time       `json:"tanggal" gorm:"default:(-)"`
	Status             string          `json:"status"`
	SubtotalBarang     decimal.Decimal `json:"subtotal_barang"`
	DiskonTransaksi    decimal.Decimal `json:"diskon_transaksi"`
	TotalBelanja       decimal.Decimal `json:"total_belanja"`
	TarifPersen        decimal.Decimal `json:"tarif_persen"`
	TarifTetap         decimal.Decimal `json:"tarif_tetap"`
	BiayaPembayaran    decimal.Decimal `json:"biaya_pembayaran"`
	NomorReferensi     *string         `json:"nomor_referensi"`
	Catatan            *string         `json:"catatan"`
}
type Penjualan struct {
	Header
	TanggalPendapatan ReportDate        `json:"tanggal_pendapatan" gorm:"type:date;default:(-)"`
	PenanggungBiaya   string            `json:"penanggung_biaya"`
	TotalTagihan      decimal.Decimal   `json:"total_tagihan"`
	JumlahDibayar     decimal.Decimal   `json:"jumlah_dibayar"`
	Kembalian         decimal.Decimal   `json:"kembalian"`
	Detail            []DetailPenjualan `json:"detail" gorm:"foreignKey:PenjualanID"`
}

func (Penjualan) TableName() string { return "penjualan" }

type Pembelian struct {
	Header
	SumberPembelianID *int64            `json:"sumber_pembelian_id"`
	NomorNota         *string           `json:"nomor_nota"`
	TotalPembayaran   decimal.Decimal   `json:"total_pembayaran"`
	Detail            []DetailPembelian `json:"detail" gorm:"foreignKey:PembelianID"`
}

func (Pembelian) TableName() string { return "pembelian" }

type Detail struct {
	Base
	NamaProduk string          `json:"nama_produk"`
	ProdukID   int64           `json:"produk_id"`
	Jumlah     decimal.Decimal `json:"jumlah"`
	Diskon     decimal.Decimal `json:"diskon"`
	Subtotal   decimal.Decimal `json:"subtotal" gorm:"->"` // Generated column, read-only.
}
type DetailPenjualan struct {
	Detail
	PenjualanID int64           `json:"penjualan_id"`
	HargaJual   decimal.Decimal `json:"harga_jual"`
}

func (DetailPenjualan) TableName() string { return "detail_penjualan" }

type DetailPembelian struct {
	Detail
	PembelianID int64           `json:"pembelian_id"`
	HargaBeli   decimal.Decimal `json:"harga_beli"`
}

func (DetailPembelian) TableName() string { return "detail_pembelian" }

type MutasiStok struct {
	ID                int64           `json:"id" gorm:"primaryKey;autoIncrement"`
	ProdukID          int64           `json:"produk_id"`
	PenggunaID        int64           `json:"pengguna_id"`
	DetailPenjualanID *int64          `json:"detail_penjualan_id"`
	DetailPembelianID *int64          `json:"detail_pembelian_id"`
	Tanggal           time.Time       `json:"tanggal" gorm:"default:(-)"`
	Jenis             string          `json:"jenis"`
	Perubahan         decimal.Decimal `json:"perubahan"`
	Catatan           *string         `json:"catatan"`
	CreatedAt         time.Time       `json:"created_at"`
}

func (MutasiStok) TableName() string { return "mutasi_stok" }
