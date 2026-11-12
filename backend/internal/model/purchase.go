package model

import "github.com/shopspring/decimal"

type Pembelian struct {
	Header
	SumberPembelianID *int64            `json:"sumber_pembelian_id"`
	NomorNota         *string           `json:"nomor_nota"`
	TotalPembayaran   decimal.Decimal   `json:"total_pembayaran"`
	Detail            []DetailPembelian `json:"detail" gorm:"foreignKey:PembelianID"`
}

func (Pembelian) TableName() string { return "pembelian" }

type DetailPembelian struct {
	Detail
	PembelianID int64           `json:"pembelian_id"`
	HargaBeli   decimal.Decimal `json:"harga_beli"`
}

func (DetailPembelian) TableName() string { return "detail_pembelian" }
