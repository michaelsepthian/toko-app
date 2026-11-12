package model

import (
	"time"

	"github.com/shopspring/decimal"
)

type TransactionKind string
type TransactionStatus string

const (
	Sale            TransactionKind   = "penjualan"
	Purchase        TransactionKind   = "pembelian"
	StatusDraft     TransactionStatus = "DRAFT"
	StatusCompleted TransactionStatus = "SELESAI"
	StatusCancelled TransactionStatus = "BATAL"
)

func (k TransactionKind) Valid() bool { return k == Sale || k == Purchase }

// Nomor dan tanggal dihasilkan PostgreSQL saat INSERT.
type Header struct {
	Base
	Audit
	Cancellation
	IdempotencyKey     *string           `json:"idempotency_key,omitempty"`
	RequestHash        string            `json:"-"`
	Nomor              string            `json:"nomor" gorm:"default:(-)"`
	PenggunaID         int64             `json:"pengguna_id"`
	MetodePembayaranID int64             `json:"metode_pembayaran_id"`
	Tanggal            time.Time         `json:"tanggal" gorm:"default:(-)"`
	Status             TransactionStatus `json:"status"`
	SubtotalBarang     decimal.Decimal   `json:"subtotal_barang"`
	DiskonTransaksi    decimal.Decimal   `json:"diskon_transaksi"`
	TotalBelanja       decimal.Decimal   `json:"total_belanja"`
	TarifPersen        decimal.Decimal   `json:"tarif_persen"`
	TarifTetap         decimal.Decimal   `json:"tarif_tetap"`
	BiayaPembayaran    decimal.Decimal   `json:"biaya_pembayaran"`
	NomorReferensi     *string           `json:"nomor_referensi"`
	Catatan            *string           `json:"catatan"`
}

type Detail struct {
	Base
	NamaProduk string          `json:"nama_produk"`
	ProdukID   int64           `json:"produk_id"`
	Jumlah     decimal.Decimal `json:"jumlah"`
	Diskon     decimal.Decimal `json:"diskon"`
	Subtotal   decimal.Decimal `json:"subtotal" gorm:"->"`
}
