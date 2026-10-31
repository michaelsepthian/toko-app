package httpapi

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"toko/backend/internal/model"
)

type masterData struct {
	Version    string                   `json:"version"`
	Products   []model.Produk           `json:"products"`
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
func registerCatalog(mux *http.ServeMux, db *gorm.DB) *catalogCache {
	cache := newCatalogCache(func(ctx context.Context) (masterData, error) {
		data := masterData{Products: []model.Produk{}, Categories: []model.Kategori{}, Units: []model.Satuan{}, Payments: []model.MetodePembayaran{}, Sources: []model.SumberPembelian{}}
		// Kelima tabel dibaca pada snapshot database yang sama, tanpa LIMIT/OFFSET.
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			for _, rows := range []any{&data.Products, &data.Categories, &data.Units, &data.Payments, &data.Sources} {
				if err := tx.Order("id DESC").Find(rows).Error; err != nil {
					return err
				}
			}
			return nil
		}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
		return data, err
	})
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
		respond(w, 200, data.forUser(currentUser(r).Peran == "PEMILIK"))
	})
	// Frekuensi transaksi, bukan jumlah unit, agar produk satuan dan kilogram
	// dapat dibandingkan. DRAFT/BATAL tidak ikut menentukan urutan kasir.
	mux.HandleFunc("GET /api/v1/produk/popularitas", func(w http.ResponseWriter, r *http.Request) {
		rows := make([]struct {
			ProdukID  int64 `json:"produk_id"`
			Transaksi int64 `json:"transaksi"`
		}, 0)
		err := db.WithContext(r.Context()).Raw(`SELECT d.produk_id, COUNT(DISTINCT d.penjualan_id) AS transaksi
FROM public.detail_penjualan d
JOIN public.penjualan p ON p.id = d.penjualan_id
WHERE p.status = 'SELESAI'
GROUP BY d.produk_id`).Scan(&rows).Error
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	})
	// Stok hanya dimuat saat membuka Pembelian; tidak disatukan dengan cache master.
	mux.HandleFunc("GET /api/v1/stok/ringkasan", owner(func(w http.ResponseWriter, r *http.Request) {
		rows := make([]struct {
			ID          int64           `json:"id"`
			Stok        decimal.Decimal `json:"stok"`
			StokMinimum decimal.Decimal `json:"stok_minimum"`
		}, 0)
		err := db.WithContext(r.Context()).Raw(`SELECT p.id, p.stok_minimum, COALESCE(m.stok, 0) AS stok
   FROM public.produk p LEFT JOIN (SELECT produk_id, SUM(perubahan) AS stok FROM public.mutasi_stok GROUP BY produk_id) m ON m.produk_id = p.id ORDER BY p.id`).Scan(&rows).Error
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	}))
	return cache
}
