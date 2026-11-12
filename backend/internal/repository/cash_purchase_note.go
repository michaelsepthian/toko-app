package repository

import (
	"gorm.io/gorm/clause"
	"toko/backend/internal/model"
)

func (s *Store) CashNoteByKey(key string) (model.CatatanBelanja, error) {
	var row model.CatatanBelanja
	err := s.DB.Where("idempotency_key = ?", key).Take(&row).Error
	return row, err
}

func (s *Store) LockCashNote(id int64) (model.CatatanBelanja, error) {
	var row model.CatatanBelanja
	err := s.DB.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, id).Error
	return row, err
}

func (s *Store) CreateCashNote(row *model.CatatanBelanja) error { return s.DB.Create(row).Error }

func (s *Store) CompleteCashNote(id, purchaseID, userID int64) error {
	return s.DB.Model(&model.CatatanBelanja{}).Where("id = ?", id).Updates(map[string]any{
		"status": "SELESAI", "pembelian_id": purchaseID, "updated_by": userID,
	}).Error
}

func (s *Store) CancelCashNote(id, userID int64) error {
	return s.DB.Model(&model.CatatanBelanja{}).Where("id = ?", id).Updates(cancellationUpdates(userID)).Error
}

func (s *Store) CancelPurchaseNotes(purchaseID, userID int64) error {
	return s.DB.Model(&model.CatatanBelanja{}).Where("pembelian_id = ? AND status = 'SELESAI'", purchaseID).
		Updates(cancellationUpdates(userID)).Error
}

func (s *Store) ListCashNotes(date, status string, limit, offset int) ([]model.CatatanBelanja, error) {
	query := s.DB.Order("id DESC").Limit(limit).Offset(offset)
	if date != "" {
		query = query.Where("tanggal = ?", date)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	rows := make([]model.CatatanBelanja, 0)
	err := query.Find(&rows).Error
	return rows, err
}
