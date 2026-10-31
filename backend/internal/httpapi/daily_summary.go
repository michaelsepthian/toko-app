package httpapi

import (
	"net/http"
	"time"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

func registerDailySummaries(mux *http.ServeMux, svc *service.Service) {
	mux.HandleFunc("GET /api/v1/ringkasan-harian/preview", owner(func(w http.ResponseWriter, r *http.Request) {
		snapshot, err := svc.PreviewDailySummary(r.Context(), r.URL.Query().Get("tanggal"))
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, snapshot)
	}))
	mux.HandleFunc("GET /api/v1/ringkasan-harian", owner(func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		query := svc.Store.DB.WithContext(r.Context()).Order("id DESC").Limit(limit).Offset(offset)
		if date := r.URL.Query().Get("tanggal"); date != "" {
			start, _, err := service.SummaryDay(date, time.Now())
			if err != nil {
				fail(w, err)
				return
			}
			query = query.Where("tanggal = ?", start.Format("2006-01-02"))
		}
		rows := make([]model.RingkasanHarian, 0)
		if err := query.Find(&rows).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	}))
	mux.HandleFunc("POST /api/v1/ringkasan-harian", owner(func(w http.ResponseWriter, r *http.Request) {
		var input service.DailySummaryInput
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.SaveDailySummary(r.Context(), currentUser(r), input)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, row)
	}))
	mux.HandleFunc("GET /api/v1/ringkasan-harian/{id}", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var row model.RingkasanHarian
		if err := svc.Store.DB.WithContext(r.Context()).First(&row, id).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, row)
	}))
	mux.HandleFunc("GET /api/v1/ringkasan-harian/{id}/email", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var row model.RingkasanHarian
		if err := svc.Store.DB.WithContext(r.Context()).First(&row, id).Error; err != nil {
			fail(w, err)
			return
		}
		email, err := service.BuildDailySummaryEmail(row)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, email)
	}))
}
