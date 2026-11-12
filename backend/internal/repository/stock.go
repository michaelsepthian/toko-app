package repository

import (
	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
)

func (s *Store) LockProducts(ids []int64) ([]model.Produk, error) {
	return LockProducts(s.DB, ids)
}

func (s *Store) Stock(productID int64) (decimal.Decimal, error) {
	return Stock(s.DB, productID)
}

func (s *Store) CreateMovement(row *model.MutasiStok) error    { return s.DB.Create(row).Error }
func (s *Store) CreateMovements(rows []model.MutasiStok) error { return s.DB.Create(&rows).Error }

type StockRow struct {
	ID          int64
	SKU         string
	Nama        string
	StokMinimum decimal.Decimal
	Stok        decimal.Decimal
}

func (s *Store) ListStocks(limit, offset int) ([]StockRow, error) {
	rows := make([]StockRow, 0)
	err := s.DB.Raw(`
		SELECT p.id, p.sku, p.nama, p.stok_minimum, COALESCE(m.stok, 0) AS stok
		FROM (SELECT id, sku, nama, stok_minimum FROM public.produk ORDER BY id LIMIT ? OFFSET ?) p
		LEFT JOIN LATERAL (SELECT SUM(perubahan) AS stok FROM public.mutasi_stok WHERE produk_id = p.id) m ON true
		ORDER BY p.id`, limit, offset).Scan(&rows).Error
	return rows, err
}

func (s *Store) StockSummary() ([]StockRow, error) {
	rows := make([]StockRow, 0)
	err := s.DB.Raw(`SELECT p.id, p.stok_minimum, COALESCE(m.stok, 0) AS stok
	FROM public.produk p LEFT JOIN (SELECT produk_id, SUM(perubahan) AS stok
	FROM public.mutasi_stok GROUP BY produk_id) m ON m.produk_id = p.id ORDER BY p.id`).Scan(&rows).Error
	return rows, err
}

func (s *Store) ListMovements(productID int64, limit, offset int) ([]model.MutasiStok, error) {
	rows := make([]model.MutasiStok, 0)
	err := s.DB.Where("produk_id = ?", productID).Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, err
}
