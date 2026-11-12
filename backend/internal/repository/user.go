package repository

import (
	"context"
	"gorm.io/gorm/clause"
	"time"

	"toko/backend/internal/model"
)

func (s *Store) UsersExist() (bool, error) {
	var exists bool
	err := s.DB.Raw("SELECT EXISTS (SELECT 1 FROM public.pengguna)").Scan(&exists).Error
	return exists, err
}

func (s *Store) LockInitialRegistration() error {
	return s.DB.Exec("SELECT pg_advisory_xact_lock(726519031)").Error
}

func (s *Store) UserByUsername(username string) (model.Pengguna, error) {
	var user model.Pengguna
	err := s.DB.Where("lower(username) = ?", username).First(&user).Error
	return user, err
}

func (s *Store) UsernameExists(username string) (bool, error) {
	var count int64
	err := s.DB.Model(&model.Pengguna{}).Where("lower(username) = ?", username).Count(&count).Error
	return count != 0, err
}

func (s *Store) CreateUser(user *model.Pengguna) error {
	return s.DB.Create(user).Error
}

func (s *Store) ListUsers(limit, offset int) ([]model.Pengguna, error) {
	rows := make([]model.Pengguna, 0)
	err := s.DB.Select("id", "nama", "username", "peran", "aktif").Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, err
}

func (s *Store) CashierName(userID int64) (string, error) {
	var user struct{ Nama string }
	err := s.DB.Model(&model.Pengguna{}).Select("nama").Where("id = ?", userID).Scan(&user).Error
	return user.Nama, err
}

func (s *Store) CreateSession(session *model.SesiPengguna) error {
	return s.DB.Create(session).Error
}

func (s *Store) DeleteExpiredSessions() error {
	return s.DB.Where("expires_at <= now()").Delete(&model.SesiPengguna{}).Error
}
func (s *Store) UserBySession(ctx context.Context, sessionID string, userID int64) (model.Pengguna, error) {
	var user model.Pengguna
	err := s.DB.WithContext(ctx).Table("public.pengguna AS p").Select("p.*").
		Joins("JOIN public.sesi_pengguna s ON s.pengguna_id = p.id").
		Where("s.id = ? AND p.id = ? AND s.expires_at > now() AND s.revoked_at IS NULL AND p.aktif = true", sessionID, userID).Take(&user).Error
	return user, err
}
func (s *Store) CreateRefreshToken(row *model.RefreshToken) error { return s.DB.Create(row).Error }
func (s *Store) RefreshToken(hash string) (model.RefreshToken, error) {
	var row model.RefreshToken
	err := s.DB.Where("token_hash = ?", hash).Take(&row).Error
	return row, err
}
func (s *Store) LockSession(id string) (model.SesiPengguna, error) {
	var row model.SesiPengguna
	err := s.DB.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&row).Error
	return row, err
}
func (s *Store) ConsumeRefreshToken(hash string, now time.Time) error {
	return s.DB.Model(&model.RefreshToken{}).Where("token_hash = ?", hash).Update("used_at", now).Error
}
func (s *Store) RevokeSession(id string) error {
	return s.DB.Model(&model.SesiPengguna{}).Where("id = ? AND revoked_at IS NULL", id).Update("revoked_at", time.Now().UTC()).Error
}
