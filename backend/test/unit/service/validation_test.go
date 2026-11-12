package service_test

import (
	"github.com/shopspring/decimal"
	"testing"
	"toko/backend/internal/service"
)

func TestLineSubtotal(t *testing.T) {
	cases := []struct {
		name, qty, price, discount, want string
		invalid                          bool
	}{
		{"fractional quantity", "0.125", "12500", "0", "1562.50", false},
		{"half rupiah rounds up", "0.333", "5", "0", "1.67", false},
		{"discount", "2", "10000", "1500", "18500", false},
		{"excess discount", "1", "100", "101", "", true},
		{"zero quantity", "0", "100", "0", "", true},
		{"quantity precision", "1.0001", "100", "0", "", true},
		{"price precision", "1", "100.001", "0", "", true},
		{"overflow", "999999999999999", "999999999999999", "0", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := service.LineSubtotal(decimal.RequireFromString(tc.qty), decimal.RequireFromString(tc.price), decimal.RequireFromString(tc.discount))
			if tc.invalid {
				if err == nil {
					t.Fatal("expected validation error")
				}
				return
			}
			if err != nil || !got.Equal(decimal.RequireFromString(tc.want)) {
				t.Fatalf("got %s, %v; want %s", got, err, tc.want)
			}
		})
	}
}
