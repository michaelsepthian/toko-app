// Package repository menampung query yang dipakai berulang.
package repository

import (
	"context"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"toko/backend/internal/model"
)

type Store struct{ DB *gorm.DB }

func (s *Store) UserByAuthID(ctx context.Context, id string) (model.Pengguna, error) {
	var user model.Pengguna
	err := s.DB.WithContext(ctx).Where("auth_user_id = ? AND aktif = ?", id, true).First(&user).Error
	return user, err
}

// Semua penulis stok harus mengunci produk lebih dahulu, dalam urutan ID yang sama.
// Lock header/produk hidup sampai callback Transaction selesai (COMMIT/ROLLBACK).
func LockProducts(tx *gorm.DB, ids []int64) ([]model.Produk, error) {
	var products []model.Produk
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Order("id").Find(&products).Error
	return products, err
}

func Stock(tx *gorm.DB, productID int64) (decimal.Decimal, error) {
	var result struct{ Stok decimal.Decimal }
	err := tx.Model(&model.MutasiStok{}).Select("COALESCE(SUM(perubahan), 0) AS stok").Where("produk_id = ?", productID).Scan(&result).Error
	return result.Stok, err
}
