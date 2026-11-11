package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"toko/backend/internal/apperror"
	"toko/backend/internal/config"
	"toko/backend/internal/model"
)

type productPage struct {
	Items           []model.Produk `json:"items"`
	HasNext         bool           `json:"has_next"`
	NextCursor      *string        `json:"next_cursor"`
	Version         string         `json:"version"`
	CacheTTLSeconds int64          `json:"cache_ttl_seconds"`
}

type productCatalogOptions struct {
	Query, Sort, Active, Exact, Cursor string
	FavoritesFirst                     bool
	Limit                              int
	Refresh                            bool
}

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

func (o productCatalogOptions) signature() string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%q|%q|%q|%q|%t|%d", o.Query, o.Sort, o.Active, o.Exact, o.FavoritesFirst, o.Limit))))
}

type productCursor struct {
	Signature  string `json:"s"`
	Version    string `json:"v"`
	ID         int64  `json:"id"`
	Name       string `json:"n"`
	Price      string `json:"p"`
	Favorite   bool   `json:"f"`
	Popularity int64  `json:"t"`
}

type catalogProduct struct {
	model.Produk
	SortName   string
	Popularity int64
}

type productOrder struct {
	column, direction string
	value             any
}

func productOrders(o productCatalogOptions, c productCursor) []productOrder {
	orders := []productOrder{}
	if o.FavoritesFirst {
		orders = append(orders, productOrder{"p.is_favorit", "DESC", c.Favorite})
	}
	switch o.Sort {
	case "recommended":
		orders = append(orders, productOrder{"COALESCE(pop.transaksi, 0)", "DESC", c.Popularity})
	case "newest":
		return append(orders, productOrder{"p.id", "DESC", c.ID})
	case "price-asc":
		orders = append(orders, productOrder{"p.harga_jual", "ASC", c.Price})
	case "price-desc":
		orders = append(orders, productOrder{"p.harga_jual", "DESC", c.Price})
	}
	direction := "ASC"
	if o.Sort == "name-desc" {
		direction = "DESC"
	}
	return append(orders, productOrder{"lower(p.nama)", direction, c.Name}, productOrder{"p.id", "ASC", c.ID})
}

// Lexicographic keyset pagination; no OFFSET and no product COUNT query.
func productSeek(orders []productOrder) (string, []any) {
	clauses := []string{}
	args := []any{}
	for i, order := range orders {
		parts := []string{}
		for _, previous := range orders[:i] {
			parts = append(parts, previous.column+" = ?")
			args = append(args, previous.value)
		}
		op := " > ?"
		if order.direction == "DESC" {
			op = " < ?"
		}
		parts = append(parts, order.column+op)
		args = append(args, order.value)
		clauses = append(clauses, "("+strings.Join(parts, " AND ")+")")
	}
	return "(" + strings.Join(clauses, " OR ") + ")", args
}

func loadProductPage(db *gorm.DB, o productCatalogOptions, version string) (productPage, error) {
	page := productPage{Items: []model.Produk{}, Version: version}
	cursor := productCursor{}
	if o.Cursor != "" {
		bytes, err := base64.RawURLEncoding.DecodeString(o.Cursor)
		if err != nil || json.Unmarshal(bytes, &cursor) != nil || cursor.ID <= 0 || cursor.Signature != o.signature() {
			return page, apperror.Invalid("Cursor produk tidak valid untuk pencarian ini")
		}
		if _, err := decimal.NewFromString(cursor.Price); err != nil {
			return page, apperror.Invalid("Cursor harga tidak valid")
		}
		if cursor.Version != version {
			return page, &apperror.Error{Status: 409, Message: "Katalog berubah; muat ulang halaman pertama"}
		}
	}
	query := db.Table("public.produk AS p").Select("p.*, lower(p.nama) AS sort_name")
	if o.Active != "all" {
		query = query.Where("p.aktif = ?", o.Active == "true")
	}
	if o.Exact != "" {
		query = query.Where("(p.barcode = ? OR lower(p.sku) = lower(?))", o.Exact, o.Exact)
	}
	if o.Query != "" {
		query = query.Joins("LEFT JOIN public.kategori k ON k.id = p.kategori_id")
		for _, word := range strings.Fields(o.Query) {
			// Escape LIKE wildcards: searching '%' must not match the whole catalog.
			word = "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(word) + "%"
			query = query.Where("(p.nama ILIKE ? OR p.sku ILIKE ? OR p.barcode ILIKE ? OR k.nama ILIKE ?)", word, word, word, word)
		}
	}
	if o.Sort == "recommended" {
		// Count sale occurrences, never total products. Avoid this aggregate for other sorts.
		query = query.Joins(`LEFT JOIN (SELECT d.produk_id, COUNT(DISTINCT d.penjualan_id) AS transaksi
FROM public.detail_penjualan d JOIN public.penjualan s ON s.id = d.penjualan_id
WHERE s.status = 'SELESAI' GROUP BY d.produk_id) pop ON pop.produk_id = p.id`).Select("p.*, lower(p.nama) AS sort_name, COALESCE(pop.transaksi, 0) AS popularity")
	}
	orders := productOrders(o, cursor)
	if o.Cursor != "" {
		condition, args := productSeek(orders)
		query = query.Where(condition, args...)
	}
	for _, order := range orders {
		query = query.Order(order.column + " " + order.direction)
	}
	rows := []catalogProduct{}
	if err := query.Limit(o.Limit + 1).Scan(&rows).Error; err != nil {
		return page, err
	}
	page.HasNext = len(rows) > o.Limit
	if page.HasNext {
		rows = rows[:o.Limit]
	}
	for _, row := range rows {
		page.Items = append(page.Items, row.Produk)
	}
	if page.HasNext {
		last := rows[len(rows)-1]
		bytes, _ := json.Marshal(productCursor{Signature: o.signature(), Version: version, ID: last.ID, Name: last.SortName, Price: last.HargaJual.String(), Favorite: last.IsFavorit, Popularity: last.Popularity})
		next := base64.RawURLEncoding.EncodeToString(bytes)
		page.NextCursor = &next
	}
	return page, nil
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

// Only common first pages are cached. Searches and subsequent pages go to DB.
// The lock coalesces cold first-page requests; errors are never cached.
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
	c.entries[key] = cachedProductPage{page, now().Add(ttl)}
	return page, nil
}

func registerProductCatalog(mux *http.ServeMux, db *gorm.DB, version func() string, ttl time.Duration) {
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
			page, err := loadProductPage(db.WithContext(r.Context()), o, revision)
			page.CacheTTLSeconds = int64(ttl / time.Second)
			return page, err
		}
		var page productPage
		if o.Query == "" && o.Exact == "" && o.Cursor == "" {
			page, err = cache.get(revision+":"+o.signature(), o.Refresh, time.Now, load)
		} else {
			page, err = load()
		}
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, page)
	})
}
