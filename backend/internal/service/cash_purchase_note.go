package service

import (
	"context"
	"errors"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
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
	err = s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "cash-note:"+in.IdempotencyKey).Error; err != nil {
			return err
		}
		found := tx.Where("idempotency_key = ?", in.IdempotencyKey).Take(&row).Error
		if found == nil {
			if row.PenggunaID != userID || row.RequestHash != hash {
				return apperror.Conflict("Identitas catatan belanja sudah dipakai untuk data berbeda")
			}
			return nil
		}
		if !errors.Is(found, gorm.ErrRecordNotFound) {
			return found
		}
		row = model.CatatanBelanja{Audit: model.NewAudit(userID), IdempotencyKey: in.IdempotencyKey, RequestHash: hash, Tanggal: model.ReportDate(date.Format("2006-01-02")), Total: in.Total, Catatan: strings.TrimSpace(in.Catatan), PenggunaID: userID, Status: "TERBUKA"}
		return tx.Create(&row).Error
	})
	return row, err
}
func (s *Service) CancelCashPurchaseNote(ctx context.Context, userID, id int64) error {
	return s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row model.CatatanBelanja
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, id).Error; err != nil {
			return err
		}
		if row.Status != "TERBUKA" {
			return apperror.Conflict("Hanya catatan belanja yang belum dirinci yang dapat dibatalkan")
		}
		return tx.Model(&row).Updates(map[string]any{"status": "BATAL", "updated_by": userID, "cancel_transaction_at": gorm.Expr("CURRENT_TIMESTAMP"), "cancel_transaction_by": userID}).Error
	})
}
