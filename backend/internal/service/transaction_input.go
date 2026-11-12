package service

import (
	"sort"
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
)

type ItemInput struct {
	ProdukID  int64            `json:"produk_id"`
	Jumlah    decimal.Decimal  `json:"jumlah"`
	Diskon    decimal.Decimal  `json:"diskon"`
	HargaBeli *decimal.Decimal `json:"harga_beli,omitempty"`
}

// Command bisnis, bukan DTO HTTP. Urutan field/tag dipertahankan karena menjadi
// format hash idempotency untuk request pending yang telah tersimpan sebelumnya.
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
