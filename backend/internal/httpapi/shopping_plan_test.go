package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

func TestShoppingOwnerRoutesRejectCashierBeforeDatabase(t *testing.T) {
	mux := http.NewServeMux()
	registerShoppingPlans(mux, &service.Service{})
	for _, route := range []struct{ method, path string }{
		{"POST", "/api/v1/rencana-belanja/pindah"},
		{"PUT", "/api/v1/rencana-belanja/1"},
		{"POST", "/api/v1/rencana-belanja/1/hapus"},
	} {
		req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, model.Pengguna{Base: model.Base{ID: 1}, Peran: "KASIR"}))
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusForbidden {
			t.Fatalf("%s %s: got %d", route.method, route.path, res.Code)
		}
	}
}

func TestShoppingReadFiltersAndChecklistValidation(t *testing.T) {
	mux := http.NewServeMux()
	registerShoppingPlans(mux, &service.Service{})
	for _, path := range []string{"/api/v1/rencana-belanja", "/api/v1/rencana-belanja?tanggal=2026-02-29", "/api/v1/rencana-belanja/kalender?bulan=2026-13"} {
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		if res.Code != 400 {
			t.Fatalf("invalid filter accepted: %s, %d", path, res.Code)
		}
	}
	for _, body := range []string{`{}`, `{"dibeli":null}`, `{"dibeli":true,"sumber_pembelian_id":2}`} {
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, httptest.NewRequest("PUT", "/api/v1/rencana-belanja/1/checklist", strings.NewReader(body)))
		if res.Code != 400 {
			t.Fatal("invalid checklist body accepted", body, res.Code)
		}
	}
}
