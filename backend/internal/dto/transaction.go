package dto

import (
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type ItemRequest struct {
	ProdukID  int64            `json:"produk_id"`
	Jumlah    decimal.Decimal  `json:"jumlah"`
	Diskon    decimal.Decimal  `json:"diskon"`
	HargaBeli *decimal.Decimal `json:"harga_beli,omitempty"`
}

type TransactionRequest struct {
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
	Items              []ItemRequest   `json:"items"`
}

func (r TransactionRequest) Input() service.TransactionInput {
	return service.TransactionInput{
		TanggalPendapatan: r.TanggalPendapatan, CatatanBelanjaID: r.CatatanBelanjaID,
		IdempotencyKey: r.IdempotencyKey, MetodePembayaranID: r.MetodePembayaranID,
		SumberPembelianID: r.SumberPembelianID, DiskonTransaksi: r.DiskonTransaksi, JumlahDibayar: r.JumlahDibayar,
		NomorNota: r.NomorNota, NomorReferensi: r.NomorReferensi, Catatan: r.Catatan,
		Items: Map(r.Items, func(item ItemRequest) service.ItemInput { return service.ItemInput(item) }),
	}
}

type TransactionHeaderResponse struct {
	BaseResponse
	AuditResponse
	CancellationResponse
	IdempotencyKey     *string         `json:"idempotency_key,omitempty"`
	Nomor              string          `json:"nomor"`
	PenggunaID         int64           `json:"pengguna_id"`
	MetodePembayaranID int64           `json:"metode_pembayaran_id"`
	Tanggal            time.Time       `json:"tanggal"`
	Status             string          `json:"status"`
	SubtotalBarang     decimal.Decimal `json:"subtotal_barang"`
	DiskonTransaksi    decimal.Decimal `json:"diskon_transaksi"`
	TotalBelanja       decimal.Decimal `json:"total_belanja"`
	TarifPersen        decimal.Decimal `json:"tarif_persen"`
	TarifTetap         decimal.Decimal `json:"tarif_tetap"`
	BiayaPembayaran    decimal.Decimal `json:"biaya_pembayaran"`
	NomorReferensi     *string         `json:"nomor_referensi"`
	Catatan            *string         `json:"catatan"`
}

func header(row model.Header) TransactionHeaderResponse {
	return TransactionHeaderResponse{
		BaseResponse: base(row.Base), AuditResponse: audit(row.Audit), CancellationResponse: cancellation(row.Cancellation),
		IdempotencyKey: row.IdempotencyKey, Nomor: row.Nomor, PenggunaID: row.PenggunaID,
		MetodePembayaranID: row.MetodePembayaranID, Tanggal: row.Tanggal, Status: string(row.Status),
		SubtotalBarang: row.SubtotalBarang, DiskonTransaksi: row.DiskonTransaksi, TotalBelanja: row.TotalBelanja,
		TarifPersen: row.TarifPersen, TarifTetap: row.TarifTetap, BiayaPembayaran: row.BiayaPembayaran,
		NomorReferensi: row.NomorReferensi, Catatan: row.Catatan,
	}
}

func cancellation(row model.Cancellation) CancellationResponse {
	return CancellationResponse{CancelTransactionAt: row.CancelTransactionAt, CancelTransactionBy: row.CancelTransactionBy}
}

type TransactionItemResponse struct {
	BaseResponse
	NamaProduk string          `json:"nama_produk"`
	ProdukID   int64           `json:"produk_id"`
	Jumlah     decimal.Decimal `json:"jumlah"`
	Diskon     decimal.Decimal `json:"diskon"`
	Subtotal   decimal.Decimal `json:"subtotal"`
}

func item(row model.Detail) TransactionItemResponse {
	return TransactionItemResponse{BaseResponse: base(row.Base), NamaProduk: row.NamaProduk, ProdukID: row.ProdukID, Jumlah: row.Jumlah, Diskon: row.Diskon, Subtotal: row.Subtotal}
}

type SaleItemResponse struct {
	TransactionItemResponse
	PenjualanID int64           `json:"penjualan_id"`
	HargaJual   decimal.Decimal `json:"harga_jual"`
}

type PurchaseItemResponse struct {
	TransactionItemResponse
	PembelianID int64           `json:"pembelian_id"`
	HargaBeli   decimal.Decimal `json:"harga_beli"`
}

type SaleResponse struct {
	TransactionHeaderResponse
	TanggalPendapatan string             `json:"tanggal_pendapatan"`
	PenanggungBiaya   string             `json:"penanggung_biaya"`
	TotalTagihan      decimal.Decimal    `json:"total_tagihan"`
	JumlahDibayar     decimal.Decimal    `json:"jumlah_dibayar"`
	Kembalian         decimal.Decimal    `json:"kembalian"`
	Detail            []SaleItemResponse `json:"detail"`
}

func Sale(row model.Penjualan) SaleResponse {
	return SaleResponse{
		TransactionHeaderResponse: header(row.Header), TanggalPendapatan: string(row.TanggalPendapatan),
		PenanggungBiaya: string(row.PenanggungBiaya), TotalTagihan: row.TotalTagihan, JumlahDibayar: row.JumlahDibayar, Kembalian: row.Kembalian,
		Detail: Map(row.Detail, func(d model.DetailPenjualan) SaleItemResponse {
			return SaleItemResponse{TransactionItemResponse: item(d.Detail), PenjualanID: d.PenjualanID, HargaJual: d.HargaJual}
		}),
	}
}

type SaleDetailResponse struct {
	SaleResponse
	NamaKasir string `json:"nama_kasir"`
}

type PurchaseResponse struct {
	TransactionHeaderResponse
	SumberPembelianID *int64                 `json:"sumber_pembelian_id"`
	NomorNota         *string                `json:"nomor_nota"`
	TotalPembayaran   decimal.Decimal        `json:"total_pembayaran"`
	Detail            []PurchaseItemResponse `json:"detail"`
}

func Purchase(row model.Pembelian) PurchaseResponse {
	return PurchaseResponse{
		TransactionHeaderResponse: header(row.Header), SumberPembelianID: row.SumberPembelianID,
		NomorNota: row.NomorNota, TotalPembayaran: row.TotalPembayaran,
		Detail: Map(row.Detail, func(d model.DetailPembelian) PurchaseItemResponse {
			return PurchaseItemResponse{TransactionItemResponse: item(d.Detail), PembelianID: d.PembelianID, HargaBeli: d.HargaBeli}
		}),
	}
}
