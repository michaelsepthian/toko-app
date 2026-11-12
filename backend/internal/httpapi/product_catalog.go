package httpapi

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"toko/backend/internal/apperror"
	"toko/backend/internal/config"
	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

type productPage = service.ProductPage
type productCatalogOptions = service.ProductCatalogOptions

func parseProductCatalog(r *http.Request) (productCatalogOptions, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return productCatalogOptions{}, apperror.Invalid("Parameter katalog tidak valid")
	}
	o := productCatalogOptions{Query: strings.Join(strings.Fields(q.Get("q")), " "), Sort: q.Get("sort"), Active: q.Get("aktif"), Exact: strings.TrimSpace(q.Get("exact")), Cursor: q.Get("cursor"), Limit: 50, Refresh: q.Get("refresh") == "true"}
	if o.Sort == "" {
		o.Sort = "name-asc"
	}
	if o.Active == "" {
		o.Active = "true"
	}
	if value := q.Get("limit"); value != "" {
		limit, err := strconv.Atoi(value)
		if err != nil {
			return o, apperror.Invalid("Limit tidak valid")
		}
		o.Limit = limit
	}
	if value := q.Get("favorites_first"); value != "" {
		if value != "true" && value != "false" {
			return o, apperror.Invalid("favorites_first harus true atau false")
		}
		o.FavoritesFirst = value == "true"
	}
	if o.Limit < 1 || o.Limit > 100 || len(o.Query) > 300 || len(o.Exact) > 300 || len(o.Cursor) > 4096 {
		return o, apperror.Invalid("Limit harus 1–100; pencarian atau cursor terlalu panjang")
	}
	if o.Active != "true" && o.Active != "false" && o.Active != "all" {
		return o, apperror.Invalid("aktif harus true, false, atau all")
	}
	switch o.Sort {
	case "recommended", "name-asc", "name-desc", "newest", "price-asc", "price-desc":
	default:
		return o, apperror.Invalid("Urutan produk tidak valid")
	}
	return o, nil
}

type cachedProductPage struct {
	page    productPage
	expires time.Time
}
type productPageCache struct {
	mu      sync.Mutex
	entries map[string]cachedProductPage
	ttl     time.Duration
}

// Hanya halaman awal umum yang dicache. Error tidak disimpan; mutex menggabungkan
// request bersamaan sehingga satu halaman tidak diunduh berkali-kali.
func (c *productPageCache) get(key string, refresh bool, now func() time.Time, load func() (productPage, error)) (productPage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = make(map[string]cachedProductPage)
	}
	if entry, ok := c.entries[key]; ok && !refresh && now().Before(entry.expires) {
		return entry.page, nil
	}
	page, err := load()
	if err != nil {
		return page, err
	}
	for k, entry := range c.entries {
		if !now().Before(entry.expires) {
			delete(c.entries, k)
		}
	}
	if len(c.entries) >= 32 {
		for k := range c.entries {
			delete(c.entries, k)
			break
		}
	}
	ttl := c.ttl
	if ttl <= 0 {
		ttl = config.DefaultProductCacheTTL
	}
	c.entries[key] = cachedProductPage{page: page, expires: now().Add(ttl)}
	return page, nil
}

func registerProductCatalog(mux *http.ServeMux, svc *service.Service, version func() string, ttl time.Duration) {
	if ttl <= 0 {
		ttl = config.DefaultProductCacheTTL
	}
	cache := &productPageCache{ttl: ttl}
	mux.HandleFunc("GET /api/v1/katalog/produk", func(w http.ResponseWriter, r *http.Request) {
		o, err := parseProductCatalog(r)
		if err != nil {
			fail(w, err)
			return
		}
		revision := version()
		load := func() (productPage, error) {
			page, err := svc.ProductPage(r.Context(), o, revision)
			page.CacheTTLSeconds = int64(ttl / time.Second)
			return page, err
		}
		var page productPage
		if o.Query == "" && o.Exact == "" && o.Cursor == "" {
			page, err = cache.get(revision+":"+o.Signature(), o.Refresh, time.Now, load)
		} else {
			page, err = load()
		}
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, dto.ProductPageResponse{Items: dto.Map(page.Items, dto.Product),
			HasNext: page.HasNext, NextCursor: page.NextCursor, Version: page.Version, CacheTTLSeconds: page.CacheTTLSeconds})
	})
}
