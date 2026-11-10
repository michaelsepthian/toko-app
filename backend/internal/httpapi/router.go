package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
	"toko/backend/internal/config"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

func New(c config.Config, store *repository.Store) http.Handler {
	api := http.NewServeMux()
	svc := &service.Service{Store: store}
	registerUsers(api, svc)
	catalog := registerCatalog(api, store.DB)
	registerMasters(api, store.DB, catalog.invalidate)
	registerDailySummaries(api, svc)
	registerCashPurchaseNotes(api, svc)
	registerShoppingPlans(api, svc)
	api.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) == 2 {
			if err := store.DB.WithContext(r.Context()).Where("token_hash = ?", service.SessionHash(parts[1])).Delete(&model.SesiPengguna{}).Error; err != nil {
				fail(w, err)
				return
			}
		}
		respond(w, 200, map[string]bool{"logged_out": true})
	})
	api.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, currentUser(r)) })
	registerTransactions(api, svc, false)
	registerTransactions(api, svc, true)
	api.HandleFunc("GET /api/v1/stok", func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		type stockRow struct {
			ID          int64           `json:"id"`
			SKU         string          `json:"sku"`
			Nama        string          `json:"nama"`
			StokMinimum decimal.Decimal `json:"stok_minimum"`
			Stok        decimal.Decimal `json:"stok"`
		}
		rows := make([]stockRow, 0)
		// Agregasi hanya untuk produk pada halaman yang diminta.
		err = store.DB.WithContext(r.Context()).Raw(`
			SELECT p.id, p.sku, p.nama, p.stok_minimum, COALESCE(m.stok, 0) AS stok
			FROM (SELECT id, sku, nama, stok_minimum FROM public.produk ORDER BY id LIMIT ? OFFSET ?) p
			LEFT JOIN LATERAL (SELECT SUM(perubahan) AS stok FROM public.mutasi_stok WHERE produk_id = p.id) m ON true
			ORDER BY p.id`, limit, offset).Scan(&rows).Error
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	})
	api.HandleFunc("GET /api/v1/produk/{id}/mutasi", func(w http.ResponseWriter, r *http.Request) {
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
		rows := make([]model.MutasiStok, 0)
		if err := store.DB.WithContext(r.Context()).Where("produk_id = ?", id).Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	})
	api.HandleFunc("POST /api/v1/produk/{id}/mutasi", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var input service.StockInput
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.AdjustStock(r.Context(), currentUser(r).ID, id, input)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, row)
	}))
	root := http.NewServeMux()
	auth := NewAuth(c.SupabaseURL, c.SupabaseKey, store)
	registerSetup(root, svc, auth)
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	root.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		pool, err := store.DB.DB()
		if err == nil {
			err = pool.PingContext(r.Context())
		}
		if err != nil {
			fail(w, &apperror.Error{Status: 503, Message: "Database belum siap"})
			return
		}
		respond(w, 200, map[string]string{"status": "ready"})
	})
	root.Handle("/api/", auth.Middleware(api))
	return middleware(root, c.CORSOrigin)
}

func registerTransactions(mux *http.ServeMux, svc *service.Service, purchase bool) {
	path := "penjualan"
	if purchase {
		path = "pembelian"
	}
	protect := func(handler http.HandlerFunc) http.HandlerFunc {
		if purchase {
			return owner(handler)
		}
		return handler
	}
	mux.HandleFunc("POST /api/v1/"+path, protect(func(w http.ResponseWriter, r *http.Request) {
		var input service.TransactionInput
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.CreateTransaction(r.Context(), currentUser(r).ID, purchase, input)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, row)
	}))
	mux.HandleFunc("GET /api/v1/"+path, protect(func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		query := svc.Store.DB.WithContext(r.Context()).Order("id DESC").Limit(limit).Offset(offset)
		if !purchase || r.URL.Query().Has("tanggal") {
			start, end, err := historyDay(r.URL.Query().Get("tanggal"), time.Now())
			if err != nil {
				fail(w, err)
				return
			}
			query = query.Where("tanggal >= ? AND tanggal < ?", start, end)
		}
		if purchase {
			rows := make([]model.Pembelian, 0)
			if err := query.Find(&rows).Error; err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, rows)
		} else {
			rows := make([]model.Penjualan, 0)
			if err := query.Find(&rows).Error; err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, rows)
		}
	}))
	mux.HandleFunc("GET /api/v1/"+path+"/{id}", protect(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		query := svc.Store.DB.WithContext(r.Context()).Preload("Detail")
		if purchase {
			var row model.Pembelian
			if err := query.First(&row, id).Error; err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, row)
		} else {
			var row model.Penjualan
			if err := query.First(&row, id).Error; err != nil {
				fail(w, err)
				return
			}
			var cashier struct{ Nama string }
			if err := svc.Store.DB.WithContext(r.Context()).Model(&model.Pengguna{}).Select("nama").Where("id = ?", row.PenggunaID).Scan(&cashier).Error; err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, struct {
				model.Penjualan
				NamaKasir string `json:"nama_kasir"`
			}{Penjualan: row, NamaKasir: cashier.Nama})
		}
	}))
	mux.HandleFunc("POST /api/v1/"+path+"/{id}/batal", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var input struct {
			Alasan string `json:"alasan"`
		}
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		if err := svc.Cancel(r.Context(), currentUser(r).ID, id, purchase, input.Alasan); err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, map[string]any{"id": id, "status": "BATAL"})
	}))
}

func middleware(next http.Handler, origin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		var bytes [16]byte
		_, _ = rand.Read(bytes[:])
		id := hex.EncodeToString(bytes[:])
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if value := recover(); value != nil {
				slog.Error("panic recovered", "request_id", id, "panic", value)
				fail(w, &apperror.Error{Status: 500, Message: "Terjadi kesalahan internal"})
			}
			slog.Info("http request", "request_id", id, "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
		}()
		if r.Header.Get("Origin") != "" {
			w.Header().Add("Vary", "Origin")
			if origin == "" || r.Header.Get("Origin") != origin {
				fail(w, apperror.Forbidden())
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
