package service_test

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
	"toko/backend/internal/config"
	"toko/backend/internal/database"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
	"toko/backend/test/testutil"
)

func TestShoppingPlanIntegration(t *testing.T) {
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
	name := fmt.Sprintf("toko_test_shopping_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	db, err := database.Open(ctx, u.String())
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
	for _, path := range []string{"schema.sql", "migrations/20261110_rencana_belanja.sql", "migrations/20261110_rencana_belanja.sql"} {
		sql, err := os.ReadFile(testutil.DatabasePath(t, path))
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(string(sql)).Error; err != nil {
			t.Fatal(path, err)
		}
	}
	owner := model.Pengguna{Nama: "Owner", Username: "owner", Peran: "PEMILIK", Aktif: true}
	cashier := model.Pengguna{Nama: "Cashier", Username: "cashier", Peran: "KASIR", Aktif: true}
	category := model.Kategori{Nama: "Sembako"}
	sourceA := model.SumberPembelian{Nama: "Toko A", Jenis: "TOKO", Aktif: true}
	sourceB := model.SumberPembelian{Nama: "Toko B", Jenis: "TOKO", Aktif: true}
	for _, row := range []any{&owner, &cashier, &category, &sourceA, &sourceB} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var unit model.Satuan
	if err := db.Where("nama = ?", "kg").First(&unit).Error; err != nil {
		t.Fatal(err)
	}
	product := model.Produk{Nama: "Gula", SKU: "GULA", KategoriID: category.ID, SatuanID: unit.ID, Aktif: true}
	if err := db.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	svc := &service.Service{JWTKey: testutil.JWTKey, Store: &repository.Store{DB: db}}
	quantity := decimal.RequireFromString("2.5")
	input := service.ShoppingBatchInput{IdempotencyKey: "11111111-1111-4111-8111-111111111111", Tanggal: "2026-11-10", SumberPembelianID: &sourceA.ID, Items: []service.ShoppingItemInput{
		{ProdukID: &product.ID, NamaBarang: "Spoofed", Satuan: "Spoofed"},
		{NamaBarang: "Kantong kemasan", Jumlah: &quantity, Satuan: "pak", Catatan: "ukuran besar"},
	}}
	rows, err := svc.CreateShoppingItems(ctx, cashier, input)
	if err != nil || len(rows) != 2 {
		t.Fatal("cashier bulk create", rows, err)
	}
	if rows[0].Jumlah != nil || rows[0].NamaBarang != product.Nama || rows[0].Satuan != unit.Nama || *rows[0].CreatedBy != cashier.ID {
		t.Fatal("snapshot, nullable quantity, or audit mismatch", rows[0])
	}
	retried, err := svc.CreateShoppingItems(ctx, cashier, input)
	if err != nil || len(retried) != 2 || retried[0].ID != rows[0].ID {
		t.Fatal("retry duplicated batch", retried, err)
	}
	changed := input
	changed.Tanggal = "2026-11-11"
	if _, err := svc.CreateShoppingItems(ctx, cashier, changed); err == nil {
		t.Fatal("key reuse with changed input accepted")
	}
	if _, err := svc.CreateShoppingItems(ctx, owner, input); err == nil {
		t.Fatal("key reuse across users accepted")
	}
	bad := input
	bad.IdempotencyKey = "22222222-2222-4222-8222-222222222222"
	bad.Items = []service.ShoppingItemInput{{NamaBarang: "Valid"}, {NamaBarang: " "}}
	if _, err := svc.CreateShoppingItems(ctx, cashier, bad); err == nil {
		t.Fatal("invalid batch accepted")
	}
	var count int64
	db.Model(&model.RencanaBelanjaItem{}).Count(&count)
	if count != 2 {
		t.Fatal("batch was not atomic", count)
	}
	free := service.ShoppingBatchInput{IdempotencyKey: "33333333-3333-4333-8333-333333333333", Tanggal: input.Tanggal, Items: []service.ShoppingItemInput{{NamaBarang: "Sabun"}}}
	unknown, err := svc.CreateShoppingItems(ctx, owner, free)
	if err != nil || unknown[0].SumberPembelianID != nil || unknown[0].ProdukID != nil || unknown[0].Jumlah != nil {
		t.Fatal("unknown shop / other item", unknown, err)
	}
	checked, err := svc.CheckShoppingItem(ctx, cashier, rows[0].ID, true)
	if err != nil || checked.DibeliAt == nil || checked.DibeliBy == nil || *checked.DibeliBy != cashier.ID {
		t.Fatal("cashier checklist", checked, err)
	}
	sameCheck, err := svc.CheckShoppingItem(ctx, owner, rows[0].ID, true)
	if err != nil || !sameCheck.DibeliAt.Equal(*checked.DibeliAt) || *sameCheck.DibeliBy != cashier.ID {
		t.Fatal("repeated checklist should preserve original actor/time", sameCheck, err)
	}
	move := service.ShoppingMoveInput{IDs: []int64{rows[0].ID, rows[1].ID}, SumberPembelianID: &sourceB.ID, Tanggal: "2026-11-12"}
	if err := svc.MoveShoppingItems(ctx, cashier, move); err == nil {
		t.Fatal("cashier moved items")
	}
	if err := svc.MoveShoppingItems(ctx, owner, move); err != nil {
		t.Fatal("owner move", err)
	}
	var moved model.RencanaBelanjaItem
	if err := db.First(&moved, rows[0].ID).Error; err != nil || moved.DibeliAt == nil || *moved.SumberPembelianID != sourceB.ID || moved.Tanggal != "2026-11-12" || moved.Jumlah != nil {
		t.Fatal("move lost item fields", moved, err)
	}
	move.IDs = []int64{rows[0].ID, 99999999}
	move.SumberPembelianID = nil
	if err := svc.MoveShoppingItems(ctx, owner, move); err == nil {
		t.Fatal("partial move accepted")
	}
	db.First(&moved, rows[0].ID)
	if *moved.SumberPembelianID != sourceB.ID {
		t.Fatal("failed move changed source")
	}
	move.IDs = []int64{rows[0].ID}
	if err := svc.MoveShoppingItems(ctx, owner, move); err != nil {
		t.Fatal("move to unknown shop", err)
	}
	edited, err := svc.EditShoppingItem(ctx, owner, rows[1].ID, service.ShoppingItemInput{NamaBarang: "Kantong baru", Catatan: "tanpa jumlah"})
	if err != nil || edited.Jumlah != nil || edited.NamaBarang != "Kantong baru" || *edited.SumberPembelianID != sourceB.ID {
		t.Fatal("edit optional quantity", edited, err)
	}
	unchecked, err := svc.CheckShoppingItem(ctx, owner, rows[0].ID, false)
	if err != nil || unchecked.DibeliAt != nil || unchecked.DibeliBy != nil {
		t.Fatal("uncheck did not clear both fields", unchecked, err)
	}
	// HTTP endpoints run through real local-session authentication.
	access := testutil.AccessToken(t, db, cashier.ID)
	handler := httpapi.New(config.Config{JWTKey: testutil.JWTKey, CORSOrigin: "http://localhost:3000"}, svc.Store)
	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", "/api/v1/"+path, nil)
		req.Header.Set("Authorization", "Bearer "+access)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != 200 {
			t.Fatalf("GET %s: %d %s", path, res.Code, res.Body.String())
		}
		return res
	}
	var calendar struct {
		Data []struct {
			Tanggal string `json:"tanggal"`
			Total   int    `json:"total_item"`
		}
	}
	if err := json.Unmarshal(get("rencana-belanja/kalender?bulan=2026-11").Body.Bytes(), &calendar); err != nil || len(calendar.Data) != 2 {
		t.Fatal("calendar summary", calendar, err)
	}
	var listing struct{ Data []model.RencanaBelanjaItem }
	if err := json.Unmarshal(get("rencana-belanja?tanggal=2026-11-12&limit=100").Body.Bytes(), &listing); err != nil || len(listing.Data) != 2 {
		t.Fatal("cashier list", listing, err)
	}
	sources := get("rencana-belanja/sumber").Body.String()
	if !strings.Contains(sources, "Toko A") || strings.Contains(sources, "nomor_telepon") {
		t.Fatal("cashier sources leak contact fields or omit names", sources)
	}
	if err := svc.DeleteShoppingItem(ctx, owner, rows[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&model.RencanaBelanjaItem{}, rows[0].ID).Error; err != gorm.ErrRecordNotFound {
		t.Fatal("deleted row visible", err)
	}
	if err := json.Unmarshal(get("rencana-belanja?tanggal=2026-11-12&limit=100").Body.Bytes(), &listing); err != nil || len(listing.Data) != 1 {
		t.Fatal("deleted row appeared in HTTP list", listing, err)
	}
	if err := json.Unmarshal(get("rencana-belanja/kalender?bulan=2026-11").Body.Bytes(), &calendar); err != nil {
		t.Fatal(err)
	}
	for _, summary := range calendar.Data {
		if summary.Tanggal == "2026-11-12" && summary.Total != 1 {
			t.Fatal("deleted row counted in calendar", summary)
		}
	}
	if _, err := svc.CreateShoppingItems(ctx, cashier, input); err != nil {
		t.Fatal("retry after edit/move/delete", err)
	}
	db.Unscoped().Model(&model.RencanaBelanjaItem{}).Count(&count)
	if count != 3 {
		t.Fatal("retry recreated deleted rows", count)
	}
	for _, table := range []string{"mutasi_stok", "pembelian", "catatan_belanja"} {
		if err := db.Table(table).Count(&count).Error; err != nil || count != 0 {
			t.Fatal("shopping changed stock/financial records", table, count, err)
		}
	}
}
