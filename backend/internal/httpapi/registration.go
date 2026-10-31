package httpapi

import (
	"net"
	"net/http"
	"sync"
	"time"

	"toko/backend/internal/apperror"
	"toko/backend/internal/service"
)

// Pembatas sederhana untuk endpoint password. Tidak mempercayai X-Forwarded-For.
func authLimit(next http.HandlerFunc) http.HandlerFunc {
	type bucket struct {
		count int
		until time.Time
	}
	var mu sync.Mutex
	attempts := map[string]bucket{}
	return func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		now := time.Now()
		mu.Lock()
		for key, value := range attempts {
			if now.After(value.until) {
				delete(attempts, key)
			}
		}
		value := attempts[host]
		if value.count == 0 {
			value.until = now.Add(time.Minute)
		}
		value.count++
		attempts[host] = value
		mu.Unlock()
		if value.count > 10 {
			w.Header().Set("Retry-After", "60")
			fail(w, &apperror.Error{Status: 429, Message: "Terlalu banyak percobaan. Tunggu satu menit"})
			return
		}
		next(w, r)
	}
}

func registerSetup(mux *http.ServeMux, svc *service.Service, auth *Auth) {
	mux.HandleFunc("GET /api/v1/setup", func(w http.ResponseWriter, r *http.Request) {
		initialized, err := svc.SetupInitialized(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, map[string]bool{"initialized": initialized, "registration_open": !initialized})
	})
	for _, action := range []string{"register", "login"} {
		mux.HandleFunc("POST /api/v1/auth/"+action, authLimit(func(w http.ResponseWriter, r *http.Request) {
			var input struct {
				Username string `json:"username"`
				Password string `json:"password"`
			}
			if err := decode(w, r, &input); err != nil {
				fail(w, err)
				return
			}
			var result service.LoginResult
			var err error
			if action == "register" {
				result, err = svc.RegisterInitialOwner(r.Context(), input.Username, input.Password)
			} else {
				result, err = svc.Login(r.Context(), input.Username, input.Password, auth.VerifyLegacyPassword)
			}
			if err != nil {
				fail(w, err)
				return
			}
			status := 200
			if action == "register" {
				status = 201
			}
			respond(w, status, result)
		}))
	}
}
