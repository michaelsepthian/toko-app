package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSaleIncomeDateValidation(t *testing.T) {
	// Tengah malam WIB sudah 1 November walau UTC masih 31 Oktober.
	now := time.Date(2026, 10, 31, 17, 0, 0, 0, time.UTC)
	for _, value := range []string{"2026-11-01", "2026-10-31", "2024-02-29"} {
		if got, err := saleIncomeDate(value, now); err != nil || string(got) != value {
			t.Fatalf("valid date %q: %s %v", value, got, err)
		}
	}
	for _, value := range []string{"", "2026-11-02", "2026-02-29", "2026-11-31", "2026-1-01", "2026-11-01T00:00:00Z", "0000-01-01"} {
		if _, err := saleIncomeDate(value, now); err == nil {
			t.Fatalf("accepted invalid date %q", value)
		}
	}
	date := "2026-01-01"
	if _, err := (TransactionInput{TanggalPendapatan: &date}).validate(true); err == nil || !strings.Contains(err.Error(), "hanya untuk penjualan") {
		t.Fatal("purchase accepted an income date", err)
	}
}

func TestLegacyTransactionRequestHashOmitsIncomeDate(t *testing.T) {
	raw, err := json.Marshal(TransactionInput{})
	if err != nil || strings.Contains(string(raw), "tanggal_pendapatan") {
		t.Fatal("new optional field changes the legacy idempotency payload", string(raw), err)
	}
}
