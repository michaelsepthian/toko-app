package service

import (
	"context"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type ShoppingItemInput struct {
	ProdukID   *int64           `json:"produk_id"`
	NamaBarang string           `json:"nama_barang"`
	Jumlah     *decimal.Decimal `json:"jumlah"`
	Satuan     string           `json:"satuan"`
	Catatan    string           `json:"catatan"`
}

type ShoppingBatchInput struct {
	IdempotencyKey    string              `json:"idempotency_key"`
	Tanggal           string              `json:"tanggal"`
	SumberPembelianID *int64              `json:"sumber_pembelian_id"`
	Items             []ShoppingItemInput `json:"items"`
}

type ShoppingMoveInput struct {
	IDs               []int64 `json:"ids"`
	SumberPembelianID *int64  `json:"sumber_pembelian_id"`
	Tanggal           string  `json:"tanggal"`
}

// ShoppingDate tidak membatasi tanggal lampau/mendatang: ini rencana, bukan tutup kas.
func ShoppingDate(value string) (time.Time, error) {
	day, err := time.Parse("2006-01-02", value)
	if err != nil || day.Year() < 1 || day.Year() > 9999 || day.Format("2006-01-02") != value {
		return time.Time{}, apperror.Invalid("Tanggal belanja harus berformat YYYY-MM-DD")
	}
	return day, nil
}

func shoppingPermission(user model.Pengguna, ownerOnly bool) error {
	if user.ID <= 0 || (user.Peran != "PEMILIK" && (ownerOnly || user.Peran != "KASIR")) {
		return apperror.Forbidden()
	}
	return nil
}

func validateShoppingItem(in ShoppingItemInput) error {
	if (in.ProdukID != nil && *in.ProdukID <= 0) || (in.ProdukID == nil && strings.TrimSpace(in.NamaBarang) == "") || len(in.NamaBarang) > 300 || len(in.Satuan) > 100 || len(in.Catatan) > 2000 {
		return apperror.Invalid("Pilih produk atau isi nama barang lainnya; periksa panjang nama, satuan, dan catatan")
	}
	if in.Jumlah != nil && !Quantity(*in.Jumlah) {
		return apperror.Invalid("Jumlah boleh kosong; jika diisi harus lebih dari 0 dan maksimal 3 desimal")
	}
	return nil
}

func shoppingSource(tx *repository.Store, id *int64) error {
	if id == nil {
		return nil
	}
	if *id <= 0 {
		return apperror.Invalid("Tempat beli tidak valid")
	}
	if _, err := tx.ActiveSource(*id); err != nil {
		if repository.IsNotFound(err) {
			return apperror.Invalid("Tempat beli tidak ditemukan atau sudah nonaktif")
		}
		return err
	}
	return nil
}

func buildShoppingItem(tx *repository.Store, in ShoppingItemInput) (model.RencanaBelanjaItem, error) {
	row := model.RencanaBelanjaItem{ProdukID: in.ProdukID, NamaBarang: strings.TrimSpace(in.NamaBarang), Jumlah: in.Jumlah, Satuan: strings.TrimSpace(in.Satuan), Catatan: strings.TrimSpace(in.Catatan)}
	if err := validateShoppingItem(in); err != nil {
		return row, err
	}
	if in.ProdukID != nil {
		product, err := tx.ActiveProduct(*in.ProdukID)
		if err != nil {
			if repository.IsNotFound(err) {
				return row, apperror.Invalid("Produk tidak ditemukan atau sudah nonaktif")
			}
			return row, err
		}
		unit, err := tx.Unit(product.SatuanID)
		if err != nil {
			return row, err
		}
		row.NamaBarang, row.Satuan = product.Nama, unit.Nama
	}
	return row, nil
}

func (s *Service) CreateShoppingItems(ctx context.Context, user model.Pengguna, in ShoppingBatchInput) ([]model.RencanaBelanjaItem, error) {
	rows := make([]model.RencanaBelanjaItem, 0)
	if err := shoppingPermission(user, false); err != nil {
		return rows, err
	}
	if _, err := ShoppingDate(in.Tanggal); err != nil {
		return rows, err
	}
	if !summaryUUID.MatchString(in.IdempotencyKey) || len(in.Items) < 1 || len(in.Items) > 100 {
		return rows, apperror.Invalid("Isi 1–100 barang dan identitas penyimpanan yang valid")
	}
	hash := digest(in)
	err := s.Store.Transaction(ctx, func(tx *repository.Store) error {
		if err := tx.LockRequest("shopping-plan:" + in.IdempotencyKey); err != nil {
			return err
		}
		// Termasuk item yang telah dihapus: retry tidak boleh menghidupkan/menggandakan item.
		var err error
		rows, err = tx.ShoppingItemsByKey(in.IdempotencyKey)
		if err != nil {
			return err
		}
		if len(rows) > 0 {
			if len(rows) != len(in.Items) || rows[0].CreatedBy == nil || *rows[0].CreatedBy != user.ID || rows[0].RequestHash != hash {
				return apperror.Conflict("Identitas penyimpanan sudah digunakan untuk daftar yang berbeda")
			}
			return nil
		}
		if err := shoppingSource(tx, in.SumberPembelianID); err != nil {
			return err
		}
		for index, item := range in.Items {
			row, err := buildShoppingItem(tx, item)
			if err != nil {
				return err
			}
			row.Audit = model.NewAudit(user.ID)
			row.Tanggal, row.SumberPembelianID = model.ReportDate(in.Tanggal), in.SumberPembelianID
			row.IdempotencyKey, row.UrutanInput, row.RequestHash = in.IdempotencyKey, index, hash
			rows = append(rows, row)
		}
		return tx.CreateShoppingItems(rows)
	})
	return rows, err
}

func (s *Service) CheckShoppingItem(ctx context.Context, user model.Pengguna, id int64, checked bool) (model.RencanaBelanjaItem, error) {
	var row model.RencanaBelanjaItem
	if err := shoppingPermission(user, false); err != nil {
		return row, err
	}
	err := s.Store.Transaction(ctx, func(tx *repository.Store) error {
		var err error
		row, err = tx.LockShoppingItem(id)
		if err != nil {
			return err
		}
		if (row.DibeliAt != nil) == checked {
			return nil
		}
		var at *time.Time
		var by *int64
		if checked {
			now := time.Now()
			at, by = &now, &user.ID
		}
		if err := tx.SetShoppingChecklist(id, user.ID, at, by); err != nil {
			return err
		}
		// Scan NULL ke pointer pada objek lama bisa mempertahankan nilai sebelumnya.
		row, err = tx.ShoppingItem(id)
		return err
	})
	return row, err
}

func (s *Service) MoveShoppingItems(ctx context.Context, user model.Pengguna, in ShoppingMoveInput) error {
	if err := shoppingPermission(user, true); err != nil {
		return err
	}
	if len(in.IDs) < 1 || len(in.IDs) > 100 {
		return apperror.Invalid("Pilih 1–100 barang untuk dipindahkan")
	}
	seen := make(map[int64]bool)
	for _, id := range in.IDs {
		if id <= 0 || seen[id] {
			return apperror.Invalid("ID barang harus positif dan tidak berulang")
		}
		seen[id] = true
	}
	if in.Tanggal != "" {
		if _, err := ShoppingDate(in.Tanggal); err != nil {
			return err
		}
	}
	return s.Store.Transaction(ctx, func(tx *repository.Store) error {
		if err := shoppingSource(tx, in.SumberPembelianID); err != nil {
			return err
		}
		rows, err := tx.LockShoppingItems(in.IDs)
		if err != nil {
			return err
		}
		if len(rows) != len(in.IDs) {
			return repository.ErrNotFound
		}
		return tx.MoveShoppingItems(in.IDs, in.SumberPembelianID, in.Tanggal, user.ID)
	})
}

func (s *Service) EditShoppingItem(ctx context.Context, user model.Pengguna, id int64, in ShoppingItemInput) (model.RencanaBelanjaItem, error) {
	var row model.RencanaBelanjaItem
	if err := shoppingPermission(user, true); err != nil {
		return row, err
	}
	err := s.Store.Transaction(ctx, func(tx *repository.Store) error {
		var err error
		row, err = tx.LockShoppingItem(id)
		if err != nil {
			return err
		}
		next, err := buildShoppingItem(tx, in)
		if err != nil {
			return err
		}
		// Tempat beli/tanggal sengaja tidak diterima oleh DTO edit umum.
		if err := tx.EditShoppingItem(id, user.ID, next); err != nil {
			return err
		}
		row, err = tx.ShoppingItem(id)
		return err
	})
	return row, err
}

func (s *Service) DeleteShoppingItem(ctx context.Context, user model.Pengguna, id int64) error {
	if err := shoppingPermission(user, true); err != nil {
		return err
	}
	return s.Store.WithContext(ctx).DeleteShoppingItem(id, user.ID, time.Now())
}
