package service

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/shopspring/decimal"
	"html/template"
	"strings"
	"time"
	"toko/backend/internal/model"
)

//go:embed templates/daily_summary.html
var dailyEmailHTML string

type DailyEmail struct {
	Subject string  `json:"subject"`
	HTML    string  `json:"html"`
	Text    string  `json:"text"`
	To      *string `json:"to"`
}

func summaryMoney(value decimal.Decimal) string {
	fixed := value.Abs().StringFixed(2)
	parts := strings.Split(fixed, ".")
	whole := parts[0]
	var grouped []string
	for len(whole) > 3 {
		grouped = append([]string{whole[len(whole)-3:]}, grouped...)
		whole = whole[:len(whole)-3]
	}
	grouped = append([]string{whole}, grouped...)
	result := "Rp " + strings.Join(grouped, ".")
	if parts[1] != "00" {
		result += "," + parts[1]
	}
	if value.IsNegative() {
		result = "−" + result
	}
	return result
}
func summaryDate(value string) string {
	date, err := time.Parse("2006-01-02", value)
	if err != nil {
		return value
	}
	months := []string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
	return fmt.Sprintf("%d %s %d", date.Day(), months[int(date.Month())-1], date.Year())
}

var dailyHTMLTemplate = template.Must(template.New("daily-summary").Funcs(template.FuncMap{"money": summaryMoney}).Parse(dailyEmailHTML))

func BuildDailySummaryEmail(record model.RingkasanHarian) (DailyEmail, error) {
	var snapshot DailySnapshot
	if err := json.Unmarshal(record.Snapshot, &snapshot); err != nil {
		return DailyEmail{}, err
	}
	view := struct {
		Record                      model.RingkasanHarian
		Snapshot                    DailySnapshot
		Tanggal, Disimpan, Dihitung string
	}{record, snapshot, summaryDate(string(record.Tanggal)), record.CreatedAt.In(dailyLocation).Format("02/01/2006 15:04:05"), snapshot.DihitungPada.In(dailyLocation).Format("02/01/2006 15:04:05")}
	var html bytes.Buffer
	if err := dailyHTMLTemplate.Execute(&html, view); err != nil {
		return DailyEmail{}, err
	}
	var text strings.Builder
	fmt.Fprintf(&text, "RINGKASAN HARIAN — %s\n%s (WIB)\n\nPENJUALAN\nBerhasil: %d transaksi / %s\nDibatalkan: %d transaksi / %s\nTotal sebelum pembatalan: %s\n\nPER METODE PEMBAYARAN\n", record.NamaToko, view.Tanggal, snapshot.JumlahSelesai, summaryMoney(snapshot.TotalSelesai), snapshot.JumlahBatal, summaryMoney(snapshot.TotalBatal), summaryMoney(snapshot.TotalSebelumPembatalan))
	for _, payment := range snapshot.Metode {
		fmt.Fprintf(&text, "%s: %d berhasil / %s; %d batal / %s\n", payment.Nama, payment.JumlahSelesai, summaryMoney(payment.TotalSelesai), payment.JumlahBatal, summaryMoney(payment.TotalBatal))
	}

	fmt.Fprintf(&text, "Total semua metode: %s\nTunai: %s\nNon-tunai: %s\n\n", summaryMoney(snapshot.TotalSelesai), summaryMoney(snapshot.TotalCash), summaryMoney(snapshot.TotalNonCash))
	if snapshot.Versi >= 2 {
		fmt.Fprintf(&text, "BELANJA HARI INI\nAlokasi dari kemarin: %s\nTotal belanja semua metode: %s\nSisa / kekurangan anggaran: %s\n", summaryMoney(snapshot.AlokasiSebelumnya), summaryMoney(snapshot.TotalPembelian), summaryMoney(snapshot.SelisihBelanja))
		for _, purchase := range snapshot.Pembelian {
			fmt.Fprintf(&text, "%s %s: %s\n", purchase.Nomor, purchase.Metode, summaryMoney(purchase.Total))
			for _, item := range purchase.Items {
				fmt.Fprintf(&text, "  %s × %s: %s\n", item.Nama, item.Jumlah.String(), summaryMoney(item.Subtotal))
			}
		}
	} else {
		fmt.Fprintf(&text, "Uang fisik (format lama): %s\nPembelian tunai (format lama): %s\n", summaryMoney(record.KasAktual), summaryMoney(snapshot.PembelianCash))
	}
	fmt.Fprintf(&text, "\nDANA HARIAN\nTotal dana seharusnya: %s\nTotal uang aktual: %s\nSelisih: %s\n\nBELANJA BESOK\nAlokasi: %s\nUang diterima sesungguhnya setelah alokasi: %s\n\nCatatan: %s\n\nDicatat oleh %s pada %s WIB. Laporan #%d.\nData dihitung sampai %s WIB. Pembatalan menurut tanggal pendapatan; alokasi besok belum menjadi pembelian hari ini.\n", summaryMoney(record.TotalDanaSeharusnya), summaryMoney(record.TotalDanaAktual), summaryMoney(record.SelisihKas), summaryMoney(record.BelanjaBesok), summaryMoney(record.SisaKas), record.Catatan, record.NamaPencatat, view.Disimpan, record.ID, view.Dihitung)
	name := strings.NewReplacer("\r", " ", "\n", " ").Replace(record.NamaToko)
	return DailyEmail{Subject: fmt.Sprintf("Ringkasan Penjualan | %s | %s", name, view.Tanggal), HTML: html.String(), Text: text.String(), To: record.EmailTujuan}, nil
}
