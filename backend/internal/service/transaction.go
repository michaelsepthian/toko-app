package service

import (
	"context"
	"crypto/md5"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type Service struct{ Store *repository.Store }

// DTO hanya menerima data yang boleh dikirim frontend. Nomor, pengguna, harga
// penjualan, tarif, total dan status tidak diambil dari input client.
type ItemInput struct {
	ProdukID  int64            `json:"produk_id"`
	Jumlah    decimal.Decimal  `json:"jumlah"`
	Diskon    decimal.Decimal  `json:"diskon"`
	HargaBeli *decimal.Decimal `json:"harga_beli,omitempty"`
}
type TransactionInput struct {
	TanggalPendapatan  *string         `json:"tanggal_pendapatan,omitempty"`
	CatatanBelanjaID   *int64          `json:"catatan_belanja_id,omitempty"`
	IdempotencyKey     *string         `json:"idempotency_key,omitempty"`
	MetodePembayaranID int64           `json:"metode_pembayaran_id"`
	SumberPembelianID  *int64          `json:"sumber_pembelian_id,omitempty"`
	DiskonTransaksi    decimal.Decimal `json:"diskon_transaksi"`
	JumlahDibayar      decimal.Decimal `json:"jumlah_dibayar"`
	NomorNota          *string         `json:"nomor_nota,omitempty"`
	NomorReferensi     *string         `json:"nomor_referensi,omitempty"`
	Catatan            *string         `json:"catatan,omitempty"`
	Items              []ItemInput     `json:"items"`
}

func (in TransactionInput) validate(purchase bool) ([]int64, error) {
	if in.TanggalPendapatan != nil {
		if purchase {
			return nil, apperror.Invalid("Tanggal pendapatan hanya untuk penjualan")
		}
		if _, err := saleIncomeDate(*in.TanggalPendapatan, time.Now()); err != nil {
			return nil, err
		}
	}
	if in.CatatanBelanjaID != nil && (!purchase || *in.CatatanBelanjaID <= 0) {
		return nil, apperror.Invalid("Catatan belanja hanya untuk rincian pembelian")
	}
	if in.MetodePembayaranID <= 0 || len(in.Items) == 0 || len(in.Items) > 200 {
		return nil, apperror.Invalid("Metode pembayaran wajib; isi 1 sampai 200 item")
	}
	if !Money(in.DiskonTransaksi) || !Money(in.JumlahDibayar) {
		return nil, apperror.Invalid("Diskon atau pembayaran tidak valid")
	}
	if in.SumberPembelianID != nil && *in.SumberPembelianID <= 0 {
		return nil, apperror.Invalid("Sumber pembelian tidak valid")
	}
	ids := make([]int64, 0, len(in.Items))
	seen := make(map[int64]bool)
	for _, item := range in.Items {
		if item.ProdukID <= 0 || seen[item.ProdukID] || !Quantity(item.Jumlah) || !Money(item.Diskon) {
			return nil, apperror.Invalid("Item tidak valid atau produk muncul lebih dari sekali")
		}
		if purchase && (item.HargaBeli == nil || !Money(*item.HargaBeli)) {
			return nil, apperror.Invalid("Harga beli wajib dan tidak boleh negatif")
		}
		if !purchase && item.HargaBeli != nil {
			return nil, apperror.Invalid("Harga beli hanya untuk transaksi pembelian")
		}
		seen[item.ProdukID] = true
		ids = append(ids, item.ProdukID)
	}
	if !purchase && (in.SumberPembelianID != nil || in.NomorNota != nil) {
		return nil, apperror.Invalid("Sumber pembelian dan nomor nota hanya untuk pembelian")
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids, nil
}

func (s *Service) CreateTransaction(ctx context.Context, userID int64, purchase bool, in TransactionInput) (any, error) {
	ids, err := in.validate(purchase)
	if err != nil {
		return nil, err
	}
	var output any
	err = s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cached, found, hash, err := replayTransaction(tx, userID, purchase, &in)
		if err != nil {
			return err
		}
		if found {
			output = cached
			return nil
		}
		var cashNote *model.CatatanBelanja
		if in.CatatanBelanjaID != nil {
			var note model.CatatanBelanja
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&note, *in.CatatanBelanjaID).Error; err != nil {
				return err
			}
			if note.Status != "TERBUKA" {
				return apperror.Conflict("Catatan belanja sudah dirinci atau dibatalkan")
			}
			cashNote = &note
		}
		products, err := repository.LockProducts(tx, ids)
		if err != nil {
			return err
		}
		if len(products) != len(ids) {
			return apperror.Invalid("Ada produk yang tidak ditemukan")
		}
		byID := make(map[int64]model.Produk, len(products))
		for _, product := range products {
			if !product.Aktif {
				return apperror.Invalid("Produk tidak aktif: " + product.Nama)
			}
			byID[product.ID] = product
		}
		// SHARE mencegah tarif master berubah saat header dibuat dan diselesaikan.
		var method model.MetodePembayaran
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).First(&method, in.MetodePembayaranID).Error; err != nil {
			return err
		}
		if !method.Aktif || (purchase && !method.UntukPembelian) || (!purchase && !method.UntukPenjualan) {
			return apperror.Invalid("Metode pembayaran tidak tersedia untuk transaksi ini")
		}

		if purchase && in.SumberPembelianID != nil {
			var source model.SumberPembelian
			if err := tx.First(&source, *in.SumberPembelianID).Error; err != nil {
				return err
			}
			if !source.Aktif {
				return apperror.Invalid("Sumber pembelian tidak aktif")
			}
		}
		subtotal := decimal.Zero
		for _, item := range in.Items {
			price := byID[item.ProdukID].HargaJual
			if purchase {
				price = *item.HargaBeli
			}
			line, err := LineSubtotal(item.Jumlah, price, item.Diskon)
			if err != nil {
				return err
			}
			subtotal = subtotal.Add(line)
			// Penjualan tetap dicatat saat stok kurang; saldo stok boleh negatif.
		}
		if !Money(subtotal) || in.DiskonTransaksi.GreaterThan(subtotal) {
			return apperror.Invalid("Subtotal terlalu besar atau diskon transaksi melebihi subtotal")
		}
		header := model.Header{PenggunaID: userID, MetodePembayaranID: in.MetodePembayaranID,
			IdempotencyKey: in.IdempotencyKey, RequestHash: hash,
			Status: "DRAFT", SubtotalBarang: subtotal, DiskonTransaksi: in.DiskonTransaksi,
			NomorReferensi: in.NomorReferensi, Catatan: in.Catatan}
		if purchase {
			record := model.Pembelian{Header: header, SumberPembelianID: in.SumberPembelianID, NomorNota: in.NomorNota}
			if err := tx.Omit("Detail").Create(&record).Error; err != nil {
				return err
			}
			details := make([]model.DetailPembelian, 0, len(in.Items))
			for _, item := range in.Items {
				details = append(details, model.DetailPembelian{
					Detail:      model.Detail{NamaProduk: byID[item.ProdukID].Nama, ProdukID: item.ProdukID, Jumlah: item.Jumlah, Diskon: item.Diskon},
					PembelianID: record.ID, HargaBeli: *item.HargaBeli,
				})
			}
			// Satu INSERT untuk seluruh detail; GORM mengisi ID dari PostgreSQL RETURNING.
			if err := tx.Create(&details).Error; err != nil {
				return err
			}
			movements := make([]model.MutasiStok, 0, len(details))
			for i := range details {
				detail := &details[i]
				movements = append(movements, model.MutasiStok{
					ProdukID: detail.ProdukID, PenggunaID: userID, DetailPembelianID: &detail.ID,
					Jenis: "PEMBELIAN", Perubahan: detail.Jumlah,
				})
			}
			// Tetap memakai tx yang sama agar kegagalan salah satu batch membatalkan semuanya.
			if err := tx.Create(&movements).Error; err != nil {
				return err
			}
			if err := tx.Model(&record).Update("status", "SELESAI").Error; err != nil {
				return err
			}
			if err := tx.Preload("Detail").First(&record, record.ID).Error; err != nil {
				return err
			}
			if cashNote != nil {
				if !record.TotalPembayaran.Equal(cashNote.Total) {
					return apperror.Invalid("Total rincian pembelian harus sama dengan total catatan pengeluaran")
				}
				if err := tx.Model(cashNote).Updates(map[string]any{"status": "SELESAI", "pembelian_id": record.ID}).Error; err != nil {
					return err
				}
			} else {
				// Catat otomatis dalam transaksi yang sama; satu pembelian hanya punya satu catatan.
				key := fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("auto-purchase:%d", record.ID))))
				autoNote := model.CatatanBelanja{IdempotencyKey: key, RequestHash: digest(record.ID), Tanggal: model.ReportDate(record.Tanggal.In(dailyLocation).Format("2006-01-02")), Total: record.TotalPembayaran, Catatan: "Pembelian " + record.Nomor, PenggunaID: userID, Status: "SELESAI", PembelianID: &record.ID}
				if err := tx.Create(&autoNote).Error; err != nil {
					return err
				}
			}
			output = record
		} else {
			record := model.Penjualan{Header: header, JumlahDibayar: in.JumlahDibayar}
			if in.TanggalPendapatan != nil {
				record.TanggalPendapatan = model.ReportDate(*in.TanggalPendapatan)
			}
			if err := tx.Omit("Detail").Create(&record).Error; err != nil {
				return err
			}
			// GORM tidak otomatis memuat semua hasil BEFORE trigger; baca kembali.
			if err := tx.First(&record, record.ID).Error; err != nil {
				return err
			}
			if in.JumlahDibayar.LessThan(record.TotalTagihan) {
				return apperror.Invalid("Jumlah dibayar kurang dari total tagihan")
			}
			details := make([]model.DetailPenjualan, 0, len(in.Items))
			for _, item := range in.Items {
				details = append(details, model.DetailPenjualan{
					Detail:      model.Detail{NamaProduk: byID[item.ProdukID].Nama, ProdukID: item.ProdukID, Jumlah: item.Jumlah, Diskon: item.Diskon},
					PenjualanID: record.ID, HargaJual: byID[item.ProdukID].HargaJual,
				})
			}
			// Satu INSERT untuk seluruh detail; GORM mengisi ID dari PostgreSQL RETURNING.
			if err := tx.Create(&details).Error; err != nil {
				return err
			}
			movements := make([]model.MutasiStok, 0, len(details))
			for i := range details {
				detail := &details[i]
				movements = append(movements, model.MutasiStok{
					ProdukID: detail.ProdukID, PenggunaID: userID, DetailPenjualanID: &detail.ID,
					Jenis: "PENJUALAN", Perubahan: detail.Jumlah.Neg(),
				})
			}
			// Tetap memakai tx yang sama agar kegagalan salah satu batch membatalkan semuanya.
			if err := tx.Create(&movements).Error; err != nil {
				return err
			}
			if err := tx.Model(&record).Update("status", "SELESAI").Error; err != nil {
				return err
			}
			if err := tx.Preload("Detail").First(&record, record.ID).Error; err != nil {
				return err
			}
			output = record
		}
		return nil
	})
	return output, err
}

