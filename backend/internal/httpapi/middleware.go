package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"

	"toko/backend/internal/apperror"
)

func middleware(next http.Handler, origin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		var bytes [16]byte
		_, _ = rand.Read(bytes[:])
		id := hex.EncodeToString(bytes[:])
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")

		defer func() {
			if value := recover(); value != nil {
				slog.Error("panic recovered", "request_id", id, "panic", value)
				fail(w, &apperror.Error{Status: 500, Message: "Terjadi kesalahan internal"})
			}
			slog.Info("http request", "request_id", id, "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
		}()

		if r.Header.Get("Origin") != "" {
			w.Header().Add("Vary", "Origin")
			if origin == "" || r.Header.Get("Origin") != origin {
				fail(w, apperror.Forbidden())
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
