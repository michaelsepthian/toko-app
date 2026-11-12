package model

import "github.com/shopspring/decimal"

type Penjualan struct {
	Header
	TanggalPendapatan ReportDate        `json:"tanggal_pendapatan" gorm:"type:date;default:(-)"`
	PenanggungBiaya   FeeBearer         `json:"penanggung_biaya"`
	TotalTagihan      decimal.Decimal   `json:"total_tagihan"`
	JumlahDibayar     decimal.Decimal   `json:"jumlah_dibayar"`
	Kembalian         decimal.Decimal   `json:"kembalian"`
	Detail            []DetailPenjualan `json:"detail" gorm:"foreignKey:PenjualanID"`
}

func (Penjualan) TableName() string { return "penjualan" }

type DetailPenjualan struct {
	Detail
	PenjualanID int64           `json:"penjualan_id"`
	HargaJual   decimal.Decimal `json:"harga_jual"`
}

func (DetailPenjualan) TableName() string { return "detail_penjualan" }
