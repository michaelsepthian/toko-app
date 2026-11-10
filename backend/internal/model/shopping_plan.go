package model

import (
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// RencanaBelanjaItem tidak memiliki relasi ke pembelian maupun mutasi stok.
type RencanaBelanjaItem struct {
	Base
	Audit
	IdempotencyKey    string           `json:"-"`
	UrutanInput       int              `json:"-"`
	RequestHash       string           `json:"-"`
	Tanggal           ReportDate       `json:"tanggal" gorm:"type:date"`
	SumberPembelianID *int64           `json:"sumber_pembelian_id"`
	ProdukID          *int64           `json:"produk_id"`
	NamaBarang        string           `json:"nama_barang"`
	Jumlah            *decimal.Decimal `json:"jumlah" gorm:"type:numeric(18,3)"`
	Satuan            string           `json:"satuan"`
	Catatan           string           `json:"catatan"`
	DibeliAt          *time.Time       `json:"dibeli_at"`
	DibeliBy          *int64           `json:"dibeli_by"`
	DeletedAt         gorm.DeletedAt   `json:"-"`
	DeletedBy         *int64           `json:"-"`
}

func (RencanaBelanjaItem) TableName() string { return "rencana_belanja_item" }
