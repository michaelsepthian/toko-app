package model

import (
	"time"

	"github.com/shopspring/decimal"
)

// Snapshot diserialisasi sebagai dokumen laporan tersimpan, bukan model ORM.
// Tag JSON adalah format snapshot versi 2 dan harus tetap kompatibel.
type DailyPayment struct {
	MetodePembayaranID int64           `json:"metode_pembayaran_id"`
	Nama               string          `json:"nama"`
	Jenis              string          `json:"jenis"`
	JumlahSelesai      int64           `json:"jumlah_selesai"`
	JumlahBatal        int64           `json:"jumlah_batal"`
	TotalSelesai       decimal.Decimal `json:"total_selesai"`
	TotalBatal         decimal.Decimal `json:"total_batal"`
	BiayaToko          decimal.Decimal `json:"biaya_toko"`
}

type DailyPurchase struct {
	CatatanID    *int64              `json:"catatan_id"`
	PembelianID  *int64              `json:"pembelian_id"`
	Nomor        string              `json:"nomor"`
	Metode       string              `json:"metode"`
	Total        decimal.Decimal     `json:"total"`
	BelumDirinci bool                `json:"belum_dirinci"`
	Catatan      string              `json:"catatan"`
	Items        []DailyPurchaseItem `json:"items"`
}

type DailyPurchaseItem struct {
	Nama     string          `json:"nama"`
	Jumlah   decimal.Decimal `json:"jumlah"`
	Subtotal decimal.Decimal `json:"subtotal"`
}

type DailySnapshot struct {
	Versi                  int             `json:"versi"`
	TotalPembelian         decimal.Decimal `json:"total_pembelian"`
	AlokasiSebelumnya      decimal.Decimal `json:"alokasi_sebelumnya"`
	AlokasiSebelumnyaID    *int64          `json:"alokasi_sebelumnya_id"`
	SelisihBelanja         decimal.Decimal `json:"selisih_belanja"`
	Pembelian              []DailyPurchase `json:"pembelian"`
	PembelianBelumDirinci  decimal.Decimal `json:"pembelian_belum_dirinci"`
	Tanggal                string          `json:"tanggal"`
	DihitungPada           time.Time       `json:"dihitung_pada"`
	HashSumber             string          `json:"hash_sumber"`
	JumlahSelesai          int64           `json:"jumlah_selesai"`
	JumlahBatal            int64           `json:"jumlah_batal"`
	TotalSelesai           decimal.Decimal `json:"total_selesai"`
	TotalBatal             decimal.Decimal `json:"total_batal"`
	TotalSebelumPembatalan decimal.Decimal `json:"total_sebelum_pembatalan"`
	TotalCash              decimal.Decimal `json:"total_cash"`
	TotalNonCash           decimal.Decimal `json:"total_non_cash"`
	BiayaToko              decimal.Decimal `json:"biaya_toko"`
	TotalBersih            decimal.Decimal `json:"total_bersih"`
	PembelianCash          decimal.Decimal `json:"pembelian_cash"`
	Metode                 []DailyPayment  `json:"metode"`
}
