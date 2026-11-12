package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/shopspring/decimal"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

var dailyLocation = time.FixedZone("WIB", 7*60*60)
var summaryUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type DailyPayment = model.DailyPayment
type DailyPurchase = model.DailyPurchase
type DailyPurchaseItem = model.DailyPurchaseItem
type DailySnapshot = model.DailySnapshot

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
func dailySnapshot(store *repository.Store, start, end time.Time) (DailySnapshot, error) {
	rows, err := store.DailyRows(start, end)
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
	return dailySnapshot(s.Store.WithContext(ctx), start, end)
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
	err = s.Store.Transaction(ctx, func(tx *repository.Store) error {
		if err := tx.LockRequest("daily-summary:" + in.IdempotencyKey); err != nil {
			return err
		}
		var found error
		record, found = tx.DailySummaryByKey(in.IdempotencyKey)
		if found == nil {
			if record.PenggunaID != user.ID || record.RequestHash != requestHash {
				return apperror.Conflict("Identitas penyimpanan laporan sudah dipakai untuk data berbeda")
			}
			return nil
		}
		if !repository.IsNotFound(found) {
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
		return tx.CreateDailySummary(&record)
	})
	return record, err
}