// Cancel mempertahankan riwayat. Mutasi lama tidak dihapus; dibuat pembalikannya.
func (s *Service) Cancel(ctx context.Context, userID, id int64, purchase bool, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return apperror.Invalid("Alasan pembatalan wajib diisi")
	}
	return s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var movements []model.MutasiStok
		var status string
		table, detailTable, foreignKey := "penjualan", "detail_penjualan", "detail_penjualan_id"
		if purchase {
			table, detailTable, foreignKey = "pembelian", "detail_pembelian", "detail_pembelian_id"
		}
		// Nama tabel berasal dari konstanta internal, bukan input pengguna.
		var header struct {
			ID     int64
			Status string
		}
		if err := tx.Table(table).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&header).Error; err != nil {
			return err
		}
		status = header.Status
		if status != "SELESAI" {
			return apperror.Conflict("Hanya transaksi selesai yang dapat dibatalkan")
		}
		subquery := tx.Table(detailTable).Select("id").Where(table+"_id = ?", id)
		kind := "PENJUALAN"
		if purchase {
			kind = "PEMBELIAN"
		}
		if err := tx.Where(foreignKey+" IN (?) AND jenis = ?", subquery, kind).Order("produk_id").Find(&movements).Error; err != nil {
			return err
		}
		if len(movements) == 0 {
			return apperror.Conflict("Transaksi tidak memiliki mutasi stok")
		}
		ids := make([]int64, 0, len(movements))
		for _, movement := range movements {
			ids = append(ids, movement.ProdukID)
		}
		if _, err := repository.LockProducts(tx, ids); err != nil {
			return err
		}
		for _, old := range movements {
			if purchase {
				stock, err := repository.Stock(tx, old.ProdukID)
				if err != nil {
					return err
				}
				if stock.LessThan(old.Perubahan) {
					return apperror.Conflict("Pembelian tidak bisa dibatalkan karena stok sudah digunakan")
				}
			}
			movement := model.MutasiStok{ProdukID: old.ProdukID, PenggunaID: userID,
				DetailPenjualanID: old.DetailPenjualanID, DetailPembelianID: old.DetailPembelianID,
				Jenis: "PEMBALIKAN", Perubahan: old.Perubahan.Neg(), Catatan: &reason}
			if err := tx.Create(&movement).Error; err != nil {
				return err
			}
		}
		if err := tx.Table(table).Where("id = ?", id).Updates(map[string]any{"status": "BATAL"}).Error; err != nil {
			return err
		}
		if purchase {
			return tx.Model(&model.CatatanBelanja{}).Where("pembelian_id = ? AND status = 'SELESAI'", id).Update("status", "BATAL").Error
		}
		return nil
	})
}

