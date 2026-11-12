package service

import (
	"context"
	"time"

	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

// Use case baca tetap melalui service; handler tidak merangkai query database.
type HistoryFilter = repository.HistoryFilter
type StockRow = repository.StockRow
type ShoppingCalendarDay = repository.ShoppingCalendarDay
type ProductPopularity = repository.ProductPopularity
type MasterData = repository.MasterData

func (s *Service) ListUsers(ctx context.Context, limit, offset int) ([]model.Pengguna, error) {
	return s.Store.WithContext(ctx).ListUsers(limit, offset)
}

func (s *Service) ListSales(ctx context.Context, filter HistoryFilter) ([]model.Penjualan, error) {
	return s.Store.WithContext(ctx).ListSales(filter)
}

func (s *Service) ListPurchases(ctx context.Context, filter HistoryFilter) ([]model.Pembelian, error) {
	return s.Store.WithContext(ctx).ListPurchases(filter)
}

type SaleDetail struct {
	Sale        model.Penjualan
	CashierName string
}

func (s *Service) SaleDetail(ctx context.Context, id int64) (SaleDetail, error) {
	store := s.Store.WithContext(ctx)
	row, err := store.Sale(id)
	if err != nil {
		return SaleDetail{}, err
	}
	name, err := store.CashierName(row.PenggunaID)
	return SaleDetail{Sale: row, CashierName: name}, err
}

func (s *Service) PurchaseDetail(ctx context.Context, id int64) (model.Pembelian, error) {
	return s.Store.WithContext(ctx).Purchase(id)
}

func (s *Service) ListStocks(ctx context.Context, limit, offset int) ([]StockRow, error) {
	return s.Store.WithContext(ctx).ListStocks(limit, offset)
}

func (s *Service) StockSummary(ctx context.Context) ([]StockRow, error) {
	return s.Store.WithContext(ctx).StockSummary()
}

func (s *Service) ListMovements(ctx context.Context, id int64, limit, offset int) ([]model.MutasiStok, error) {
	return s.Store.WithContext(ctx).ListMovements(id, limit, offset)
}

func (s *Service) ShoppingSources(ctx context.Context) ([]model.SumberPembelian, error) {
	return s.Store.WithContext(ctx).ShoppingSources()
}

func (s *Service) ShoppingCalendar(ctx context.Context, month string) ([]ShoppingCalendarDay, error) {
	start, err := time.Parse("2006-01", month)
	if err != nil || start.Year() < 1 || start.Year() > 9999 || start.Format("2006-01") != month {
		return nil, apperror.Invalid("Bulan harus berformat YYYY-MM")
	}
	return s.Store.WithContext(ctx).ShoppingCalendar(start, start.AddDate(0, 1, 0))
}

func (s *Service) ListShoppingItems(ctx context.Context, date string, limit, offset int) ([]model.RencanaBelanjaItem, error) {
	if _, err := ShoppingDate(date); err != nil {
		return nil, err
	}
	return s.Store.WithContext(ctx).ListShoppingItems(date, limit, offset)
}

func summaryFilterDate(date string) (string, error) {
	if date == "" {
		return "", nil
	}
	start, _, err := SummaryDay(date, time.Now())
	return start.Format("2006-01-02"), err
}

func (s *Service) ListDailySummaries(ctx context.Context, date string, limit, offset int) ([]model.RingkasanHarian, error) {
	date, err := summaryFilterDate(date)
	if err != nil {
		return nil, err
	}
	return s.Store.WithContext(ctx).ListDailySummaries(date, limit, offset)
}

func (s *Service) DailySummary(ctx context.Context, id int64) (model.RingkasanHarian, error) {
	return s.Store.WithContext(ctx).DailySummary(id)
}

func (s *Service) ListCashNotes(ctx context.Context, date, status string, limit, offset int) ([]model.CatatanBelanja, error) {
	date, err := summaryFilterDate(date)
	if err != nil {
		return nil, err
	}
	if status != "" && !model.CashNoteStatus(status).Valid() {
		return nil, apperror.Invalid("Status catatan belanja tidak valid")
	}
	return s.Store.WithContext(ctx).ListCashNotes(date, status, limit, offset)
}

func (s *Service) MasterData(ctx context.Context) (MasterData, error) { return s.Store.MasterData(ctx) }

func (s *Service) ProductPopularity(ctx context.Context) ([]ProductPopularity, error) {
	return s.Store.WithContext(ctx).ProductPopularity()
}

func (s *Service) SetProductFavorite(ctx context.Context, id, userID int64, favorite *bool) (model.Produk, error) {
	if favorite == nil {
		return model.Produk{}, apperror.Invalid("is_favorit wajib diisi true atau false")
	}
	return s.Store.WithContext(ctx).SetProductFavorite(id, userID, *favorite)
}
