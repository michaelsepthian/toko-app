package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"toko/backend/internal/dto"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type masterData struct {
	Version    string                   `json:"version"`
	Categories []model.Kategori         `json:"categories"`
	Units      []model.Satuan           `json:"units"`
	Payments   []model.MetodePembayaran `json:"payments"`
	Sources    []model.SumberPembelian  `json:"sources"`
}

// Satu cache per proses API. Snapshot tidak diubah setelah dipublikasikan.
// Mutex juga menggabungkan permintaan serentak saat cache masih kosong.
type catalogCache struct {
	mu       sync.Mutex
	epoch    string
	revision uint64
	value    *masterData
	load     func(context.Context) (masterData, error)
}

func newCatalogCache(load func(context.Context) (masterData, error)) *catalogCache {
	return &catalogCache{epoch: fmt.Sprint(time.Now().UnixNano()), load: load}
}
func (c *catalogCache) versionLocked() string { return fmt.Sprintf("%s-%d", c.epoch, c.revision) }
func (c *catalogCache) version() string       { c.mu.Lock(); defer c.mu.Unlock(); return c.versionLocked() }
func (c *catalogCache) invalidate()           { c.mu.Lock(); defer c.mu.Unlock(); c.revision++; c.value = nil }
func (c *catalogCache) get(ctx context.Context) (masterData, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.value == nil {
		value, err := c.load(ctx)
		if err != nil {
			return masterData{}, err
		}
		value.Version = c.versionLocked()
		c.value = &value
	}
	return *c.value, nil
}
func (data masterData) forUser(owner bool) masterData {
	if !owner {
		data.Sources = []model.SumberPembelian{}
	}
	return data
}
func registerCatalog(mux *http.ServeMux, svc *service.Service, productCacheTTL time.Duration) *catalogCache {
	cache := newCatalogCache(func(ctx context.Context) (masterData, error) {
		data, err := svc.MasterData(ctx)
		return masterData{Categories: data.Categories, Units: data.Units, Payments: data.Payments, Sources: data.Sources}, err
	})
	registerProductCatalog(mux, svc, cache.version, productCacheTTL)
	mux.HandleFunc("GET /api/v1/master-data/version", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]string{"version": cache.version()})
	})
	mux.HandleFunc("GET /api/v1/master-data", func(w http.ResponseWriter, r *http.Request) {
		// Muat ulang eksplisit juga mendukung perubahan langsung melalui SQL Editor.
		if r.URL.Query().Get("refresh") == "true" {
			cache.invalidate()
		}
		data, err := cache.get(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		data = data.forUser(currentUser(r).Peran == model.RoleOwner)
		respond(w, 200, dto.MasterDataResponse{Version: data.Version, Categories: dto.Map(data.Categories, dto.Category),
			Units: dto.Map(data.Units, dto.Unit), Payments: dto.Map(data.Payments, dto.Payment), Sources: dto.Map(data.Sources, dto.Source)})
	})
	// Frekuensi transaksi, bukan jumlah unit, agar produk satuan dan kilogram
	// dapat dibandingkan. DRAFT/BATAL tidak ikut menentukan urutan kasir.
	mux.HandleFunc("GET /api/v1/produk/popularitas", func(w http.ResponseWriter, r *http.Request) {
		rows, err := svc.ProductPopularity(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, func(row service.ProductPopularity) dto.ProductPopularityResponse {
			return dto.ProductPopularityResponse{ProdukID: row.ProdukID, Transaksi: row.Transaksi}
		}))
	})
	// Stok hanya dimuat saat membuka Pembelian; tidak disatukan dengan cache master.
	mux.HandleFunc("GET /api/v1/stok/ringkasan", owner(func(w http.ResponseWriter, r *http.Request) {
		rows, err := svc.StockSummary(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, dto.Map(rows, dto.StockSummary))
	}))
	return cache
}
