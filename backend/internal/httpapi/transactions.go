package httpapi

import (
	"net/http"
	"time"

	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

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
		var input dto.TransactionRequest
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		if purchase {
			row, err := svc.CreatePurchase(r.Context(), currentUser(r).ID, input.Input())
			if err != nil {
				fail(w, err)
				return
			}
			respond(w, http.StatusCreated, dto.Purchase(row))
		} else {
			row, err := svc.CreateSale(r.Context(), currentUser(r).ID, input.Input())
			if err != nil {
				fail(w, err)
				return
			}
			respond(w, http.StatusCreated, dto.Sale(row))
		}
	}))

	mux.HandleFunc("GET /api/v1/"+path, protect(func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		filter := service.HistoryFilter{Limit: limit, Offset: offset}
		if !purchase || r.URL.Query().Has("tanggal") {
			start, end, err := historyDay(r.URL.Query().Get("tanggal"), time.Now())
			if err != nil {
				fail(w, err)
				return
			}
			filter.Start, filter.End = &start, &end
		}
		if purchase {
			rows, err := svc.ListPurchases(r.Context(), filter)
			if err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, dto.Map(rows, dto.Purchase))
		} else {
			rows, err := svc.ListSales(r.Context(), filter)
			if err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, dto.Map(rows, dto.Sale))
		}
	}))

	mux.HandleFunc("GET /api/v1/"+path+"/{id}", protect(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		if purchase {
			row, err := svc.PurchaseDetail(r.Context(), id)
			if err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, dto.Purchase(row))
		} else {
			result, err := svc.SaleDetail(r.Context(), id)
			if err != nil {
				fail(w, err)
				return
			}
			respond(w, 200, dto.SaleDetailResponse{SaleResponse: dto.Sale(result.Sale), NamaKasir: result.CashierName})
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
		cancel := svc.CancelSale
		if purchase {
			cancel = svc.CancelPurchase
		}
		if err := cancel(r.Context(), currentUser(r).ID, id, input.Alasan); err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, map[string]any{"id": id, "status": "BATAL"})
	}))
}
