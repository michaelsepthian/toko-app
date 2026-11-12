package service

import (
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

// createSale memakai transaksi dan product lock milik CreateTransaction.
// Total final tetap berasal dari trigger database, bukan perhitungan frontend.
func createSale(tx *repository.Store, userID int64, header model.Header, in TransactionInput, products map[int64]model.Produk) (model.Penjualan, error) {
	record := model.Penjualan{Header: header, JumlahDibayar: in.JumlahDibayar}
	if in.TanggalPendapatan != nil {
		record.TanggalPendapatan = model.ReportDate(*in.TanggalPendapatan)
	}
	if err := tx.CreateSale(&record); err != nil {
		return record, err
	}
	// GORM tidak otomatis memuat semua hasil BEFORE trigger; baca kembali.
	if err := tx.ReloadSale(&record, false); err != nil {
		return record, err
	}
	if in.JumlahDibayar.LessThan(record.TotalTagihan) {
		return record, apperror.Invalid("Jumlah dibayar kurang dari total tagihan")
	}

	details := make([]model.DetailPenjualan, 0, len(in.Items))
	for _, item := range in.Items {
		details = append(details, model.DetailPenjualan{
			Detail: model.Detail{
				NamaProduk: products[item.ProdukID].Nama,
				ProdukID:   item.ProdukID,
				Jumlah:     item.Jumlah,
				Diskon:     item.Diskon,
			},
			PenjualanID: record.ID,
			HargaJual:   products[item.ProdukID].HargaJual,
		})
	}
	// Satu INSERT untuk seluruh detail; GORM mengisi ID dari PostgreSQL RETURNING.
	if err := tx.CreateSaleDetails(details); err != nil {
		return record, err
	}

	movements := make([]model.MutasiStok, 0, len(details))
	for i := range details {
		detail := &details[i]
		movements = append(movements, model.MutasiStok{
			ProdukID:          detail.ProdukID,
			PenggunaID:        userID,
			DetailPenjualanID: &detail.ID,
			Jenis:             "PENJUALAN",
			Perubahan:         detail.Jumlah.Neg(),
		})
	}
	if err := tx.CreateMovements(movements); err != nil {
		return record, err
	}
	if err := tx.CompleteTransaction(model.Sale, record.ID); err != nil {
		return record, err
	}
	if err := tx.ReloadSale(&record, true); err != nil {
		return record, err
	}
	return record, nil
}
