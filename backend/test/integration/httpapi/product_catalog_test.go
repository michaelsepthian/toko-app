package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"toko/backend/internal/config"
	"toko/backend/internal/database"
	"toko/backend/internal/dto"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
	"toko/backend/test/testutil"
)

type catalogSQLRecorder struct {
	logger.Interface
	queries []string
}

func (l *catalogSQLRecorder) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	// Request kini melewati autentikasi publik. Query sesi bukan bagian dari
	// jumlah query katalog/master yang sedang diuji.
	if strings.Contains(sql, "JOIN public.sesi_pengguna") {
		return
	}
	l.queries = append(l.queries, sql)
}

func TestProductCatalogPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL belum diisi")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") || u.Path != "/toko_test" {
		t.Fatal("test hanya untuk PostgreSQL lokal toko_test")
	}
	admin, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	adminPool, _ := admin.DB()
	name := fmt.Sprintf("toko_test_catalog_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	db, err := database.Open(context.Background(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	t.Cleanup(func() {
		_ = pool.Close()
		if err := admin.Exec("DROP DATABASE " + name + " WITH (FORCE)").Error; err != nil {
			t.Error(err)
		}
		_ = adminPool.Close()
	})
	for _, path := range []string{"schema.sql", "migrations/20261110_katalog_produk.sql", "migrations/20261110_katalog_produk.sql"} {
		sql, err := os.ReadFile(testutil.DatabasePath(t, path))
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(string(sql)).Error; err != nil {
			t.Fatal(path, err)
		}
	}
	category := model.Kategori{Nama: "Sembako"}
	unit := model.Satuan{Nama: "katalog-test"}
	for _, row := range []any{&category, &unit} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	products := []model.Produk{}
	for i := 0; i < 125; i++ {
		barcode := fmt.Sprintf("000%010d", i)
		products = append(products, model.Produk{Nama: fmt.Sprintf("Barang %03d", i/2), SKU: fmt.Sprintf("CAT-%03d", i), Barcode: &barcode, KategoriID: category.ID, SatuanID: unit.ID, HargaJual: decimal.NewFromInt(int64(i / 3)), Aktif: i != 124, IsFavorit: i%7 == 0})
	}
	if err := db.Create(&products).Error; err != nil {
		t.Fatal(err)
	}
	session, err := (&service.Service{JWTKey: testutil.JWTKey, Store: &repository.Store{DB: db}}).RegisterInitialOwner(context.Background(), "catalog-owner", "password-test")
	if err != nil {
		t.Fatal(err)
	}
	owner := session.User
	var payment model.MetodePembayaran
	if err := db.Where("nama = ?", "Cash").First(&payment).Error; err != nil {
		t.Fatal(err)
	}
	for _, sale := range []struct {
		status   string
		products []int
	}{
		{"SELESAI", []int{4, 4}}, {"SELESAI", []int{4}}, {"SELESAI", []int{0}},
		{"DRAFT", []int{6}}, {"BATAL", []int{7}},
	} {
		var id int64
		if err := db.Raw("INSERT INTO public.penjualan(pengguna_id, metode_pembayaran_id, status) VALUES (?, ?, ?) RETURNING id", owner.ID, payment.ID, sale.status).Scan(&id).Error; err != nil {
			t.Fatal(err)
		}
		for _, index := range sale.products {
			p := products[index]
			if err := db.Exec("INSERT INTO public.detail_penjualan(penjualan_id, produk_id, nama_produk, jumlah, harga_jual) VALUES (?, ?, ?, 10, 0)", id, p.ID, p.Nama).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	log := &catalogSQLRecorder{Interface: logger.Default}
	db = db.Session(&gorm.Session{Logger: log})
	store := &repository.Store{DB: db}
	svc := &service.Service{JWTKey: testutil.JWTKey, Store: store}
	handler := httpapi.New(config.Config{JWTKey: testutil.JWTKey, CORSOrigin: "http://localhost:3000", ProductCacheTTL: 2 * time.Hour}, store)
	request := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/v1/"+path, nil)
		r.Header.Set("Authorization", "Bearer "+session.AccessToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	version := func() string {
		t.Helper()
		w := request("master-data/version")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		return responseData[map[string]string](t, w)["version"]
	}
	get := func(path string) dto.ProductPageResponse {
		t.Helper()
		w := request("katalog/produk?" + path)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
		var payload struct {
			Data dto.ProductPageResponse `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Data.CacheTTLSeconds != 7200 {
			t.Fatal("configured TTL not sent to frontend", payload.Data.CacheTTLSeconds)
		}
		if strings.Contains(w.Body.String(), `"total"`) {
			t.Fatal("response includes total")
		}
		return payload.Data
	}
	master := request("master-data")
	if master.Code != 200 || strings.Contains(master.Body.String(), `"products"`) {
		t.Fatal("master contains products", master.Body.String())
	}
	for _, sql := range log.queries {
		if strings.Contains(sql, "produk") {
			t.Fatal("master queried product table", sql)
		}
	}
	log.queries = nil
	first := get("")
	if len(first.Items) != 50 || !first.HasNext || first.NextCursor == nil {
		t.Fatal("invalid first page", first)
	}
	queryCount := len(log.queries)
	_ = get("")
	if len(log.queries) != queryCount {
		t.Fatal("first page was not cached")
	}
	_ = get("q=Barang")
	_ = get("q=Barang")
	if len(log.queries) != queryCount+2 {
		t.Fatal("free searches should go directly to DB")
	}
	_ = get("refresh=true")
	if len(log.queries) != queryCount+3 {
		t.Fatal("manual refresh did not bypass cache")
	}
	for _, sort := range []string{"name-asc", "name-desc", "newest", "price-asc", "price-desc", "recommended"} {
		for _, favorite := range []string{"false", "true"} {
			base := "limit=17&sort=" + sort + "&favorites_first=" + favorite
			seen := map[int64]bool{}
			ids := []int64{}
			next := ""
			for n := 0; n < 20; n++ {
				page := get(base + next)
				for _, p := range page.Items {
					if seen[p.ID] {
						t.Fatal("duplicate", sort, favorite, p.ID)
					}
					seen[p.ID] = true
					ids = append(ids, p.ID)
				}
				if !page.HasNext {
					if page.NextCursor != nil {
						t.Fatal("last page has cursor")
					}
					break
				}
				if len(page.Items) != 17 || page.NextCursor == nil {
					t.Fatal("invalid intermediate page")
				}
				next = "&cursor=" + url.QueryEscape(*page.NextCursor)
			}
			if len(ids) != 124 {
				t.Fatal("missing products", sort, favorite, len(ids))
			}
			o := service.ProductCatalogOptions{Sort: sort, Active: "true", FavoritesFirst: favorite == "true", Limit: 200}
			full, err := svc.ProductPage(context.Background(), o, version())
			if err != nil {
				t.Fatal(err)
			}
			for i, p := range full.Items {
				if ids[i] != p.ID {
					t.Fatal("pagination changed global order", sort, favorite, i)
				}
			}
		}
	}
	popular := get("sort=recommended&limit=2")
	if popular.Items[0].ID != products[4].ID || popular.Items[1].ID != products[0].ID {
		t.Fatal("popularity must count distinct completed transactions, not quantity or draft/canceled sales")
	}
	for _, query := range []string{"q=cat-123", "q=Sembako+123", "exact=0000000000123", "exact=cat-123"} {
		page := get(query)
		if len(page.Items) != 1 || page.Items[0].ID != products[123].ID {
			t.Fatal("off-page search failed", query, page)
		}
	}
	if page := get("exact=missing"); len(page.Items) != 0 || page.HasNext || page.NextCursor != nil {
		t.Fatal("unknown code matched", page)
	}
	if page := get("q=%25"); len(page.Items) != 0 {
		t.Fatal("wildcard not escaped")
	}
	if page := get("aktif=false"); len(page.Items) != 1 || page.Items[0].ID != products[124].ID {
		t.Fatal("inactive filter failed")
	}
	if page := get("limit=100&aktif=all"); len(page.Items) != 100 || !page.HasNext {
		t.Fatal("all filter failed")
	}
	if w := request("katalog/produk?cursor=bad"); w.Code != 400 {
		t.Fatal("bad cursor accepted", w.Code)
	}
	if w := request("katalog/produk?q=other&cursor=" + *first.NextCursor); w.Code != 400 {
		t.Fatal("cursor reused across searches", w.Code)
	}
	if w := request("master-data?refresh=true"); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("katalog/produk?cursor=" + *first.NextCursor); w.Code != 409 {
		t.Fatal("stale cursor accepted", w.Code)
	}
	before := len(log.queries)
	_ = get("")
	if len(log.queries) != before+1 {
		t.Fatal("version invalidation did not refresh page cache")
	}
	for _, sql := range log.queries {
		if strings.Contains(strings.ToLower(sql), "count(*)") || strings.Contains(strings.ToLower(sql), " offset ") {
			t.Fatal("catalog issued count/offset", sql)
		}
	}
	// Master must still work when the product table cannot be read at all.
	if err := db.Exec("ALTER TABLE public.produk RENAME TO produk_hidden").Error; err != nil {
		t.Fatal(err)
	}
	if w := request("master-data?refresh=true"); w.Code != 200 {
		t.Fatal("master depends on products", w.Body.String())
	}
}
