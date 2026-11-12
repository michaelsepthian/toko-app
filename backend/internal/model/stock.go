package model

import (
	"time"

	"github.com/shopspring/decimal"
)

type StockKind string

const (
	StockInitial    StockKind = "AWAL"
	StockAdjustment StockKind = "PENYESUAIAN"
	StockSale       StockKind = "PENJUALAN"
	StockPurchase   StockKind = "PEMBELIAN"
	StockReversal   StockKind = "PEMBALIKAN"
)

type MutasiStok struct {
	ID                int64           `json:"id" gorm:"primaryKey;autoIncrement"`
	ProdukID          int64           `json:"produk_id"`
	PenggunaID        int64           `json:"pengguna_id"`
	DetailPenjualanID *int64          `json:"detail_penjualan_id"`
	DetailPembelianID *int64          `json:"detail_pembelian_id"`
	Tanggal           time.Time       `json:"tanggal" gorm:"default:(-)"`
	Jenis             StockKind       `json:"jenis"`
	Perubahan         decimal.Decimal `json:"perubahan"`
	Catatan           *string         `json:"catatan"`
	CreatedAt         time.Time       `json:"created_at"`
}

func (MutasiStok) TableName() string { return "mutasi_stok" }
