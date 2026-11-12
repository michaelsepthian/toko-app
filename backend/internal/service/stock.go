package service

import (
	"context"
	"strings"

	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type StockInput struct {
	Jenis     string          `json:"jenis"`
	Perubahan decimal.Decimal `json:"perubahan"`
	Catatan   string          `json:"catatan"`
}

func (s *Service) AdjustStock(ctx context.Context, userID, productID int64, in StockInput) (model.MutasiStok, error) {
	var result model.MutasiStok
	kind := model.StockKind(in.Jenis)
	if (kind != model.StockInitial && kind != model.StockAdjustment) || !Quantity(in.Perubahan.Abs()) || strings.TrimSpace(in.Catatan) == "" || (kind == model.StockInitial && in.Perubahan.IsNegative()) {
		return result, apperror.Invalid("Jenis AWAL/PENYESUAIAN, perubahan bukan nol maksimal 3 desimal, dan catatan wajib")
	}
	err := s.Store.Transaction(ctx, func(tx *repository.Store) error {
		products, err := tx.LockProducts([]int64{productID})
		if err != nil {
			return err
		}
		if len(products) != 1 {
			return repository.ErrNotFound
		}
		if !products[0].Aktif {
			return apperror.Invalid("Produk tidak aktif")
		}
		stock, err := tx.Stock(productID)
		if err != nil {
			return err
		}
		if stock.Add(in.Perubahan).IsNegative() {
			return apperror.Conflict("Penyesuaian menghasilkan stok negatif")
		}
		result = model.MutasiStok{
			ProdukID:   productID,
			PenggunaID: userID,
			Jenis:      kind,
			Perubahan:  in.Perubahan,
			Catatan:    &in.Catatan,
		}
		return tx.CreateMovement(&result)
	})
	return result, err
}
