package httpapi

import (
	"time"
	"toko/backend/internal/apperror"
)

var historyLocation = time.FixedZone("WIB", 7*60*60)

// Batas akhir eksklusif: transaksi tepat pukul 00.00 hari berikutnya tidak ikut.
func historyDay(value string, now time.Time) (time.Time, time.Time, error) {
	if value == "" {
		value = now.In(historyLocation).Format("2006-01-02")
	}
	start, err := time.ParseInLocation("2006-01-02", value, historyLocation)
	if err != nil || len(value) != 10 {
		return time.Time{}, time.Time{}, apperror.Invalid("Tanggal harus valid dengan format YYYY-MM-DD")
	}
	return start, start.AddDate(0, 0, 1), nil
}
