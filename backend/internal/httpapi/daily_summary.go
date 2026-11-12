package httpapi

import (
	"net/http"
	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

func registerDailySummaries(mux *http.ServeMux, svc *service.Service) {
	mux.HandleFunc("GET /api/v1/ringkasan-harian/preview", owner(func(w http.ResponseWriter, r *http.Request) {
		snapshot, err := svc.PreviewDailySummary(r.Context(), r.URL.Query().Get("tanggal"))
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.DailySnapshot(snapshot))
	}))
	mux.HandleFunc("GET /api/v1/ringkasan-harian", owner(func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.ListDailySummaries(r.Context(), r.URL.Query().Get("tanggal"), limit, offset)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.DailySummary))
	}))
	mux.HandleFunc("POST /api/v1/ringkasan-harian", owner(func(w http.ResponseWriter, r *http.Request) {
		var input dto.DailySummaryRequest
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.SaveDailySummary(r.Context(), currentUser(r), input.Input())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, dto.DailySummary(row))
	}))
	mux.HandleFunc("GET /api/v1/ringkasan-harian/{id}", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		row, err := svc.DailySummary(r.Context(), id)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.DailySummary(row))
	}))
	mux.HandleFunc("GET /api/v1/ringkasan-harian/{id}/email", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		row, err := svc.DailySummary(r.Context(), id)
		if err != nil {
			fail(w, err)
			return
		}
		email, err := service.BuildDailySummaryEmail(row)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.DailyEmail(email))
	}))
}
