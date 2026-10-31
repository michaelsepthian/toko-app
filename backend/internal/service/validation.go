package service

import (
	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
)

var maxMoney = decimal.RequireFromString("9999999999999999.99")
var maxQuantity = decimal.RequireFromString("999999999999999.999")

// Pengujian kesetaraan setelah Round mencegah pembulatan input diam-diam.
func Money(value decimal.Decimal) bool {
	return !value.IsNegative() && value.Equal(value.Round(2)) && value.LessThanOrEqual(maxMoney)
}
func Quantity(value decimal.Decimal) bool {
	return value.IsPositive() && value.Equal(value.Round(3)) && value.LessThanOrEqual(maxQuantity)
}
func LineSubtotal(quantity, price, discount decimal.Decimal) (decimal.Decimal, error) {
	if !Quantity(quantity) || !Money(price) || !Money(discount) {
		return decimal.Zero, apperror.Invalid("Jumlah maksimal 3 desimal; harga dan diskon maksimal 2 desimal serta tidak negatif")
	}
	gross := quantity.Mul(price)
	if discount.GreaterThan(gross) {
		return decimal.Zero, apperror.Invalid("Diskon detail melebihi nilai barang")
	}
	total := gross.Sub(discount).Round(2)
	if !Money(total) {
		return decimal.Zero, apperror.Invalid("Nilai detail melebihi kapasitas nominal")
	}
	return total, nil
}
