package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
	"toko/backend/internal/config"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

func TestRefreshCookieAndOrigin(t *testing.T) {
	res := httptest.NewRecorder()
	setRefreshCookie(res, "secret", time.Now().Add(17*time.Hour), true)
	cookie := res.Result().Cookies()[0]
	if !cookie.Secure || !cookie.HttpOnly || cookie.Path != "/api/v1/auth" || cookie.SameSite != http.SameSiteLaxMode || cookie.Domain != "" {
		t.Fatal(cookie)
	}
	root, api := http.NewServeMux(), http.NewServeMux()
	registerSession(api, root, &service.Service{Store: &repository.Store{}}, config.Config{CORSOrigin: "https://toko.test", SessionCookieSecure: true})
	for _, origin := range []string{"", "https://evil.test", "https://toko.test"} {
		req := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
		req.Header.Set("Origin", origin)
		res := httptest.NewRecorder()
		root.ServeHTTP(res, req)
		expected := 403
		if origin == "https://toko.test" {
			expected = 401
		}
		if res.Code != expected {
			t.Fatal(origin, res.Code)
		}
	}
}
