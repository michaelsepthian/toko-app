package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
)

var dailyLocation = time.FixedZone("WIB", 7*60*60)
var summaryUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

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
type dailyRow struct {
	RincianPembelian    json.RawMessage
	AlokasiSebelumnya   decimal.Decimal
	AlokasiSebelumnyaID *int64
	BelumDirinci        decimal.Decimal
	DailyPayment
	Sumber       string
	Terbaru      *time.Time
	DihitungPada time.Time
}

func digest(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func SummaryDay(value string, now time.Time) (time.Time, time.Time, error) {
	if value == "" {
		value = now.In(dailyLocation).Format("2006-01-02")
	}
	start, err := time.ParseInLocation("2006-01-02", value, dailyLocation)
	if err != nil || len(value) != 10 {
		return time.Time{}, time.Time{}, apperror.Invalid("Tanggal harus valid dengan format YYYY-MM-DD")
	}
	if start.Format("2006-01-02") > now.In(dailyLocation).Format("2006-01-02") {
		return time.Time{}, time.Time{}, apperror.Invalid("Ringkasan hanya dapat dibuat untuk hari ini atau tanggal sebelumnya")
	}
	return start, start.AddDate(0, 0, 1), nil
}

// Satu statement membuat penjualan dan pembelian memakai snapshot database yang sama.
func dailySnapshot(db *gorm.DB, start, end time.Time) (DailySnapshot, error) {
	var rows []dailyRow
	err := db.Raw(`WITH belanja AS (
 SELECT p.total_pembayaran AS total,false AS belum_dirinci,p.updated_at,
 NULL::bigint AS catatan_id,p.id AS pembelian_id,p.nomor,m.nama AS metode,''::text AS catatan
 FROM public.pembelian p JOIN public.metode_pembayaran m ON m.id=p.metode_pembayaran_id
 WHERE p.tanggal>=? AND p.tanggal<? AND p.status='SELESAI'
 AND NOT EXISTS(SELECT 1 FROM public.catatan_belanja c WHERE c.pembelian_id=p.id)
 UNION ALL
 SELECT c.total,c.status='TERBUKA',c.updated_at,c.id,c.pembelian_id,
 coalesce(p.nomor,''),coalesce(m.nama,'Belum dirinci'),c.catatan
 FROM public.catatan_belanja c LEFT JOIN public.pembelian p ON p.id=c.pembelian_id
 LEFT JOIN public.metode_pembayaran m ON m.id=p.metode_pembayaran_id
 WHERE c.tanggal=? AND c.status IN('TERBUKA','SELESAI')
 ), alokasi AS (
 SELECT id,belanja_besok FROM public.ringkasan_harian WHERE tanggal=? ORDER BY id DESC LIMIT 1
 ), harian AS (
 SELECT 'PENJUALAN' AS sumber,m.id AS metode_pembayaran_id,m.nama,m.jenis,
 count(*) FILTER(WHERE p.status='SELESAI') AS jumlah_selesai,
 count(*) FILTER(WHERE p.status='BATAL') AS jumlah_batal,
 coalesce(sum(p.total_tagihan) FILTER(WHERE p.status='SELESAI'),0) AS total_selesai,
 coalesce(sum(p.total_tagihan) FILTER(WHERE p.status='BATAL'),0) AS total_batal,
 coalesce(sum(p.biaya_pembayaran) FILTER(WHERE p.status='SELESAI' AND p.penanggung_biaya='TOKO'),0) AS biaya_toko,
 max(p.updated_at) AS terbaru,0::numeric AS belum_dirinci
 FROM public.penjualan p JOIN public.metode_pembayaran m ON m.id=p.metode_pembayaran_id
 WHERE p.tanggal>=? AND p.tanggal<? AND p.status IN ('SELESAI','BATAL')
 GROUP BY m.id,m.nama,m.jenis
 UNION ALL
 SELECT 'PEMBELIAN',0,'Semua pembelian','LAINNYA',count(*),0,coalesce(sum(total),0),0,0,max(updated_at),
 coalesce(sum(total) FILTER(WHERE belum_dirinci),0) FROM belanja
 ) SELECT harian.*,statement_timestamp() AS dihitung_pada,
 (SELECT id FROM alokasi) AS alokasi_sebelumnya_id,
 coalesce((SELECT belanja_besok FROM alokasi),0) AS alokasi_sebelumnya,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
 'catatan_id',b.catatan_id,'pembelian_id',b.pembelian_id,'nomor',b.nomor,'metode',b.metode,
 'total',b.total::text,'belum_dirinci',b.belum_dirinci,'catatan',b.catatan,
 'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('nama',d.nama_produk,'jumlah',d.jumlah::text,'subtotal',d.subtotal::text) ORDER BY d.id),'[]'::jsonb)
 FROM public.detail_pembelian d WHERE d.pembelian_id=b.pembelian_id)
 ) ORDER BY b.pembelian_id NULLS LAST,b.catatan_id),'[]'::jsonb) FROM belanja b) AS rincian_pembelian
 FROM harian ORDER BY sumber,metode_pembayaran_id`, start, end, start.Format("2006-01-02"), start.AddDate(0, 0, -1).Format("2006-01-02"), start, end).Scan(&rows).Error
	result := DailySnapshot{Versi: 2, Tanggal: start.Format("2006-01-02"), Metode: []DailyPayment{}, Pembelian: []DailyPurchase{}}
	if err != nil {
		return result, err
	}
	if len(rows) > 0 {
		result.AlokasiSebelumnya = rows[0].AlokasiSebelumnya
		result.AlokasiSebelumnyaID = rows[0].AlokasiSebelumnyaID
		if err := json.Unmarshal(rows[0].RincianPembelian, &result.Pembelian); err != nil {
			return result, err
		}
	}
	// Waktu baca tidak dimasukkan ke hash agar pengecekan ulang tidak selalu dianggap berubah.
	type source struct {
		BelumDirinci decimal.Decimal
		DailyPayment
		Sumber  string
		Terbaru *time.Time
	}
	sources := make([]source, 0, len(rows))
	for _, row := range rows {
		result.DihitungPada = row.DihitungPada
		sources = append(sources, source{row.BelumDirinci, row.DailyPayment, row.Sumber, row.Terbaru})
		if row.Sumber == "PEMBELIAN" {
			result.TotalPembelian = row.TotalSelesai
			result.PembelianCash = row.TotalSelesai // Kompatibilitas respons lama; versi 2 memakai total_pembelian.
			result.PembelianBelumDirinci = row.BelumDirinci
			continue
		}
		result.Metode = append(result.Metode, row.DailyPayment)
		result.JumlahSelesai += row.JumlahSelesai
		result.JumlahBatal += row.JumlahBatal
		result.TotalSelesai = result.TotalSelesai.Add(row.TotalSelesai)
		result.TotalBatal = result.TotalBatal.Add(row.TotalBatal)
		result.BiayaToko = result.BiayaToko.Add(row.BiayaToko)
		if row.Jenis == "CASH" {
			result.TotalCash = result.TotalCash.Add(row.TotalSelesai)
		} else {
			result.TotalNonCash = result.TotalNonCash.Add(row.TotalSelesai)
		}
	}
	result.TotalSebelumPembatalan = result.TotalSelesai.Add(result.TotalBatal)
	result.TotalBersih = result.TotalSelesai.Sub(result.BiayaToko)
	result.SelisihBelanja = result.AlokasiSebelumnya.Sub(result.TotalPembelian)
	result.HashSumber = digest(struct {
		Tanggal   string
		Rows      []source
		AlokasiID *int64
		Alokasi   decimal.Decimal
		Pembelian []DailyPurchase
	}{result.Tanggal, sources, result.AlokasiSebelumnyaID, result.AlokasiSebelumnya, result.Pembelian})
	return result, nil
}
func (s *Service) PreviewDailySummary(ctx context.Context, date string) (DailySnapshot, error) {
	start, end, err := SummaryDay(date, time.Now())
	if err != nil {
		return DailySnapshot{}, err
	}
	return dailySnapshot(s.Store.DB.WithContext(ctx), start, end)
}

type DailySummaryInput struct {
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

func (in DailySummaryInput) validate() error {
	if !summaryUUID.MatchString(in.IdempotencyKey) || len(in.HashSumber) != 64 || strings.TrimSpace(in.NamaToko) == "" || len(in.NamaToko) > 150 || len(in.Catatan) > 5000 {
		return apperror.Invalid("Identitas laporan, nama toko, atau catatan tidak valid")
	}
	if in.KasAktual == nil || !Money(*in.KasAktual) || !Money(in.BelanjaBesok) {
		return apperror.Invalid("Isi total uang yang dihitung dan nominal alokasi yang valid (maksimal 2 desimal)")
	}
	if in.EmailTujuan != "" {
		address, err := mail.ParseAddress(in.EmailTujuan)
		if err != nil || address.Address != in.EmailTujuan || len(in.EmailTujuan) > 254 {
			return apperror.Invalid("Alamat email tujuan tidak valid")
		}
	}
	return nil
}
func ReconcileCash(snapshot DailySnapshot, actual, budget decimal.Decimal) (expected, difference, remaining, totalExpected, totalActual decimal.Decimal) {
	totalExpected = snapshot.TotalSelesai.Add(snapshot.AlokasiSebelumnya).Sub(snapshot.TotalPembelian)
	expected = totalExpected
	totalActual = actual
	return expected, totalActual.Sub(totalExpected), actual.Sub(budget), totalExpected, totalActual
}
func (s *Service) SaveDailySummary(ctx context.Context, user model.Pengguna, in DailySummaryInput) (model.RingkasanHarian, error) {
	var record model.RingkasanHarian
	if err := in.validate(); err != nil {
		return record, err
	}
	start, end, err := SummaryDay(in.Tanggal, time.Now())
	if err != nil {
		return record, err
	}
	requestHash := digest(in)
	err = s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "daily-summary:"+in.IdempotencyKey).Error; err != nil {
			return err
		}
		found := tx.Where("idempotency_key = ?", in.IdempotencyKey).Take(&record).Error
		if found == nil {
			if record.PenggunaID != user.ID || record.RequestHash != requestHash {
				return apperror.Conflict("Identitas penyimpanan laporan sudah dipakai untuk data berbeda")
			}
			return nil
		}
		if !errors.Is(found, gorm.ErrRecordNotFound) {
			return found
		}
		if in.VersiPerhitungan != 2 {
			return apperror.Invalid("Perhitungan ringkasan diperbarui. Muat ulang halaman sebelum menyimpan")
		}
		snapshot, err := dailySnapshot(tx, start, end)
		if err != nil {
			return err
		}
		if snapshot.HashSumber != in.HashSumber {
			return apperror.Conflict("Data transaksi berubah. Muat ulang ringkasan sebelum menyimpan")
		}
		expected, difference, remaining, totalExpected, totalActual := ReconcileCash(snapshot, *in.KasAktual, in.BelanjaBesok)
		raw, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		var email *string
		if in.EmailTujuan != "" {
			email = &in.EmailTujuan
		}
		record = model.RingkasanHarian{IdempotencyKey: in.IdempotencyKey, RequestHash: requestHash, Tanggal: model.ReportDate(snapshot.Tanggal), PenggunaID: user.ID, NamaPencatat: user.Nama, NamaToko: strings.TrimSpace(in.NamaToko), EmailTujuan: email, KasAktual: *in.KasAktual, BelanjaBesok: in.BelanjaBesok, KasSeharusnya: expected, TotalDanaSeharusnya: totalExpected, TotalDanaAktual: totalActual, SelisihKas: difference, SisaKas: remaining, Catatan: strings.TrimSpace(in.Catatan), Snapshot: raw}
		return tx.Create(&record).Error
	})
	return record, err
}
