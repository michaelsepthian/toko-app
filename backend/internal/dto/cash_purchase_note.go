package dto

import (
	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type CashPurchaseNoteRequest struct {
	IdempotencyKey string          `json:"idempotency_key"`
	Tanggal        string          `json:"tanggal"`
	Total          decimal.Decimal `json:"total"`
	Catatan        string          `json:"catatan"`
}

func (r CashPurchaseNoteRequest) Input() service.CashPurchaseNoteInput {
	return service.CashPurchaseNoteInput(r)
}

type CashPurchaseNoteResponse struct {
	BaseResponse
	AuditResponse
	CancellationResponse
	Tanggal     string          `json:"tanggal"`
	Total       decimal.Decimal `json:"total"`
	Catatan     string          `json:"catatan"`
	PenggunaID  int64           `json:"pengguna_id"`
	Status      string          `json:"status"`
	PembelianID *int64          `json:"pembelian_id"`
}

func CashPurchaseNote(row model.CatatanBelanja) CashPurchaseNoteResponse {
	return CashPurchaseNoteResponse{BaseResponse: BaseResponse{ID: row.ID, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}, AuditResponse: audit(row.Audit),
		CancellationResponse: cancellation(row.Cancellation), Tanggal: string(row.Tanggal), Total: row.Total,
		Catatan: row.Catatan, PenggunaID: row.PenggunaID, Status: string(row.Status), PembelianID: row.PembelianID}
}
