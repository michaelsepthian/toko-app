package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"toko/backend/internal/config"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

func TestRouterKeepsHealthPublicAndBusinessRoutesAuthenticated(t *testing.T) {
	// Tanpa DB: health tidak boleh mengakses DB dan request anonim harus ditolak
	// sebelum mencapai handler bisnis.
	handler := New(config.Config{}, &repository.Store{})
	tests := []struct {
		method string
		path   string
		status int
	}{
		{http.MethodGet, "/healthz", http.StatusOK},
		{http.MethodGet, "/api/v1/me", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/auth/logout", http.StatusForbidden},
		{http.MethodGet, "/api/v1/stok", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/produk/1/mutasi", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/produk/1/mutasi", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/penjualan", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/pembelian", http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, httptest.NewRequest(tt.method, tt.path, nil))
			if res.Code != tt.status {
				t.Fatalf("expected %d, got %d: %s", tt.status, res.Code, res.Body.String())
			}
			if res.Header().Get("X-Request-ID") == "" {
				t.Fatal("request ID middleware missing")
			}
		})
	}
}

func TestTransactionAndStockOwnerRoutesRejectCashierBeforeDatabase(t *testing.T) {
	mux := http.NewServeMux()
	svc := &service.Service{Store: &repository.Store{}}
	registerTransactions(mux, svc, false)
	registerTransactions(mux, svc, true)
	registerStock(mux, svc)
	tests := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/pembelian"},
		{http.MethodPost, "/api/v1/pembelian"},
		{http.MethodGet, "/api/v1/pembelian/1"},
		{http.MethodPost, "/api/v1/pembelian/1/batal"},
		{http.MethodPost, "/api/v1/penjualan/1/batal"},
		{http.MethodPost, "/api/v1/produk/1/mutasi"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			req = req.WithContext(context.WithValue(req.Context(), userKey{}, model.Pengguna{Peran: "KASIR"}))
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
			}
		})
	}
}
