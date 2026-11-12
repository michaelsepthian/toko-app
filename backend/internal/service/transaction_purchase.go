package service

import (
	"crypto/md5"
	"fmt"

	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

// createPurchase memakai transaksi dan product lock milik CreateTransaction.
// Header, detail, mutasi stok, dan catatan pengeluaran harus commit bersamaan.
func createPurchase(tx *repository.Store, userID int64, header model.Header, in TransactionInput, products map[int64]model.Produk, cashNote *model.CatatanBelanja) (model.Pembelian, error) {
	record := model.Pembelian{
		Header:            header,
		SumberPembelianID: in.SumberPembelianID,
		NomorNota:         in.NomorNota,
	}
	if err := tx.CreatePurchase(&record); err != nil {
		return record, err
	}

	details := make([]model.DetailPembelian, 0, len(in.Items))
	for _, item := range in.Items {
		details = append(details, model.DetailPembelian{
			Detail: model.Detail{
				NamaProduk: products[item.ProdukID].Nama,
				ProdukID:   item.ProdukID,
				Jumlah:     item.Jumlah,
				Diskon:     item.Diskon,
			},
			PembelianID: record.ID,
			HargaBeli:   *item.HargaBeli,
		})
	}
	// Satu INSERT untuk seluruh detail; GORM mengisi ID dari PostgreSQL RETURNING.
	if err := tx.CreatePurchaseDetails(details); err != nil {
		return record, err
	}

	movements := make([]model.MutasiStok, 0, len(details))
	for i := range details {
		detail := &details[i]
		movements = append(movements, model.MutasiStok{
			ProdukID:          detail.ProdukID,
			PenggunaID:        userID,
			DetailPembelianID: &detail.ID,
			Jenis:             "PEMBELIAN",
			Perubahan:         detail.Jumlah,
		})
	}
	if err := tx.CreateMovements(movements); err != nil {
		return record, err
	}
	if err := tx.CompleteTransaction(model.Purchase, record.ID); err != nil {
		return record, err
	}
	if err := tx.ReloadPurchase(&record); err != nil {
		return record, err
	}

	return record, completePurchaseNote(tx, userID, record, cashNote)
}

func completePurchaseNote(tx *repository.Store, userID int64, record model.Pembelian, cashNote *model.CatatanBelanja) error {
	if cashNote != nil {
		if !record.TotalPembayaran.Equal(cashNote.Total) {
			return apperror.Invalid("Total rincian pembelian harus sama dengan total catatan pengeluaran")
		}
		return tx.CompleteCashNote(cashNote.ID, record.ID, userID)
	}

	// Catat otomatis dalam transaksi yang sama; satu pembelian hanya punya satu catatan.
	key := fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("auto-purchase:%d", record.ID))))
	autoNote := model.CatatanBelanja{
		Audit:          model.NewAudit(userID),
		IdempotencyKey: key,
		RequestHash:    digest(record.ID),
		Tanggal:        model.ReportDate(record.Tanggal.In(dailyLocation).Format("2006-01-02")),
		Total:          record.TotalPembayaran,
		Catatan:        "Pembelian " + record.Nomor,
		PenggunaID:     userID,
		Status:         "SELESAI",
		PembelianID:    &record.ID,
	}
	return tx.CreateCashNote(&autoNote)
}
