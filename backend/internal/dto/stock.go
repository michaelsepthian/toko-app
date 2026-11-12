package dto

import (
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type StockRequest struct {
	Jenis     string          `json:"jenis"`
	Perubahan decimal.Decimal `json:"perubahan"`
	Catatan   string          `json:"catatan"`
}

func (r StockRequest) Input() service.StockInput { return service.StockInput(r) }

type StockResponse struct {
	ID          int64           `json:"id"`
	SKU         string          `json:"sku"`
	Nama        string          `json:"nama"`
	StokMinimum decimal.Decimal `json:"stok_minimum"`
	Stok        decimal.Decimal `json:"stok"`
}

func Stock(row service.StockRow) StockResponse {
	return StockResponse{ID: row.ID, SKU: row.SKU, Nama: row.Nama, StokMinimum: row.StokMinimum, Stok: row.Stok}
}

type StockSummaryResponse struct {
	ID          int64           `json:"id"`
	Stok        decimal.Decimal `json:"stok"`
	StokMinimum decimal.Decimal `json:"stok_minimum"`
}

func StockSummary(row service.StockRow) StockSummaryResponse {
	return StockSummaryResponse{ID: row.ID, Stok: row.Stok, StokMinimum: row.StokMinimum}
}

type MovementResponse struct {
	ID                int64           `json:"id"`
	ProdukID          int64           `json:"produk_id"`
	PenggunaID        int64           `json:"pengguna_id"`
	DetailPenjualanID *int64          `json:"detail_penjualan_id"`
	DetailPembelianID *int64          `json:"detail_pembelian_id"`
	Tanggal           time.Time       `json:"tanggal"`
	Jenis             string          `json:"jenis"`
	Perubahan         decimal.Decimal `json:"perubahan"`
	Catatan           *string         `json:"catatan"`
	CreatedAt         time.Time       `json:"created_at"`
}

func Movement(row model.MutasiStok) MovementResponse {
	return MovementResponse{ID: row.ID, ProdukID: row.ProdukID, PenggunaID: row.PenggunaID,
		DetailPenjualanID: row.DetailPenjualanID, DetailPembelianID: row.DetailPembelianID,
		Tanggal: row.Tanggal, Jenis: string(row.Jenis), Perubahan: row.Perubahan, Catatan: row.Catatan, CreatedAt: row.CreatedAt}
}
