package httpapi

import (
	"net/http"
	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

func registerCashPurchaseNotes(mux *http.ServeMux, svc *service.Service) {
	mux.HandleFunc("GET /api/v1/catatan-belanja", owner(func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.ListCashNotes(r.Context(), r.URL.Query().Get("tanggal"), r.URL.Query().Get("status"), limit, offset)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.CashPurchaseNote))
	}))
	mux.HandleFunc("POST /api/v1/catatan-belanja", owner(func(w http.ResponseWriter, r *http.Request) {
		var input dto.CashPurchaseNoteRequest
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.CreateCashPurchaseNote(r.Context(), currentUser(r).ID, input.Input())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, dto.CashPurchaseNote(row))
	}))
	mux.HandleFunc("POST /api/v1/catatan-belanja/{id}/batal", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		if err := svc.CancelCashPurchaseNote(r.Context(), currentUser(r).ID, id); err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, map[string]bool{"dibatalkan": true})
	}))
}
