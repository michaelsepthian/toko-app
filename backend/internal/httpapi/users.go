package httpapi

import (
	"net/http"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

func registerUsers(mux *http.ServeMux, svc *service.Service) {
	mux.HandleFunc("GET /api/v1/pengguna", owner(func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows := make([]model.Pengguna, 0)
		if err := svc.Store.DB.WithContext(r.Context()).Select("id", "nama", "username", "peran", "aktif").Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, rows)
	}))
	mux.HandleFunc("POST /api/v1/pengguna", owner(func(w http.ResponseWriter, r *http.Request) {
		var input service.CreateUserInput
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		user, err := svc.CreateUser(r.Context(), input)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusCreated, user)
	}))
}
