package httpapi

import (
	"net/http"

	"toko/backend/internal/apperror"
	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

func registerShoppingPlans(mux *http.ServeMux, svc *service.Service) {
	// Kasir hanya membutuhkan nama tempat beli, bukan kontak/alamat pemasok.
	mux.HandleFunc("GET /api/v1/rencana-belanja/sumber", func(w http.ResponseWriter, r *http.Request) {
		rows, err := svc.ShoppingSources(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.ShoppingSource))
	})
	mux.HandleFunc("GET /api/v1/rencana-belanja/kalender", func(w http.ResponseWriter, r *http.Request) {
		rows, err := svc.ShoppingCalendar(r.Context(), r.URL.Query().Get("bulan"))
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.ShoppingCalendar))
	})
	mux.HandleFunc("GET /api/v1/rencana-belanja", func(w http.ResponseWriter, r *http.Request) {
		date := r.URL.Query().Get("tanggal")
		if _, err := service.ShoppingDate(date); err != nil {
			fail(w, err)
			return
		}
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.ListShoppingItems(r.Context(), date, limit, offset)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.ShoppingItem))
	})
	mux.HandleFunc("POST /api/v1/rencana-belanja", func(w http.ResponseWriter, r *http.Request) {
		var in dto.ShoppingBatchRequest
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.CreateShoppingItems(r.Context(), currentUser(r), in.Input())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, dto.Map(rows, dto.ShoppingItem))
	})
	mux.HandleFunc("PUT /api/v1/rencana-belanja/{id}/checklist", func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var in struct {
			Dibeli *bool `json:"dibeli"`
		}
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		if in.Dibeli == nil {
			fail(w, apperror.Invalid("dibeli wajib diisi true atau false"))
			return
		}
		row, err := svc.CheckShoppingItem(r.Context(), currentUser(r), id, *in.Dibeli)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.ShoppingItem(row))
	})
	mux.HandleFunc("POST /api/v1/rencana-belanja/pindah", owner(func(w http.ResponseWriter, r *http.Request) {
		var in dto.ShoppingMoveRequest
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		if err := svc.MoveShoppingItems(r.Context(), currentUser(r), in.Input()); err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, map[string]bool{"moved": true})
	}))
	mux.HandleFunc("PUT /api/v1/rencana-belanja/{id}", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var in dto.ShoppingItemRequest
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.EditShoppingItem(r.Context(), currentUser(r), id, in.Input())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.ShoppingItem(row))
	}))
	mux.HandleFunc("POST /api/v1/rencana-belanja/{id}/hapus", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		if err := svc.DeleteShoppingItem(r.Context(), currentUser(r), id); err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, map[string]bool{"deleted": true})
	}))
}
