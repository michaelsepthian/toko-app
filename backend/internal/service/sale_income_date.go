package service

import (
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
)

func saleIncomeDate(value string, now time.Time) (model.ReportDate, error) {
	day, err := time.ParseInLocation("2006-01-02", value, dailyLocation)
	if err != nil || len(value) != 10 || day.Year() < 1 {
		return "", apperror.Invalid("Tanggal pendapatan harus valid dengan format YYYY-MM-DD")
	}
	if value > now.In(dailyLocation).Format("2006-01-02") {
		return "", apperror.Invalid("Tanggal pendapatan tidak boleh melewati hari ini (WIB)")
	}
	return model.ReportDate(value), nil
}