type StockInput struct {
	Jenis     string          `json:"jenis"`
	Perubahan decimal.Decimal `json:"perubahan"`
	Catatan   string          `json:"catatan"`
}

func (s *Service) AdjustStock(ctx context.Context, userID, productID int64, in StockInput) (model.MutasiStok, error) {
	var result model.MutasiStok
	if (in.Jenis != "AWAL" && in.Jenis != "PENYESUAIAN") || !Quantity(in.Perubahan.Abs()) || strings.TrimSpace(in.Catatan) == "" || (in.Jenis == "AWAL" && in.Perubahan.IsNegative()) {
		return result, apperror.Invalid("Jenis AWAL/PENYESUAIAN, perubahan bukan nol maksimal 3 desimal, dan catatan wajib")
	}
	err := s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		products, err := repository.LockProducts(tx, []int64{productID})
		if err != nil {
			return err
		}
		if len(products) != 1 {
			return gorm.ErrRecordNotFound
		}
		if !products[0].Aktif {
			return apperror.Invalid("Produk tidak aktif")
		}
		stock, err := repository.Stock(tx, productID)
		if err != nil {
			return err
		}
		if stock.Add(in.Perubahan).IsNegative() {
			return apperror.Conflict("Penyesuaian menghasilkan stok negatif")
		}
		result = model.MutasiStok{ProdukID: productID, PenggunaID: userID, Jenis: in.Jenis, Perubahan: in.Perubahan, Catatan: &in.Catatan}
		return tx.Create(&result).Error
	})
	return result, err
}
