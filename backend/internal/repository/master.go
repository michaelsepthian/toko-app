package repository

import (
	"context"
	"database/sql"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"toko/backend/internal/model"
)

// Master hanya untuk tabel master dengan daftar kolom tulis yang eksplisit.
// Jangan gunakan abstraksi ini untuk transaksi keuangan atau perubahan stok.
type Master[M any] struct {
	Store   *Store
	Path    string
	Columns []string
}

type MasterFilter struct {
	Query, Barcode, For string
	Limit, Offset       int
}

func (m Master[M]) List(ctx context.Context, filter MasterFilter) ([]M, error) {
	query := m.Store.DB.WithContext(ctx).Model(new(M))
	if q := strings.TrimSpace(filter.Query); q != "" {
		if m.Path == "produk" {
			query = query.Where("(nama ILIKE ? OR sku ILIKE ? OR barcode ILIKE ?)", "%"+q+"%", "%"+q+"%", "%"+q+"%")
		} else {
			query = query.Where("nama ILIKE ?", "%"+q+"%")
		}
	}
	if m.Path == "produk" && filter.Barcode != "" {
		query = query.Where("barcode = ?", filter.Barcode)
	}
	if m.Path == "metode-pembayaran" {
		switch filter.For {
		case "penjualan":
			query = query.Where("aktif = true AND untuk_penjualan = true")
		case "pembelian":
			query = query.Where("aktif = true AND untuk_pembelian = true")
		}
	}
	rows := make([]M, 0)
	err := query.Order("id DESC").Limit(filter.Limit).Offset(filter.Offset).Find(&rows).Error
	return rows, err
}

func (m Master[M]) Get(ctx context.Context, id int64) (M, error) {
	var row M
	err := m.Store.DB.WithContext(ctx).First(&row, id).Error
	return row, err
}

func (m Master[M]) Create(ctx context.Context, row *M) error {
	columns := append(append([]string{}, m.Columns...), "created_by", "updated_by")
	return m.Store.DB.WithContext(ctx).Clauses(clause.Returning{}).Select(columns).Create(row).Error
}

func (m Master[M]) Update(ctx context.Context, id int64, row *M) error {
	columns := append(append([]string{}, m.Columns...), "updated_by")
	result := m.Store.DB.WithContext(ctx).Model(new(M)).Where("id = ?", id).Select(columns).Updates(row)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetProductFavorite(id, userID int64, favorite bool) (model.Produk, error) {
	var row model.Produk
	result := s.DB.Model(&row).Clauses(clause.Returning{}).Where("id = ?", id).
		Updates(map[string]any{"is_favorit": favorite, "updated_by": userID})
	if result.Error == nil && result.RowsAffected == 0 {
		return row, ErrNotFound
	}
	return row, result.Error
}

func (s *Store) PaymentForUpdate(id int64) (model.MetodePembayaran, error) {
	var row model.MetodePembayaran
	err := s.DB.Clauses(clause.Locking{Strength: "SHARE"}).First(&row, id).Error
	return row, err
}

func (s *Store) Source(id int64) (model.SumberPembelian, error) {
	var row model.SumberPembelian
	err := s.DB.First(&row, id).Error
	return row, err
}

type MasterData struct {
	Categories []model.Kategori
	Units      []model.Satuan
	Payments   []model.MetodePembayaran
	Sources    []model.SumberPembelian
}

func (s *Store) MasterData(ctx context.Context) (MasterData, error) {
	data := MasterData{Categories: []model.Kategori{}, Units: []model.Satuan{}, Payments: []model.MetodePembayaran{}, Sources: []model.SumberPembelian{}}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, rows := range []any{&data.Categories, &data.Units, &data.Payments, &data.Sources} {
			if err := tx.Order("id DESC").Find(rows).Error; err != nil {
				return err
			}
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return data, err
}

type ProductPopularity struct{ ProdukID, Transaksi int64 }

func (s *Store) ProductPopularity() ([]ProductPopularity, error) {
	rows := make([]ProductPopularity, 0)
	err := s.DB.Raw(`SELECT d.produk_id, COUNT(DISTINCT d.penjualan_id) AS transaksi
FROM public.detail_penjualan d JOIN public.penjualan p ON p.id = d.penjualan_id
WHERE p.status = 'SELESAI' GROUP BY d.produk_id`).Scan(&rows).Error
	return rows, err
}
