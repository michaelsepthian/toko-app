package service

import (
	"context"
	"strings"

	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

func (s *Service) CancelSale(ctx context.Context, userID, id int64, reason string) error {
	return s.cancelTransaction(ctx, userID, id, model.Sale, reason)
}

func (s *Service) CancelPurchase(ctx context.Context, userID, id int64, reason string) error {
	return s.cancelTransaction(ctx, userID, id, model.Purchase, reason)
}

// Mutasi lama tidak dihapus; pembatalan mempertahankan riwayat dan membuat pembalik.
func (s *Service) cancelTransaction(ctx context.Context, userID, id int64, kind model.TransactionKind, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return apperror.Invalid("Alasan pembatalan wajib diisi")
	}
	return s.Store.Transaction(ctx, func(tx *repository.Store) error {
		status, err := tx.LockTransactionStatus(kind, id)
		if err != nil {
			return err
		}
		if status != model.StatusCompleted {
			return apperror.Conflict("Hanya transaksi selesai yang dapat dibatalkan")
		}
		movements, err := tx.TransactionMovements(kind, id)
		if err != nil {
			return err
		}
		if len(movements) == 0 {
			return apperror.Conflict("Transaksi tidak memiliki mutasi stok")
		}
		ids := make([]int64, 0, len(movements))
		for _, movement := range movements {
			ids = append(ids, movement.ProdukID)
		}
		if _, err := tx.LockProducts(ids); err != nil {
			return err
		}
		for _, old := range movements {
			if kind == model.Purchase {
				stock, err := tx.Stock(old.ProdukID)
				if err != nil {
					return err
				}
				if stock.LessThan(old.Perubahan) {
					return apperror.Conflict("Pembelian tidak bisa dibatalkan karena stok sudah digunakan")
				}
			}
			movement := model.MutasiStok{
				ProdukID:          old.ProdukID,
				PenggunaID:        userID,
				DetailPenjualanID: old.DetailPenjualanID,
				DetailPembelianID: old.DetailPembelianID,
				Jenis:             model.StockReversal,
				Perubahan:         old.Perubahan.Neg(),
				Catatan:           &reason,
			}
			if err := tx.CreateMovement(&movement); err != nil {
				return err
			}
		}
		if err := tx.CancelTransaction(kind, id, userID); err != nil {
			return err
		}
		if kind == model.Purchase {
			return tx.CancelPurchaseNotes(id, userID)
		}
		return nil
	})
}
