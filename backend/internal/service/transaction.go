package service

import (
	"context"

	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type transactionResult struct {
	sale     model.Penjualan
	purchase model.Pembelian
}

func (s *Service) CreateSale(ctx context.Context, userID int64, in TransactionInput) (model.Penjualan, error) {
	result, err := s.createTransaction(ctx, userID, model.Sale, in)
	return result.sale, err
}

func (s *Service) CreatePurchase(ctx context.Context, userID int64, in TransactionInput) (model.Pembelian, error) {
	result, err := s.createTransaction(ctx, userID, model.Purchase, in)
	return result.purchase, err
}

func (s *Service) createTransaction(ctx context.Context, userID int64, kind model.TransactionKind, in TransactionInput) (transactionResult, error) {
	purchase := kind == model.Purchase
	ids, err := in.validate(purchase)
	if err != nil {
		return transactionResult{}, err
	}
	var output transactionResult
	err = s.Store.Transaction(ctx, func(tx *repository.Store) error {
		cached, found, hash, err := replayTransaction(tx, userID, purchase, &in)
		if err != nil {
			return err
		}
		if found {
			output = cached
			return nil
		}
		var cashNote *model.CatatanBelanja
		if in.CatatanBelanjaID != nil {
			note, err := tx.LockCashNote(*in.CatatanBelanjaID)
			if err != nil {
				return err
			}
			if note.Status != "TERBUKA" {
				return apperror.Conflict("Catatan belanja sudah dirinci atau dibatalkan")
			}
			cashNote = &note
		}
		products, err := tx.LockProducts(ids)
		if err != nil {
			return err
		}
		if len(products) != len(ids) {
			return apperror.Invalid("Ada produk yang tidak ditemukan")
		}
		byID := make(map[int64]model.Produk, len(products))
		for _, product := range products {
			if !product.Aktif {
				return apperror.Invalid("Produk tidak aktif: " + product.Nama)
			}
			byID[product.ID] = product
		}
		// SHARE mencegah tarif master berubah saat header dibuat dan diselesaikan.
		method, err := tx.PaymentForUpdate(in.MetodePembayaranID)
		if err != nil {
			return err
		}
		if !method.AvailableFor(kind) {
			return apperror.Invalid("Metode pembayaran tidak tersedia untuk transaksi ini")
		}

		if purchase && in.SumberPembelianID != nil {
			source, err := tx.Source(*in.SumberPembelianID)
			if err != nil {
				return err
			}
			if !source.Aktif {
				return apperror.Invalid("Sumber pembelian tidak aktif")
			}
		}
		subtotal := decimal.Zero
		for _, item := range in.Items {
			price := byID[item.ProdukID].HargaJual
			if purchase {
				price = *item.HargaBeli
			}
			line, err := LineSubtotal(item.Jumlah, price, item.Diskon)
			if err != nil {
				return err
			}
			subtotal = subtotal.Add(line)
			// Penjualan tetap dicatat saat stok kurang; saldo stok boleh negatif.
		}
		if !Money(subtotal) || in.DiskonTransaksi.GreaterThan(subtotal) {
			return apperror.Invalid("Subtotal terlalu besar atau diskon transaksi melebihi subtotal")
		}
		header := model.Header{
			Audit:              model.NewAudit(userID),
			PenggunaID:         userID,
			MetodePembayaranID: in.MetodePembayaranID,
			IdempotencyKey:     in.IdempotencyKey,
			RequestHash:        hash,
			Status:             model.StatusDraft,
			SubtotalBarang:     subtotal,
			DiskonTransaksi:    in.DiskonTransaksi,
			NomorReferensi:     in.NomorReferensi,
			Catatan:            in.Catatan,
		}
		if purchase {
			output.purchase, err = createPurchase(tx, userID, header, in, byID, cashNote)
		} else {
			output.sale, err = createSale(tx, userID, header, in, byID)
		}
		if err != nil {
			output = transactionResult{}
		}
		return err
	})
	return output, err
}
