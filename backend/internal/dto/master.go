package dto

import (
	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
)

type CategoryResponse struct {
	BaseResponse
	AuditResponse
	Nama      string  `json:"nama"`
	Deskripsi *string `json:"deskripsi"`
}

func Category(row model.Kategori) CategoryResponse {
	return CategoryResponse{BaseResponse: base(row.Base), AuditResponse: audit(row.Audit), Nama: row.Nama, Deskripsi: row.Deskripsi}
}

type UnitResponse struct {
	BaseResponse
	AuditResponse
	Nama string `json:"nama"`
}

func Unit(row model.Satuan) UnitResponse {
	return UnitResponse{BaseResponse: base(row.Base), AuditResponse: audit(row.Audit), Nama: row.Nama}
}

type ProductResponse struct {
	BaseResponse
	AuditResponse
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

func Product(row model.Produk) ProductResponse {
	return ProductResponse{
		BaseResponse: base(row.Base), AuditResponse: audit(row.Audit),
		KategoriID: row.KategoriID, SatuanID: row.SatuanID, SKU: row.SKU, Barcode: row.Barcode,
		Nama: row.Nama, HargaJual: row.HargaJual, StokMinimum: row.StokMinimum, Aktif: row.Aktif, IsFavorit: row.IsFavorit,
	}
}

type SourceResponse struct {
	BaseResponse
	AuditResponse
	Nama               string  `json:"nama"`
	Jenis              string  `json:"jenis"`
	NamaTokoPerusahaan *string `json:"nama_toko_perusahaan"`
	NamaKontak         *string `json:"nama_kontak"`
	NomorTelepon       *string `json:"nomor_telepon"`
	Alamat             *string `json:"alamat"`
	Catatan            *string `json:"catatan"`
	Aktif              bool    `json:"aktif"`
}

func Source(row model.SumberPembelian) SourceResponse {
	return SourceResponse{
		BaseResponse: base(row.Base), AuditResponse: audit(row.Audit), Nama: row.Nama, Jenis: string(row.Jenis),
		NamaTokoPerusahaan: row.NamaTokoPerusahaan, NamaKontak: row.NamaKontak, NomorTelepon: row.NomorTelepon,
		Alamat: row.Alamat, Catatan: row.Catatan, Aktif: row.Aktif,
	}
}

type PaymentResponse struct {
	BaseResponse
	AuditResponse
	Jenis           string          `json:"jenis"`
	Nama            string          `json:"nama"`
	TarifPersen     decimal.Decimal `json:"tarif_persen"`
	TarifTetap      decimal.Decimal `json:"tarif_tetap"`
	PenanggungBiaya string          `json:"penanggung_biaya"`
	UntukPenjualan  bool            `json:"untuk_penjualan"`
	UntukPembelian  bool            `json:"untuk_pembelian"`
	Aktif           bool            `json:"aktif"`
}

func Payment(row model.MetodePembayaran) PaymentResponse {
	return PaymentResponse{
		BaseResponse: base(row.Base), AuditResponse: audit(row.Audit), Jenis: string(row.Jenis), Nama: row.Nama,
		TarifPersen: row.TarifPersen, TarifTetap: row.TarifTetap, PenanggungBiaya: string(row.PenanggungBiaya),
		UntukPenjualan: row.UntukPenjualan, UntukPembelian: row.UntukPembelian, Aktif: row.Aktif,
	}
}

func base(row model.Base) BaseResponse {
	return BaseResponse{ID: row.ID, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

func audit(row model.Audit) AuditResponse {
	return AuditResponse{CreatedBy: row.CreatedBy, UpdatedBy: row.UpdatedBy}
}

type MasterDataResponse struct {
	Version    string             `json:"version"`
	Categories []CategoryResponse `json:"categories"`
	Units      []UnitResponse     `json:"units"`
	Payments   []PaymentResponse  `json:"payments"`
	Sources    []SourceResponse   `json:"sources"`
}

type ProductPageResponse struct {
	Items           []ProductResponse `json:"items"`
	HasNext         bool              `json:"has_next"`
	NextCursor      *string           `json:"next_cursor"`
	Version         string            `json:"version"`
	CacheTTLSeconds int64             `json:"cache_ttl_seconds"`
}

type ProductPopularityResponse struct {
	ProdukID  int64 `json:"produk_id"`
	Transaksi int64 `json:"transaksi"`
}
