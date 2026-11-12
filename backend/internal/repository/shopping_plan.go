package repository

import (
	"time"

	"gorm.io/gorm/clause"
	"toko/backend/internal/model"
)

func (s *Store) ShoppingItemsByKey(key string) ([]model.RencanaBelanjaItem, error) {
	rows := make([]model.RencanaBelanjaItem, 0)
	err := s.DB.Unscoped().Where("idempotency_key = ?", key).Order("urutan_input").Find(&rows).Error
	return rows, err
}

func (s *Store) ActiveSource(id int64) (model.SumberPembelian, error) {
	var row model.SumberPembelian
	err := s.DB.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND aktif = true", id).Take(&row).Error
	return row, err
}

func (s *Store) ActiveProduct(id int64) (model.Produk, error) {
	var row model.Produk
	err := s.DB.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND aktif = true", id).Take(&row).Error
	return row, err
}

func (s *Store) Unit(id int64) (model.Satuan, error) {
	var row model.Satuan
	err := s.DB.First(&row, id).Error
	return row, err
}

func (s *Store) CreateShoppingItems(rows []model.RencanaBelanjaItem) error {
	return s.DB.Create(&rows).Error
}

func (s *Store) LockShoppingItem(id int64) (model.RencanaBelanjaItem, error) {
	var row model.RencanaBelanjaItem
	err := s.DB.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, id).Error
	return row, err
}

func (s *Store) ShoppingItem(id int64) (model.RencanaBelanjaItem, error) {
	var row model.RencanaBelanjaItem
	err := s.DB.First(&row, id).Error
	return row, err
}

func (s *Store) SetShoppingChecklist(id, userID int64, at *time.Time, by *int64) error {
	return s.DB.Model(&model.RencanaBelanjaItem{}).Where("id = ?", id).
		Updates(map[string]any{"dibeli_at": at, "dibeli_by": by, "updated_by": userID}).Error
}

func (s *Store) LockShoppingItems(ids []int64) ([]model.RencanaBelanjaItem, error) {
	var rows []model.RencanaBelanjaItem
	err := s.DB.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Order("id").Find(&rows).Error
	return rows, err
}

func (s *Store) MoveShoppingItems(ids []int64, sourceID *int64, date string, userID int64) error {
	changes := map[string]any{"sumber_pembelian_id": sourceID, "updated_by": userID}
	if date != "" {
		changes["tanggal"] = date
	}
	return s.DB.Model(&model.RencanaBelanjaItem{}).Where("id IN ?", ids).Updates(changes).Error
}

func (s *Store) EditShoppingItem(id, userID int64, next model.RencanaBelanjaItem) error {
	return s.DB.Model(&model.RencanaBelanjaItem{}).Where("id = ?", id).Updates(map[string]any{
		"produk_id": next.ProdukID, "nama_barang": next.NamaBarang,
		"jumlah": next.Jumlah, "satuan": next.Satuan, "catatan": next.Catatan,
		"updated_by": userID,
	}).Error
}

func (s *Store) DeleteShoppingItem(id, userID int64, at time.Time) error {
	result := s.DB.Model(&model.RencanaBelanjaItem{}).Where("id = ?", id).
		Updates(map[string]any{"deleted_at": at, "deleted_by": userID, "updated_by": userID})
	if result.Error == nil && result.RowsAffected == 0 {
		return ErrNotFound
	}
	return result.Error
}

type ShoppingCalendarDay struct {
	Tanggal     model.ReportDate
	TotalItem   int64
	SudahDibeli int64
}

func (s *Store) ShoppingCalendar(start, end time.Time) ([]ShoppingCalendarDay, error) {
	rows := make([]ShoppingCalendarDay, 0)
	err := s.DB.Model(&model.RencanaBelanjaItem{}).
		Select("tanggal, count(*) AS total_item, count(dibeli_at) AS sudah_dibeli").
		Where("tanggal >= ? AND tanggal < ?", start.Format("2006-01-02"), end.Format("2006-01-02")).
		Group("tanggal").Order("tanggal").Scan(&rows).Error
	return rows, err
}

func (s *Store) ListShoppingItems(date string, limit, offset int) ([]model.RencanaBelanjaItem, error) {
	rows := make([]model.RencanaBelanjaItem, 0)
	err := s.DB.Where("tanggal = ?", date).Order("id").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, err
}

func (s *Store) ShoppingSources() ([]model.SumberPembelian, error) {
	rows := make([]model.SumberPembelian, 0)
	err := s.DB.Select("id, nama, aktif").Order("nama, id").Find(&rows).Error
	return rows, err
}
