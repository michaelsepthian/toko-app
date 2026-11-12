package dto

import (
	"encoding/json"
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type DailySummaryRequest struct {
	VersiPerhitungan int              `json:"versi_perhitungan,omitempty"`
	IdempotencyKey   string           `json:"idempotency_key"`
	Tanggal          string           `json:"tanggal"`
	HashSumber       string           `json:"hash_sumber"`
	NamaToko         string           `json:"nama_toko"`
	EmailTujuan      string           `json:"email_tujuan"`
	KasAktual        *decimal.Decimal `json:"kas_aktual"`
	BelanjaBesok     decimal.Decimal  `json:"belanja_besok"`
	Catatan          string           `json:"catatan"`
}

func (r DailySummaryRequest) Input() service.DailySummaryInput { return service.DailySummaryInput(r) }

type DailySummaryResponse struct {
	ID                  int64           `json:"id"`
	Tanggal             string          `json:"tanggal"`
	PenggunaID          int64           `json:"pengguna_id"`
	NamaPencatat        string          `json:"nama_pencatat"`
	NamaToko            string          `json:"nama_toko"`
	EmailTujuan         *string         `json:"email_tujuan"`
	KasAktual           decimal.Decimal `json:"kas_aktual"`
	BelanjaBesok        decimal.Decimal `json:"belanja_besok"`
	TotalDanaSeharusnya decimal.Decimal `json:"total_dana_seharusnya"`
	TotalDanaAktual     decimal.Decimal `json:"total_dana_aktual"`
	KasSeharusnya       decimal.Decimal `json:"kas_seharusnya"`
	SelisihKas          decimal.Decimal `json:"selisih_kas"`
	SisaKas             decimal.Decimal `json:"sisa_kas"`
	Catatan             string          `json:"catatan"`
	Snapshot            json.RawMessage `json:"snapshot"`
	CreatedAt           time.Time       `json:"created_at"`
}

func DailySummary(row model.RingkasanHarian) DailySummaryResponse {
	return DailySummaryResponse{ID: row.ID, Tanggal: string(row.Tanggal), PenggunaID: row.PenggunaID,
		NamaPencatat: row.NamaPencatat, NamaToko: row.NamaToko, EmailTujuan: row.EmailTujuan,
		KasAktual: row.KasAktual, BelanjaBesok: row.BelanjaBesok, TotalDanaSeharusnya: row.TotalDanaSeharusnya,
		TotalDanaAktual: row.TotalDanaAktual, KasSeharusnya: row.KasSeharusnya, SelisihKas: row.SelisihKas,
		SisaKas: row.SisaKas, Catatan: row.Catatan, Snapshot: row.Snapshot, CreatedAt: row.CreatedAt}
}

type DailyPaymentResponse struct {
	MetodePembayaranID int64           `json:"metode_pembayaran_id"`
	Nama               string          `json:"nama"`
	Jenis              string          `json:"jenis"`
	JumlahSelesai      int64           `json:"jumlah_selesai"`
	JumlahBatal        int64           `json:"jumlah_batal"`
	TotalSelesai       decimal.Decimal `json:"total_selesai"`
	TotalBatal         decimal.Decimal `json:"total_batal"`
	BiayaToko          decimal.Decimal `json:"biaya_toko"`
}

type DailyPurchaseItemResponse struct {
	Nama     string          `json:"nama"`
	Jumlah   decimal.Decimal `json:"jumlah"`
	Subtotal decimal.Decimal `json:"subtotal"`
}

type DailyPurchaseResponse struct {
	CatatanID    *int64                      `json:"catatan_id"`
	PembelianID  *int64                      `json:"pembelian_id"`
	Nomor        string                      `json:"nomor"`
	Metode       string                      `json:"metode"`
	Total        decimal.Decimal             `json:"total"`
	BelumDirinci bool                        `json:"belum_dirinci"`
	Catatan      string                      `json:"catatan"`
	Items        []DailyPurchaseItemResponse `json:"items"`
}

type DailySnapshotResponse struct {
	Versi                  int                     `json:"versi"`
	TotalPembelian         decimal.Decimal         `json:"total_pembelian"`
	AlokasiSebelumnya      decimal.Decimal         `json:"alokasi_sebelumnya"`
	AlokasiSebelumnyaID    *int64                  `json:"alokasi_sebelumnya_id"`
	SelisihBelanja         decimal.Decimal         `json:"selisih_belanja"`
	Pembelian              []DailyPurchaseResponse `json:"pembelian"`
	PembelianBelumDirinci  decimal.Decimal         `json:"pembelian_belum_dirinci"`
	Tanggal                string                  `json:"tanggal"`
	DihitungPada           time.Time               `json:"dihitung_pada"`
	HashSumber             string                  `json:"hash_sumber"`
	JumlahSelesai          int64                   `json:"jumlah_selesai"`
	JumlahBatal            int64                   `json:"jumlah_batal"`
	TotalSelesai           decimal.Decimal         `json:"total_selesai"`
	TotalBatal             decimal.Decimal         `json:"total_batal"`
	TotalSebelumPembatalan decimal.Decimal         `json:"total_sebelum_pembatalan"`
	TotalCash              decimal.Decimal         `json:"total_cash"`
	TotalNonCash           decimal.Decimal         `json:"total_non_cash"`
	BiayaToko              decimal.Decimal         `json:"biaya_toko"`
	TotalBersih            decimal.Decimal         `json:"total_bersih"`
	PembelianCash          decimal.Decimal         `json:"pembelian_cash"`
	Metode                 []DailyPaymentResponse  `json:"metode"`
}

func DailySnapshot(row model.DailySnapshot) DailySnapshotResponse {
	return DailySnapshotResponse{Versi: row.Versi, TotalPembelian: row.TotalPembelian,
		AlokasiSebelumnya: row.AlokasiSebelumnya, AlokasiSebelumnyaID: row.AlokasiSebelumnyaID, SelisihBelanja: row.SelisihBelanja,
		Pembelian: Map(row.Pembelian, func(p model.DailyPurchase) DailyPurchaseResponse {
			return DailyPurchaseResponse{CatatanID: p.CatatanID, PembelianID: p.PembelianID, Nomor: p.Nomor, Metode: p.Metode,
				Total: p.Total, BelumDirinci: p.BelumDirinci, Catatan: p.Catatan,
				Items: Map(p.Items, func(i model.DailyPurchaseItem) DailyPurchaseItemResponse { return DailyPurchaseItemResponse(i) })}
		}),
		PembelianBelumDirinci: row.PembelianBelumDirinci, Tanggal: row.Tanggal, DihitungPada: row.DihitungPada,
		HashSumber: row.HashSumber, JumlahSelesai: row.JumlahSelesai, JumlahBatal: row.JumlahBatal,
		TotalSelesai: row.TotalSelesai, TotalBatal: row.TotalBatal, TotalSebelumPembatalan: row.TotalSebelumPembatalan,
		TotalCash: row.TotalCash, TotalNonCash: row.TotalNonCash, BiayaToko: row.BiayaToko, TotalBersih: row.TotalBersih,
		PembelianCash: row.PembelianCash,
		Metode:        Map(row.Metode, func(p model.DailyPayment) DailyPaymentResponse { return DailyPaymentResponse(p) }),
	}
}

type DailyEmailResponse struct {
	Subject string  `json:"subject"`
	HTML    string  `json:"html"`
	Text    string  `json:"text"`
	To      *string `json:"to"`
}

func DailyEmail(row service.DailyEmail) DailyEmailResponse { return DailyEmailResponse(row) }
