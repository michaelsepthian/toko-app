package dto

import (
	"github.com/shopspring/decimal"
	"toko/backend/internal/service"
)

type NameRequest struct {
	Nama      string  `json:"nama"`
	Deskripsi *string `json:"deskripsi,omitempty"`
}

func (r NameRequest) Input() service.NameInput { return service.NameInput(r) }

type ProductRequest struct {
	KategoriID  int64           `json:"kategori_id"`
	SatuanID    int64           `json:"satuan_id"`
	SKU         string          `json:"sku"`
	Barcode     *string         `json:"barcode"`
	Nama        string          `json:"nama"`
	HargaJual   decimal.Decimal `json:"harga_jual"`
	StokMinimum decimal.Decimal `json:"stok_minimum"`
	Aktif       bool            `json:"aktif"`
	IsFavorit   bool            `json:"is_favorit"`
}

func (r ProductRequest) Input() service.ProductInput { return service.ProductInput(r) }

type SourceRequest struct {
	Nama               string  `json:"nama"`
	Jenis              string  `json:"jenis"`
	NamaTokoPerusahaan *string `json:"nama_toko_perusahaan"`
	NamaKontak         *string `json:"nama_kontak"`
	NomorTelepon       *string `json:"nomor_telepon"`
	Alamat             *string `json:"alamat"`
	Catatan            *string `json:"catatan"`
	Aktif              bool    `json:"aktif"`
}

func (r SourceRequest) Input() service.SourceInput { return service.SourceInput(r) }

type PaymentRequest struct {
	Jenis           string          `json:"jenis"`
	Nama            string          `json:"nama"`
	TarifPersen     decimal.Decimal `json:"tarif_persen"`
	TarifTetap      decimal.Decimal `json:"tarif_tetap"`
	PenanggungBiaya string          `json:"penanggung_biaya"`
	UntukPenjualan  bool            `json:"untuk_penjualan"`
	UntukPembelian  bool            `json:"untuk_pembelian"`
	Aktif           bool            `json:"aktif"`
}

func (r PaymentRequest) Input() service.PaymentInput { return service.PaymentInput(r) }
