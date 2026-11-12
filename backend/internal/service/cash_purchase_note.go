package service

import (
	"context"
	"github.com/shopspring/decimal"
	"strings"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type CashPurchaseNoteInput struct {
	IdempotencyKey string          `json:"idempotency_key"`
	Tanggal        string          `json:"tanggal"`
	Total          decimal.Decimal `json:"total"`
	Catatan        string          `json:"catatan"`
}

func (s *Service) CreateCashPurchaseNote(ctx context.Context, userID int64, in CashPurchaseNoteInput) (model.CatatanBelanja, error) {
	var row model.CatatanBelanja
	if !summaryUUID.MatchString(in.IdempotencyKey) || !Money(in.Total) || !in.Total.IsPositive() || len(in.Catatan) > 2000 {
		return row, apperror.Invalid("Isi total pengeluaran yang positif, tanggal dan catatan yang valid")
	}
	date, _, err := SummaryDay(in.Tanggal, time.Now())
	if err != nil {
		return row, err
	}
	hash := digest(in)
	err = s.Store.Transaction(ctx, func(tx *repository.Store) error {
		if err := tx.LockRequest("cash-note:" + in.IdempotencyKey); err != nil {
			return err
		}
		var found error
		row, found = tx.CashNoteByKey(in.IdempotencyKey)
		if found == nil {
			if row.PenggunaID != userID || row.RequestHash != hash {
				return apperror.Conflict("Identitas catatan belanja sudah dipakai untuk data berbeda")
			}
			return nil
		}
		if !repository.IsNotFound(found) {
			return found
		}
		row = model.CatatanBelanja{Audit: model.NewAudit(userID), IdempotencyKey: in.IdempotencyKey, RequestHash: hash, Tanggal: model.ReportDate(date.Format("2006-01-02")), Total: in.Total, Catatan: strings.TrimSpace(in.Catatan), PenggunaID: userID, Status: "TERBUKA"}
		return tx.CreateCashNote(&row)
	})
	return row, err
}
func (s *Service) CancelCashPurchaseNote(ctx context.Context, userID, id int64) error {
	return s.Store.Transaction(ctx, func(tx *repository.Store) error {
		row, err := tx.LockCashNote(id)
		if err != nil {
			return err
		}
		if row.Status != "TERBUKA" {
			return apperror.Conflict("Hanya catatan belanja yang belum dirinci yang dapat dibatalkan")
		}
		return tx.CancelCashNote(id, userID)
	})
}
