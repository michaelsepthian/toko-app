package httpapi

import (
	"net/http"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

func registerCashPurchaseNotes(mux *http.ServeMux, svc *service.Service) {
	mux.HandleFunc("GET /api/v1/catatan-belanja", owner(func(w http.ResponseWriter, r *http.Request) {
		query := svc.Store.DB.WithContext(r.Context()).Order("id DESC")
		if date := r.URL.Query().Get("tanggal"); date != "" {
			start, _, err := service.SummaryDay(date, time.Now())
			if err != nil {
				fail(w, err)
				return
			}
			query = query.Where("tanggal = ?", start.Format("2006-01-02"))
		}
		if status := r.URL.Query().Get("status"); status != "" {
			if status != "TERBUKA" && status != "SELESAI" && status != "BATAL" {
				fail(w, apperror.Invalid("Status catatan belanja tidak valid"))
				return
			}
			query = query.Where("status = ?", status)
		}
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows := make([]model.CatatanBelanja, 0)
		if err := query.Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	}))
	mux.HandleFunc("POST /api/v1/catatan-belanja", owner(func(w http.ResponseWriter, r *http.Request) {
		var input service.CashPurchaseNoteInput
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.CreateCashPurchaseNote(r.Context(), currentUser(r).ID, input)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, row)
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
