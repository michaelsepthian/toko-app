// Package repository menampung query yang dipakai berulang.
package repository

import (
	"context"
	"errors"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"toko/backend/internal/model"
)

type Store struct{ DB *gorm.DB }

// ErrNotFound menyembunyikan detail ORM dari service dan transport.
var ErrNotFound = gorm.ErrRecordNotFound

func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }

func (s *Store) WithContext(ctx context.Context) *Store {
	return &Store{DB: s.DB.WithContext(ctx)}
}

// Semua repository dalam callback memakai koneksi transaksi yang sama.
// Service menentukan batas unit of work tanpa menerima objek GORM.
func (s *Store) Transaction(ctx context.Context, work func(*Store) error) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return work(&Store{DB: tx})
	})
}

func (s *Store) LockRequest(key string) error {
	return s.DB.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", key).Error
}

func (s *Store) Ready(ctx context.Context) error {
	pool, err := s.DB.DB()
	if err != nil {
		return err
	}
	return pool.PingContext(ctx)
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
