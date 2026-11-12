package repository

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"toko/backend/internal/model"
)

func (s *Store) SaleByKey(key string) (model.Penjualan, error) {
	var row model.Penjualan
	err := s.DB.Preload("Detail").Where("idempotency_key = ?", key).First(&row).Error
	return row, err
}

func (s *Store) PurchaseByKey(key string) (model.Pembelian, error) {
	var row model.Pembelian
	err := s.DB.Preload("Detail").Where("idempotency_key = ?", key).First(&row).Error
	return row, err
}

func (s *Store) CreateSale(row *model.Penjualan) error {
	return s.DB.Omit("Detail").Create(row).Error
}

func (s *Store) CreatePurchase(row *model.Pembelian) error {
	return s.DB.Omit("Detail").Create(row).Error
}

func (s *Store) ReloadSale(row *model.Penjualan, details bool) error {
	query := s.DB
	if details {
		query = query.Preload("Detail")
	}
	return query.First(row, row.ID).Error
}

func (s *Store) ReloadPurchase(row *model.Pembelian) error {
	return s.DB.Preload("Detail").First(row, row.ID).Error
}

func (s *Store) CreateSaleDetails(rows []model.DetailPenjualan) error {
	return s.DB.Create(&rows).Error
}

func (s *Store) CreatePurchaseDetails(rows []model.DetailPembelian) error {
	return s.DB.Create(&rows).Error
}

func transactionTable(kind model.TransactionKind) (string, error) {
	if !kind.Valid() {
		return "", ErrInvalidTransactionKind
	}
	return string(kind), nil
}

// Nama tabel berasal dari enum internal yang divalidasi, bukan input HTTP.
func (s *Store) CompleteTransaction(kind model.TransactionKind, id int64) error {
	if _, err := transactionTable(kind); err != nil {
		return err
	}
	var row any = &model.Penjualan{}
	if kind == model.Purchase {
		row = &model.Pembelian{}
	}
	return s.DB.Model(row).Where("id = ?", id).Update("status", model.StatusCompleted).Error
}

func (s *Store) LockTransactionStatus(kind model.TransactionKind, id int64) (model.TransactionStatus, error) {
	table, err := transactionTable(kind)
	if err != nil {
		return "", err
	}
	var row struct{ Status model.TransactionStatus }
	err = s.DB.Table(table).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&row).Error
	return row.Status, err
}

func (s *Store) TransactionMovements(kind model.TransactionKind, id int64) ([]model.MutasiStok, error) {
	table, err := transactionTable(kind)
	if err != nil {
		return nil, err
	}
	stockKind := model.StockSale
	if kind == model.Purchase {
		stockKind = model.StockPurchase
	}
	subquery := s.DB.Table("detail_"+table).Select("id").Where(table+"_id = ?", id)
	var rows []model.MutasiStok
	err = s.DB.Where("detail_"+table+"_id IN (?) AND jenis = ?", subquery, stockKind).Order("produk_id").Find(&rows).Error
	return rows, err
}

func cancellationUpdates(userID int64) map[string]any {
	return map[string]any{
		"status":                model.StatusCancelled,
		"updated_by":            userID,
		"cancel_transaction_at": gorm.Expr("CURRENT_TIMESTAMP"),
		"cancel_transaction_by": userID,
	}
}

func (s *Store) CancelTransaction(kind model.TransactionKind, id, userID int64) error {
	table, err := transactionTable(kind)
	if err != nil {
		return err
	}
	return s.DB.Table(table).Where("id = ?", id).Updates(cancellationUpdates(userID)).Error
}

type HistoryFilter struct {
	Start, End    *time.Time
	Limit, Offset int
}

func (s *Store) historyQuery(filter HistoryFilter) *gorm.DB {
	query := s.DB.Order("id DESC").Limit(filter.Limit).Offset(filter.Offset)
	if filter.Start != nil && filter.End != nil {
		query = query.Where("tanggal >= ? AND tanggal < ?", *filter.Start, *filter.End)
	}
	return query
}

func (s *Store) ListSales(filter HistoryFilter) ([]model.Penjualan, error) {
	rows := make([]model.Penjualan, 0)
	err := s.historyQuery(filter).Find(&rows).Error
	return rows, err
}

func (s *Store) ListPurchases(filter HistoryFilter) ([]model.Pembelian, error) {
	rows := make([]model.Pembelian, 0)
	err := s.historyQuery(filter).Find(&rows).Error
	return rows, err
}

func (s *Store) Sale(id int64) (model.Penjualan, error) {
	row := model.Penjualan{Header: model.Header{Base: model.Base{ID: id}}}
	err := s.ReloadSale(&row, true)
	return row, err
}

func (s *Store) Purchase(id int64) (model.Pembelian, error) {
	row := model.Pembelian{Header: model.Header{Base: model.Base{ID: id}}}
	err := s.ReloadPurchase(&row)
	return row, err
}
