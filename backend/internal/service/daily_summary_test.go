package service

import (
	"encoding/json"
	"github.com/shopspring/decimal"
	"strings"
	"testing"
	"time"
	"toko/backend/internal/model"
)

func TestDailySummaryCashReconciliation(t *testing.T) {

	snapshot := DailySnapshot{TotalSelesai: decimal.NewFromInt(300000), TotalPembelian: decimal.NewFromInt(70000), AlokasiSebelumnya: decimal.NewFromInt(50000)}
	expected, diff, left, totalExpected, totalActual := ReconcileCash(snapshot, decimal.NewFromInt(279000), decimal.NewFromInt(350000))
	if !expected.Equal(decimal.NewFromInt(280000)) || !diff.Equal(decimal.NewFromInt(-1000)) || !left.Equal(decimal.NewFromInt(-71000)) || !totalExpected.Equal(decimal.NewFromInt(280000)) || !totalActual.Equal(decimal.NewFromInt(279000)) {
		t.Fatal(expected, diff, left, totalExpected, totalActual)
	}
}
func TestDailySummaryValidationAndDay(t *testing.T) {
	actual := decimal.NewFromInt(50000)
	input := DailySummaryInput{IdempotencyKey: "00000000-0000-4000-8000-000000000001", Tanggal: "2026-01-02", HashSumber: strings.Repeat("a", 64), NamaToko: "Test", KasAktual: &actual, BelanjaBesok: decimal.NewFromInt(10000)}
	if err := input.validate(); err != nil {
		t.Fatal(err)
	}
	invalid := input
	invalid.KasAktual = nil
	if invalid.validate() == nil {
		t.Fatal("missing counted cash accepted")
	}
	invalid = input
	invalid.BelanjaBesok = decimal.NewFromInt(50001)
	if invalid.validate() != nil {
		t.Fatal("allocation above funds must be allowed")
	}
	invalid = input
	invalid.EmailTujuan = "Person <test@example.com>"
	if invalid.validate() == nil {
		t.Fatal("display name email accepted")
	}
	now := time.Date(2026, 10, 31, 0, 0, 0, 0, dailyLocation)
	start, end, err := SummaryDay("2026-10-30", now)
	if err != nil || start.UTC().Format(time.RFC3339) != "2026-10-29T17:00:00Z" || end.Sub(start) != 24*time.Hour {
		t.Fatal(start, end, err)
	}
	if _, _, err := SummaryDay("2026-11-01", now); err == nil {
		t.Fatal("future day accepted")
	}
	if _, _, err := SummaryDay("2026-02-30", now); err == nil {
		t.Fatal("invalid date accepted")
	}
}
func TestDailySummaryEmailEscapesDataAndContainsCashBudget(t *testing.T) {
	snapshot := DailySnapshot{Tanggal: "2026-01-02", DihitungPada: time.Now(), TotalCash: decimal.NewFromInt(100000), Metode: []DailyPayment{{Nama: "<script>payment()</script>", TotalSelesai: decimal.NewFromInt(100000)}}}
	raw, _ := json.Marshal(snapshot)
	record := model.RingkasanHarian{ID: 5, Tanggal: "2026-01-02", NamaToko: "Toko <img src=x onerror=alert(1)>", NamaPencatat: "Owner", KasAktual: decimal.NewFromInt(74000), BelanjaBesok: decimal.NewFromInt(25000), SisaKas: decimal.NewFromInt(49000), Catatan: "<script>note()</script>", Snapshot: raw, CreatedAt: time.Now()}
	email, err := BuildDailySummaryEmail(record)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(email.HTML, "<script>") || strings.Contains(email.HTML, "<img src=x") || !strings.Contains(email.HTML, "&lt;script&gt;") {
		t.Fatal("HTML not escaped")
	}
	for _, text := range []string{"Rp 74.000", "Rp 25.000", "Rp 49.000", "Total semua metode"} {
		if !strings.Contains(email.HTML, text) {
			t.Fatal("missing HTML field", text)
		}
	}
	if !strings.Contains(email.Text, "Alokasi: Rp 25.000") || !strings.Contains(email.Subject, "2 Januari 2026") {
		t.Fatal("incomplete email")
	}
}
