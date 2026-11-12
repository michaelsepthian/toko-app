package httpapi

import (
	"net/http"
	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

func registerUsers(mux *http.ServeMux, svc *service.Service) {
	mux.HandleFunc("GET /api/v1/pengguna", owner(func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.ListUsers(r.Context(), limit, offset)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, dto.Map(rows, dto.User))
	}))
	mux.HandleFunc("POST /api/v1/pengguna", owner(func(w http.ResponseWriter, r *http.Request) {
		var input dto.CreateUserRequest
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		user, err := svc.CreateUser(r.Context(), input.Input())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusCreated, dto.User(user))
	}))
}
