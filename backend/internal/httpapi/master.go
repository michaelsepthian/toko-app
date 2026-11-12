package httpapi

import (
	"net/http"

	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

func resource[R interface{ Input() I }, I, M, O any](mux *http.ServeMux, invalidate func(), path string, svc service.MasterService[I, M], output func(M) O) {
	mux.HandleFunc("GET /api/v1/"+path, func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		filter := service.MasterFilter{Query: r.URL.Query().Get("q"), Barcode: r.URL.Query().Get("barcode"), For: r.URL.Query().Get("untuk"), Limit: limit, Offset: offset}
		rows, err := svc.List(r.Context(), filter)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, dto.Map(rows, output))
	})
	mux.HandleFunc("GET /api/v1/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		row, err := svc.Get(r.Context(), id)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, output(row))
	})
	mux.HandleFunc("POST /api/v1/"+path, owner(func(w http.ResponseWriter, r *http.Request) {
		var request R
		if err := decode(w, r, &request); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.Create(r.Context(), currentUser(r).ID, request.Input())
		if err != nil {
			fail(w, err)
			return
		}
		invalidate()
		respond(w, http.StatusCreated, output(row))
	}))
	mux.HandleFunc("PUT /api/v1/"+path+"/{id}", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var request R
		if err := decode(w, r, &request); err != nil {
			fail(w, err)
			return
		}
		if err := svc.Update(r.Context(), id, currentUser(r).ID, request.Input()); err != nil {
			fail(w, err)
			return
		}
		invalidate()
		// Mutasi sudah tersimpan: invalidasi tetap berlaku jika reload gagal.
		row, err := svc.Get(r.Context(), id)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, output(row))
	}))
}

func registerMasters(mux *http.ServeMux, svc *service.Service, invalidate func()) {
	mux.HandleFunc("PUT /api/v1/produk/{id}/favorit", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var input struct {
			IsFavorit *bool `json:"is_favorit"`
		}
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := svc.SetProductFavorite(r.Context(), id, currentUser(r).ID, input.IsFavorit)
		if err != nil {
			fail(w, err)
			return
		}
		invalidate()
		respond(w, http.StatusOK, dto.Product(row))
	}))
	resource[dto.NameRequest](mux, invalidate, "kategori", svc.Categories(), dto.Category)
	resource[dto.NameRequest](mux, invalidate, "satuan", svc.Units(), dto.Unit)
	resource[dto.ProductRequest](mux, invalidate, "produk", svc.Products(), dto.Product)
	resource[dto.SourceRequest](mux, invalidate, "sumber-pembelian", svc.Sources(), dto.Source)
	resource[dto.PaymentRequest](mux, invalidate, "metode-pembayaran", svc.Payments(), dto.Payment)
}
