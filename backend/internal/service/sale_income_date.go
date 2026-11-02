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
	return model.ReportDate(value), nil
}
