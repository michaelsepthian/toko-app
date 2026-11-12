package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"toko/backend/internal/config"
	"toko/backend/internal/database"
	"toko/backend/internal/dto"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
	"toko/backend/test/testutil"
)

func responseData[T any](t *testing.T, res *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope dto.Envelope[T]
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data
}

func TestLayeredHTTPContractPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL belum diisi")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") || u.Path != "/toko_test" {
		t.Fatal("test hanya untuk PostgreSQL lokal toko_test")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	adminPool, _ := admin.DB()
	defer adminPool.Close()
	name := fmt.Sprintf("toko_test_layers_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name + " WITH (FORCE)")
	u.Path = "/" + name
	db, err := database.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	for _, file := range []string{
		"schema.sql", "migrations/20261102_audit_pengguna.sql",
		"migrations/20261101_tanggal_pendapatan.sql", "migrations/20261110_katalog_produk.sql",
		"migrations/20261110_rencana_belanja.sql",
	} {
		sql, err := os.ReadFile(testutil.DatabasePath(t, file))
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(string(sql)).Error; err != nil {
			t.Fatal(file, err)
		}
	}
	store := &repository.Store{DB: db}
	svc := &service.Service{JWTKey: testutil.JWTKey, Store: store}
	session, err := svc.RegisterInitialOwner(ctx, "contract-owner", "password-test")
	if err != nil {
		t.Fatal(err)
	}
	handler := httpapi.New(config.Config{JWTKey: testutil.JWTKey, CORSOrigin: "http://localhost:3000"}, store)
	request := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1/"+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+session.AccessToken)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s: expected %d, got %d: %s", method, path, status, res.Code, res.Body.String())
		}
		if strings.Contains(res.Body.String(), "password_hash") || strings.Contains(res.Body.String(), "request_hash") {
			t.Fatal("secret exposed", res.Body.String())
		}
		return res
	}
	category := responseData[dto.CategoryResponse](t, request("POST", "kategori", `{"nama":"  Kontrak  "}`, 201))
	if category.Nama != "Kontrak" || category.CreatedBy == nil || *category.CreatedBy != session.User.ID {
		t.Fatal("category normalization/audit missing", category)
	}
	unit := responseData[dto.UnitResponse](t, request("POST", "satuan", `{"nama":"unit-contract"}`, 201))
	source := responseData[dto.SourceResponse](t, request("POST", "sumber-pembelian", `{"nama":"Pemasok","jenis":"TOKO","aktif":true}`, 201))
	payment := responseData[dto.PaymentResponse](t, request("POST", "metode-pembayaran", `{"nama":"Tunai Kontrak","jenis":"CASH","tarif_persen":"0","tarif_tetap":"0","penanggung_biaya":"TOKO","untuk_penjualan":true,"untuk_pembelian":true,"aktif":true}`, 201))
	productBody := fmt.Sprintf(`{"kategori_id":%d,"satuan_id":%d,"sku":"CONTRACT-01","nama":"Beras","harga_jual":"12500.50","stok_minimum":"0","aktif":true}`, category.ID, unit.ID)
	product := responseData[dto.ProductResponse](t, request("POST", "produk", productBody, 201))
	request("PUT", fmt.Sprintf("produk/%d", product.ID), productBody, 200)
	request("PUT", fmt.Sprintf("produk/%d/favorit", product.ID), `{"is_favorit":true}`, 200)
	for _, path := range []string{"kategori", "satuan", "produk?q=Beras", "sumber-pembelian", "metode-pembayaran?untuk=penjualan", "master-data", "katalog/produk?limit=50"} {
		request("GET", path, "", 200)
	}
	request("GET", "metode-pembayaran?untuk=unknown", "", 400)
	request("POST", "produk", `{"nama":"Invalid","total_tagihan":100}`, 400)

	purchaseBody := fmt.Sprintf(`{"idempotency_key":"11111111-1111-4111-8111-111111111111","metode_pembayaran_id":%d,"sumber_pembelian_id":%d,"diskon_transaksi":"0","jumlah_dibayar":"0","items":[{"produk_id":%d,"jumlah":"2","harga_beli":"7000","diskon":"0"}]}`, payment.ID, source.ID, product.ID)
	purchase := responseData[dto.PurchaseResponse](t, request("POST", "pembelian", purchaseBody, 201))
	purchaseAgain := responseData[dto.PurchaseResponse](t, request("POST", "pembelian", purchaseBody, 201))
	if purchase.ID != purchaseAgain.ID || len(purchase.Detail) != 1 {
		t.Fatal("purchase replay/detail changed")
	}
	saleBody := fmt.Sprintf(`{"idempotency_key":"22222222-2222-4222-8222-222222222222","metode_pembayaran_id":%d,"diskon_transaksi":"0","jumlah_dibayar":"7000","items":[{"produk_id":%d,"jumlah":"0.5","diskon":"0"}]}`, payment.ID, product.ID)
	sale := responseData[dto.SaleResponse](t, request("POST", "penjualan", saleBody, 201))
	saleAgain := responseData[dto.SaleResponse](t, request("POST", "penjualan", saleBody, 201))
	if sale.ID != saleAgain.ID || sale.TotalTagihan.StringFixed(2) != "6250.25" || sale.Kembalian.StringFixed(2) != "749.75" {
		t.Fatal("sale totals or replay changed", sale)
	}
	detail := responseData[dto.SaleDetailResponse](t, request("GET", fmt.Sprintf("penjualan/%d", sale.ID), "", 200))
	if detail.NamaKasir != session.User.Nama || len(detail.Detail) != 1 {
		t.Fatal("sale detail missing cashier/items")
	}
	request("GET", fmt.Sprintf("pembelian/%d", purchase.ID), "", 200)
	request("GET", "penjualan", "", 200)
	request("GET", "pembelian", "", 200)
	stocks := responseData[[]dto.StockSummaryResponse](t, request("GET", "stok/ringkasan", "", 200))
	if len(stocks) != 1 || stocks[0].Stok.String() != "1.5" {
		t.Fatal("replay duplicated stock movements", stocks)
	}
	request("GET", "stok", "", 200)
	request("GET", fmt.Sprintf("produk/%d/mutasi", product.ID), "", 200)
	request("POST", fmt.Sprintf("penjualan/%d/batal", sale.ID), `{"alasan":"Uji pembatalan"}`, 200)
	request("POST", fmt.Sprintf("pembelian/%d/batal", purchase.ID), `{"alasan":"Uji pembatalan"}`, 200)

	date := time.Now().In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")
	noteBody := fmt.Sprintf(`{"idempotency_key":"33333333-3333-4333-8333-333333333333","tanggal":%q,"total":"1000","catatan":"Kantong"}`, date)
	note := responseData[dto.CashPurchaseNoteResponse](t, request("POST", "catatan-belanja", noteBody, 201))
	request("GET", "catatan-belanja?tanggal="+date+"&status=TERBUKA", "", 200)
	preview := responseData[dto.DailySnapshotResponse](t, request("GET", "ringkasan-harian/preview?tanggal="+date, "", 200))
	reportBody := fmt.Sprintf(`{"versi_perhitungan":2,"idempotency_key":"44444444-4444-4444-8444-444444444444","tanggal":%q,"hash_sumber":%q,"nama_toko":"Toko Kontrak","kas_aktual":"0","belanja_besok":"0","catatan":""}`, date, preview.HashSumber)
	report := responseData[dto.DailySummaryResponse](t, request("POST", "ringkasan-harian", reportBody, 201))
	request("GET", "ringkasan-harian?tanggal="+date, "", 200)
	request("GET", fmt.Sprintf("ringkasan-harian/%d", report.ID), "", 200)
	request("GET", fmt.Sprintf("ringkasan-harian/%d/email", report.ID), "", 200)
	request("POST", fmt.Sprintf("catatan-belanja/%d/batal", note.ID), "", 200)

	t.Run("successful master writes invalidate cache even if response reload fails", func(t *testing.T) {
		version := func() string {
			return responseData[map[string]string](t, request("GET", "master-data/version", "", 200))["version"]
		}
		before := version()
		const callback = "test:master-response-reload-failure"
		if err := db.Callback().Query().Before("gorm:query").Register(callback, func(query *gorm.DB) {
			if query.Statement.Table == "produk" {
				query.AddError(errors.New("simulated product reload failure"))
			}
		}); err != nil {
			t.Fatal(err)
		}
		defer db.Callback().Query().Remove(callback)
		updated := strings.Replace(productBody, "Beras", "Beras Updated", 1)
		request("PUT", fmt.Sprintf("produk/%d", product.ID), updated, 500)
		if before == version() {
			t.Fatal("persisted master mutation did not invalidate cache")
		}
	})
}
