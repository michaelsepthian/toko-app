package httpapi

import (
	"net/http"

	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

func registerStock(mux *http.ServeMux, svc *service.Service) {
	mux.HandleFunc("GET /api/v1/stok", func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.ListStocks(r.Context(), limit, offset)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.Stock))
	})

	mux.HandleFunc("GET /api/v1/produk/{id}/mutasi", func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.ListMovements(r.Context(), id, limit, offset)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.Movement))
	})

	mux.HandleFunc("POST /api/v1/produk/{id}/mutasi", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var input dto.StockRequest
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.AdjustStock(r.Context(), currentUser(r).ID, id, input.Input())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, dto.Movement(row))
	}))
}
