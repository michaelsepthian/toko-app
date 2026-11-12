package dto

import (
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type ShoppingItemRequest struct {
	ProdukID   *int64           `json:"produk_id"`
	NamaBarang string           `json:"nama_barang"`
	Jumlah     *decimal.Decimal `json:"jumlah"`
	Satuan     string           `json:"satuan"`
	Catatan    string           `json:"catatan"`
}

func (r ShoppingItemRequest) Input() service.ShoppingItemInput { return service.ShoppingItemInput(r) }

type ShoppingBatchRequest struct {
	IdempotencyKey    string                `json:"idempotency_key"`
	Tanggal           string                `json:"tanggal"`
	SumberPembelianID *int64                `json:"sumber_pembelian_id"`
	Items             []ShoppingItemRequest `json:"items"`
}

func (r ShoppingBatchRequest) Input() service.ShoppingBatchInput {
	return service.ShoppingBatchInput{IdempotencyKey: r.IdempotencyKey, Tanggal: r.Tanggal, SumberPembelianID: r.SumberPembelianID,
		Items: Map(r.Items, func(item ShoppingItemRequest) service.ShoppingItemInput { return item.Input() })}
}

type ShoppingMoveRequest struct {
	IDs               []int64 `json:"ids"`
	SumberPembelianID *int64  `json:"sumber_pembelian_id"`
	Tanggal           string  `json:"tanggal"`
}

func (r ShoppingMoveRequest) Input() service.ShoppingMoveInput { return service.ShoppingMoveInput(r) }

type ShoppingItemResponse struct {
	BaseResponse
	AuditResponse
	Tanggal           string           `json:"tanggal"`
	SumberPembelianID *int64           `json:"sumber_pembelian_id"`
	ProdukID          *int64           `json:"produk_id"`
	NamaBarang        string           `json:"nama_barang"`
	Jumlah            *decimal.Decimal `json:"jumlah"`
	Satuan            string           `json:"satuan"`
	Catatan           string           `json:"catatan"`
	DibeliAt          *time.Time       `json:"dibeli_at"`
	DibeliBy          *int64           `json:"dibeli_by"`
}

func ShoppingItem(row model.RencanaBelanjaItem) ShoppingItemResponse {
	return ShoppingItemResponse{BaseResponse: base(row.Base), AuditResponse: audit(row.Audit), Tanggal: string(row.Tanggal),
		SumberPembelianID: row.SumberPembelianID, ProdukID: row.ProdukID, NamaBarang: row.NamaBarang,
		Jumlah: row.Jumlah, Satuan: row.Satuan, Catatan: row.Catatan, DibeliAt: row.DibeliAt, DibeliBy: row.DibeliBy}
}

type ShoppingSourceResponse struct {
	ID    int64  `json:"id"`
	Nama  string `json:"nama"`
	Aktif bool   `json:"aktif"`
}

func ShoppingSource(row model.SumberPembelian) ShoppingSourceResponse {
	return ShoppingSourceResponse{ID: row.ID, Nama: row.Nama, Aktif: row.Aktif}
}

type ShoppingCalendarResponse struct {
	Tanggal     string `json:"tanggal"`
	TotalItem   int64  `json:"total_item"`
	SudahDibeli int64  `json:"sudah_dibeli"`
}

func ShoppingCalendar(row service.ShoppingCalendarDay) ShoppingCalendarResponse {
	return ShoppingCalendarResponse{Tanggal: string(row.Tanggal), TotalItem: row.TotalItem, SudahDibeli: row.SudahDibeli}
}
