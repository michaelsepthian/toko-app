package httpapi

import (
	"net/http"
	"time"

	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

func registerShoppingPlans(mux *http.ServeMux, svc *service.Service) {
	// Kasir hanya membutuhkan nama tempat beli, bukan kontak/alamat pemasok.
	mux.HandleFunc("GET /api/v1/rencana-belanja/sumber", func(w http.ResponseWriter, r *http.Request) {
		rows := make([]struct {
			ID    int64  `json:"id"`
			Nama  string `json:"nama"`
			Aktif bool   `json:"aktif"`
		}, 0)
		if err := svc.Store.DB.WithContext(r.Context()).Model(&model.SumberPembelian{}).Select("id, nama, aktif").Order("nama, id").Scan(&rows).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	})
	mux.HandleFunc("GET /api/v1/rencana-belanja/kalender", func(w http.ResponseWriter, r *http.Request) {
		month := r.URL.Query().Get("bulan")
		start, err := time.Parse("2006-01", month)
		if err != nil || start.Year() < 1 || start.Year() > 9999 || start.Format("2006-01") != month {
			fail(w, apperror.Invalid("Bulan harus berformat YYYY-MM"))
			return
		}
		rows := make([]struct {
			Tanggal     model.ReportDate `json:"tanggal"`
			TotalItem   int64            `json:"total_item"`
			SudahDibeli int64            `json:"sudah_dibeli"`
		}, 0)
		err = svc.Store.DB.WithContext(r.Context()).Model(&model.RencanaBelanjaItem{}).
			Select("tanggal, count(*) AS total_item, count(dibeli_at) AS sudah_dibeli").
			Where("tanggal >= ? AND tanggal < ?", start.Format("2006-01-02"), start.AddDate(0, 1, 0).Format("2006-01-02")).
			Group("tanggal").Order("tanggal").Scan(&rows).Error
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
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
		rows := make([]model.RencanaBelanjaItem, 0)
		if err := svc.Store.DB.WithContext(r.Context()).Where("tanggal = ?", date).Order("id").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	})
	mux.HandleFunc("POST /api/v1/rencana-belanja", func(w http.ResponseWriter, r *http.Request) {
		var in service.ShoppingBatchInput
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		rows, err := svc.CreateShoppingItems(r.Context(), currentUser(r), in)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, rows)
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
		respond(w, 200, row)
	})
	mux.HandleFunc("POST /api/v1/rencana-belanja/pindah", owner(func(w http.ResponseWriter, r *http.Request) {
		var in service.ShoppingMoveInput
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		if err := svc.MoveShoppingItems(r.Context(), currentUser(r), in); err != nil {
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
		var in service.ShoppingItemInput
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.EditShoppingItem(r.Context(), currentUser(r), id, in)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, row)
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
