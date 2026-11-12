package model

import "github.com/shopspring/decimal"

type Kategori struct {
	Base
	Audit
	Nama      string  `json:"nama"`
	Deskripsi *string `json:"deskripsi"`
}

func (Kategori) TableName() string { return "kategori" }

type Satuan struct {
	Base
	Audit
	Nama string `json:"nama"`
}

func (Satuan) TableName() string { return "satuan" }

type Produk struct {
	Base
	Audit
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
