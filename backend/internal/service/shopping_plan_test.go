package service

import (
	"testing"

	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
)

func TestShoppingDates(t *testing.T) {
	for _, value := range []string{"2028-02-29", "2026-01-01", "2030-12-31"} {
		if _, err := ShoppingDate(value); err != nil {
			t.Errorf("valid date %s: %v", value, err)
		}
	}
	for _, value := range []string{"", "2026-02-29", "2026-13-01", "2026-1-1", "0000-01-01", "2026-11-10T00:00:00Z"} {
		if _, err := ShoppingDate(value); err == nil {
			t.Errorf("invalid date accepted: %s", value)
		}
	}
}

func TestShoppingOptionalQuantity(t *testing.T) {
	base := ShoppingItemInput{NamaBarang: "Kantong"}
	if err := validateShoppingItem(base); err != nil {
		t.Fatal("null quantity must be accepted", err)
	}
	for _, value := range []string{"1", "0.001", "12.345"} {
		quantity := decimal.RequireFromString(value)
		base.Jumlah = &quantity
		if err := validateShoppingItem(base); err != nil {
			t.Errorf("valid quantity %s: %v", value, err)
		}
	}
	for _, value := range []string{"0", "-1", "0.0001", "1000000000000000"} {
		quantity := decimal.RequireFromString(value)
		base.Jumlah = &quantity
		if err := validateShoppingItem(base); err == nil {
			t.Errorf("invalid quantity accepted: %s", value)
		}
	}
	if err := validateShoppingItem(ShoppingItemInput{NamaBarang: "  "}); err == nil {
		t.Fatal("blank free-name item accepted")
	}
}

func TestShoppingPermissions(t *testing.T) {
	for _, role := range []string{"PEMILIK", "KASIR"} {
		user := model.Pengguna{Base: model.Base{ID: 1}, Peran: model.Role(role)}
		if err := shoppingPermission(user, false); err != nil {
			t.Fatal(role, err)
		}
		if err := shoppingPermission(user, true); (err == nil) != (role == "PEMILIK") {
			t.Fatal("owner-only permission mismatch", role)
		}
	}
	if shoppingPermission(model.Pengguna{Base: model.Base{ID: 1}, Peran: "OTHER"}, false) == nil {
		t.Fatal("unknown role accepted")
	}
}
