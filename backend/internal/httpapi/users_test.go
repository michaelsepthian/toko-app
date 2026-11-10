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

func TestUserEndpointsDenyCashierBeforeDatabase(t *testing.T) {
	mux := http.NewServeMux()
	registerUsers(mux, &service.Service{})
	for _, method := range []string{"GET", "POST"} {
		req := httptest.NewRequest(method, "/api/v1/pengguna", strings.NewReader(`{"nama":"Test","username":"test","password":"password-test","peran":"PEMILIK"}`))
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, model.Pengguna{Peran: "KASIR"}))
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusForbidden {
			t.Fatalf("%s got %d", method, res.Code)
		}
	}
}

func TestCreateUserRejectsUnexpectedFields(t *testing.T) {
	mux := http.NewServeMux()
	registerUsers(mux, &service.Service{})
	req := httptest.NewRequest("POST", "/api/v1/pengguna", strings.NewReader(`{"nama":"Test","username":"test","password":"password-test","peran":"KASIR","aktif":false}`))
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, model.Pengguna{Peran: "PEMILIK"}))
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("got %d", res.Code)
	}
}
