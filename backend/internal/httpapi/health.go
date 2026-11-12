package httpapi

import (
	"net/http"

	"toko/backend/internal/apperror"
	"toko/backend/internal/repository"
)

func registerHealth(mux *http.ServeMux, store *repository.Store) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := store.Ready(r.Context()); err != nil {
			fail(w, &apperror.Error{Status: 503, Message: "Database belum siap"})
			return
		}
		respond(w, 200, map[string]string{"status": "ready"})
	})
}
