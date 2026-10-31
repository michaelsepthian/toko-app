package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRejectsClientTotalsAndTrailingJSON(t *testing.T) {
	for _, body := range []string{`{"nama":"A","total_tagihan":1}`, `{"nama":"A"} {"nama":"B"}`} {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		var input struct {
			Nama string `json:"nama"`
		}
		if err := decode(httptest.NewRecorder(), r, &input); err == nil {
			t.Fatal("expected rejection")
		}
	}
}

func TestAuthRejectsMissingOrInvalidToken(t *testing.T) {
	supabase := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer supabase.Close()
	auth := NewAuth(supabase.URL, "public-test-key", nil)
	handler := auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("protected handler called") }))
	for _, token := range []string{"", "Bearer invalid"} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
		req.Header.Set("Authorization", token)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != 401 {
			t.Fatalf("got %d", res.Code)
		}
	}
}

func TestCORSRejectsOtherOrigin(t *testing.T) {
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("handler called") }), "http://localhost:5173")
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/produk", nil)
	req.Header.Set("Origin", "https://other.example")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != 403 {
		t.Fatalf("got %d", res.Code)
	}
}

func TestAuthAttemptLimit(t *testing.T) {
	calls := 0
	handler := authLimit(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(200) })
	for i := 0; i < 11; i++ {
		res := httptest.NewRecorder()
		handler(res, httptest.NewRequest("POST", "/api/v1/auth/login", nil))
		if i == 10 && (res.Code != 429 || res.Header().Get("Retry-After") == "") {
			t.Fatal("auth rate limit not applied")
		}
	}
	if calls != 10 {
		t.Fatal("too many attempts reached handler", calls)
	}
}
