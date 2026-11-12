package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"toko/backend/internal/config"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
	"toko/backend/test/testutil"
)

// Menghitung INSERT yang benar-benar dikirim, tanpa menulis SQL ke log.
type insertRecorder struct {
	logger.Interface
	counts map[string]int
}

func (r *insertRecorder) Trace(_ context.Context, _ time.Time, query func() (string, int64), _ error) {
	sql, _ := query()
	for _, table := range []string{"detail_penjualan", "detail_pembelian", "mutasi_stok"} {
		if strings.HasPrefix(sql, `INSERT INTO "`+table+`"`) {
			r.counts[table]++
		}
	}
}

func TestPostgresIntegration(t *testing.T) {
	db := isolatedAuthDatabase(t)
	ctx := context.Background()
	applyIncomeDateMigration(t, db)
	store := &repository.Store{DB: db}
	svc := newTransactionService(store)
	suffix := fmt.Sprint(time.Now().UnixNano())
	user := model.Pengguna{Nama: "Test", Username: "test-" + suffix, Peran: "PEMILIK", Aktif: true}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	category := model.Kategori{Nama: "Test-" + suffix}
	unit := model.Satuan{Nama: "Test-" + suffix}
	if err := db.Create(&category).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	barcode := "000089" + suffix
	product := model.Produk{Nama: "Beras", SKU: "TEST-" + suffix, Barcode: &barcode, KategoriID: category.ID, SatuanID: unit.ID, HargaJual: decimal.NewFromInt(10000), Aktif: true}
	if err := db.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	var cash model.MetodePembayaran
	if err := db.Where("nama = ?", "Cash").First(&cash).Error; err != nil {
		t.Fatal(err)
	}
	input := func(qty string, purchase bool) service.TransactionInput {
		item := service.ItemInput{ProdukID: product.ID, Jumlah: decimal.RequireFromString(qty)}
		if purchase {
			price := decimal.NewFromInt(7000)
			item.HargaBeli = &price
		}
		return service.TransactionInput{MetodePembayaranID: cash.ID, JumlahDibayar: decimal.NewFromInt(100000), Items: []service.ItemInput{item}}
	}
	checkStock := func(want string) {
		t.Helper()
		got, err := repository.Stock(db, product.ID)
		if err != nil || !got.Equal(decimal.RequireFromString(want)) {
			t.Fatalf("stock = %s (%v), want %s", got, err, want)
		}
	}

	t.Run("purchase then sale and cancellation", func(t *testing.T) {
		buy, err := svc.CreateTransaction(ctx, user.ID, true, input("10", true))
		if err != nil {
			t.Fatal(err)
		}
		purchase := buy.(model.Pembelian)
		if !strings.HasPrefix(purchase.Nomor, "BELI-") || !purchase.TotalPembayaran.Equal(decimal.NewFromInt(70000)) {
			t.Fatalf("bad purchase: %+v", purchase)
		}
		sell, err := svc.CreateTransaction(ctx, user.ID, false, input("2", false))
		if err != nil {
			t.Fatal(err)
		}
		sale := sell.(model.Penjualan)
		if !sale.TotalTagihan.Equal(decimal.NewFromInt(20000)) || !sale.Kembalian.Equal(decimal.NewFromInt(80000)) || !strings.HasPrefix(sale.Nomor, "BILL-") {
			t.Fatalf("bad sale: %+v", sale)
		}
		checkStock("8")
		if err := svc.Cancel(ctx, user.ID, purchase.ID, true, "test"); err == nil {
			t.Fatal("cannot cancel already consumed purchase")
		}
		checkStock("8")
		if err := svc.Cancel(ctx, user.ID, sale.ID, false, "test"); err != nil {
			t.Fatal(err)
		}
		checkStock("10")
		if err := svc.Cancel(ctx, user.ID, sale.ID, false, "test"); err == nil {
			t.Fatal("cannot cancel twice")
		}
		if err := svc.Cancel(ctx, user.ID, purchase.ID, true, "test"); err != nil {
			t.Fatal(err)
		}
		checkStock("0")
	})
	t.Run("insufficient payment rolls back", func(t *testing.T) {
		if _, err := svc.AdjustStock(ctx, user.ID, product.ID, service.StockInput{Jenis: "AWAL", Perubahan: decimal.NewFromInt(1), Catatan: "test"}); err != nil {
			t.Fatal(err)
		}
		var before, after int64
		db.Model(&model.Penjualan{}).Where("pengguna_id = ?", user.ID).Count(&before)
		in := input("1", false)
		in.JumlahDibayar = decimal.NewFromInt(1)
		if _, err := svc.CreateTransaction(ctx, user.ID, false, in); err == nil {
			t.Fatal("expected rejection")
		}
		db.Model(&model.Penjualan{}).Where("pengguna_id = ?", user.ID).Count(&after)
		if before != after {
			t.Fatal("header persisted after rollback")
		}
		checkStock("1")
	})
	t.Run("two cashiers may sell beyond stock without losing movements", func(t *testing.T) {
		start := make(chan struct{})
		results := make(chan error, 2)
		var wg sync.WaitGroup
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_, err := svc.CreateTransaction(ctx, user.ID, false, input("1", false))
				results <- err
			}()
		}
		close(start)
		wg.Wait()
		close(results)
		success := 0
		for err := range results {
			if err == nil {
				success++
			}
		}
		if success != 2 {
			t.Fatalf("got %d successful sales; want 2", success)
		}
		checkStock("-1")
		// Pulihkan saldo untuk pengujian berikutnya.
		if _, err := svc.AdjustStock(ctx, user.ID, product.ID, service.StockInput{Jenis: "PENYESUAIAN", Perubahan: decimal.NewFromInt(1), Catatan: "test"}); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("fee snapshot and payment flags", func(t *testing.T) {
		method := model.MetodePembayaran{Nama: "QRIS-" + suffix, TarifPersen: decimal.RequireFromString("0.7"), PenanggungBiaya: "PELANGGAN", UntukPenjualan: true, Aktif: true}
		if err := db.Create(&method).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := svc.AdjustStock(ctx, user.ID, product.ID, service.StockInput{Jenis: "PENYESUAIAN", Perubahan: decimal.NewFromInt(2), Catatan: "test"}); err != nil {
			t.Fatal(err)
		}
		in := input("1", false)
		in.MetodePembayaranID = method.ID
		out, err := svc.CreateTransaction(ctx, user.ID, false, in)
		if err != nil {
			t.Fatal(err)
		}
		sale := out.(model.Penjualan)
		if !sale.BiayaPembayaran.Equal(decimal.NewFromInt(70)) || !sale.TotalTagihan.Equal(decimal.NewFromInt(10070)) {
			t.Fatal("fee calculation incorrect")
		}
		if err := db.Model(&method).Update("tarif_persen", 2).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&sale, sale.ID).Error; err != nil {
			t.Fatal(err)
		}
		if !sale.TarifPersen.Equal(decimal.RequireFromString("0.7")) {
			t.Fatal("historical fee changed")
		}
		buy := input("1", true)
		buy.MetodePembayaranID = method.ID
		if _, err := svc.CreateTransaction(ctx, user.ID, true, buy); err == nil {
			t.Fatal("sale-only method allowed for purchase")
		}
	})
	t.Run("idempotent concurrent retry and historical name", func(t *testing.T) {
		key := fmt.Sprintf("%08x-0000-4000-8000-%012x", uint32(time.Now().UnixNano()), user.ID)
		in := input("3", true)
		in.IdempotencyKey = &key
		before, err := repository.Stock(db, product.ID)
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		results := make(chan model.Pembelian, 2)
		errs := make(chan error, 2)
		var wg sync.WaitGroup
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				out, err := svc.CreateTransaction(ctx, user.ID, true, in)
				if err != nil {
					errs <- err
					return
				}
				results <- out.(model.Pembelian)
			}()
		}
		close(start)
		wg.Wait()
		close(results)
		close(errs)
		for err := range errs {
			t.Fatal(err)
		}
		var savedID int64
		for record := range results {
			if savedID != 0 && savedID != record.ID {
				t.Fatal("duplicate transaction")
			}
			savedID = record.ID
		}
		after, err := repository.Stock(db, product.ID)
		if err != nil || !after.Equal(before.Add(decimal.NewFromInt(3))) {
			t.Fatal("duplicate stock movement", after, err)
		}
		changed := in
		changed.Items = []service.ItemInput{in.Items[0]}
		changed.Items[0].Jumlah = decimal.NewFromInt(4)
		if _, err := svc.CreateTransaction(ctx, user.ID, true, changed); err == nil {
			t.Fatal("key accepted different payload")
		}
		if err := db.Model(&product).Update("nama", "Beras Baru").Error; err != nil {
			t.Fatal(err)
		}
		var record model.Pembelian
		if err := db.Preload("Detail").First(&record, savedID).Error; err != nil {
			t.Fatal(err)
		}
		if len(record.Detail) != 1 || record.Detail[0].NamaProduk != "Beras" {
			t.Fatal("historical product name changed")
		}
	})

	t.Run("batch detail and movements preserve IDs with two inserts", func(t *testing.T) {
		products := []model.Produk{
			{Nama: "Batch A", SKU: "BATCH-A-" + suffix, KategoriID: category.ID, SatuanID: unit.ID, HargaJual: decimal.NewFromInt(1000), Aktif: true},
			{Nama: "Batch B", SKU: "BATCH-B-" + suffix, KategoriID: category.ID, SatuanID: unit.ID, HargaJual: decimal.NewFromInt(2000), Aktif: true},
		}
		if err := db.Create(&products).Error; err != nil {
			t.Fatal(err)
		}
		prices := map[int64]decimal.Decimal{products[0].ID: products[0].HargaJual, products[1].ID: products[1].HargaJual}
		for _, purchase := range []bool{true, false} {
			table, kind := "penjualan", "PENJUALAN"
			if purchase {
				table, kind = "pembelian", "PEMBELIAN"
			}
			t.Run(table, func(t *testing.T) {
				recorder := &insertRecorder{Interface: logger.Default, counts: make(map[string]int)}
				batchService := newTransactionService(&repository.Store{DB: db.Session(&gorm.Session{Logger: recorder})})
				in := service.TransactionInput{MetodePembayaranID: cash.ID, JumlahDibayar: decimal.NewFromInt(10000)}
				for i, product := range products {
					item := service.ItemInput{ProdukID: product.ID, Jumlah: decimal.NewFromInt(int64(i + 1))}
					if purchase {
						price := product.HargaJual
						item.HargaBeli = &price
					}
					in.Items = append(in.Items, item)
				}
				result, err := batchService.CreateTransaction(ctx, user.ID, purchase, in)
				if err != nil {
					t.Fatal(err)
				}
				if recorder.counts["detail_"+table] != 1 || recorder.counts["mutasi_stok"] != 1 {
					t.Fatalf("want one detail INSERT and one movement INSERT; got %v", recorder.counts)
				}
				expected := make(map[int64]model.Detail)
				if purchase {
					for _, row := range result.(model.Pembelian).Detail {
						expected[row.ID] = row.Detail
					}
				} else {
					for _, row := range result.(model.Penjualan).Detail {
						expected[row.ID] = row.Detail
					}
				}
				if len(expected) != 2 {
					t.Fatalf("want two distinct detail IDs, got %v", expected)
				}
				ids := make([]int64, 0, len(expected))
				for id := range expected {
					if id == 0 {
						t.Fatal("zero detail ID")
					}
					ids = append(ids, id)
				}
				var movements []model.MutasiStok
				if err := db.Where("detail_"+table+"_id IN ?", ids).Find(&movements).Error; err != nil {
					t.Fatal(err)
				}
				if len(movements) != 2 {
					t.Fatalf("got %d movements, want 2", len(movements))
				}
				for _, movement := range movements {
					detailID, otherID := movement.DetailPenjualanID, movement.DetailPembelianID
					if purchase {
						detailID, otherID = movement.DetailPembelianID, movement.DetailPenjualanID
					}
					if detailID == nil || otherID != nil {
						t.Fatal("wrong movement reference")
					}
					detail, found := expected[*detailID]
					quantity := detail.Jumlah
					if !purchase {
						quantity = quantity.Neg()
					}
					if !found || movement.ProdukID != detail.ProdukID || movement.PenggunaID != user.ID || movement.Jenis != model.StockKind(kind) || !movement.Perubahan.Equal(quantity) {
						t.Fatalf("movement does not match detail: %+v", movement)
					}
					if !detail.Subtotal.Equal(detail.Jumlah.Mul(prices[detail.ProdukID])) {
						t.Fatal("generated subtotal missing")
					}
				}
			})
		}
	})
	t.Run("HTTP auth and master creation", func(t *testing.T) {
		access := testutil.AccessToken(t, db, user.ID)
		handler := httpapi.New(config.Config{JWTKey: testutil.JWTKey, CORSOrigin: "http://localhost:3000"}, store)
		request := func(method, path, body string) *httptest.ResponseRecorder {
			req := httptest.NewRequest(method, path, strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+access)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			return res
		}
		beforeMaster := request("GET", "/api/v1/master-data", "")
		if beforeMaster.Code != 200 {
			t.Fatalf("master: %d %s", beforeMaster.Code, beforeMaster.Body.String())
		}
		var beforeSnapshot struct {
			Data struct {
				Version string `json:"version"`
			} `json:"data"`
		}
		if err := json.Unmarshal(beforeMaster.Body.Bytes(), &beforeSnapshot); err != nil {
			t.Fatal(err)
		}
		res := request("POST", "/api/v1/kategori", `{"nama":"HTTP-`+suffix+`"}`)
		if res.Code != 201 {
			t.Fatalf("%d %s", res.Code, res.Body.String())
		}
		var payload struct {
			Data model.Kategori `json:"data"`
		}
		_ = json.Unmarshal(res.Body.Bytes(), &payload)
		if payload.Data.ID == 0 {
			t.Fatal("missing generated ID")
		}
		afterMaster := request("GET", "/api/v1/master-data", "")
		var afterSnapshot struct {
			Data struct {
				Version string `json:"version"`
			} `json:"data"`
		}
		if err := json.Unmarshal(afterMaster.Body.Bytes(), &afterSnapshot); err != nil {
			t.Fatal(err)
		}
		if afterMaster.Code != 200 || beforeSnapshot.Data.Version == afterSnapshot.Data.Version || !strings.Contains(afterMaster.Body.String(), "HTTP-"+suffix) {
			t.Fatal("master cache not invalidated after category creation")
		}

		if payload.Data.CreatedAt.IsZero() || payload.Data.UpdatedAt.IsZero() {
			t.Fatal("missing database timestamps in create response")
		}
		if res := request("GET", fmt.Sprintf("/api/v1/kategori/%d", payload.Data.ID), ""); res.Code != 200 {
			t.Fatalf("%d %s", res.Code, res.Body.String())
		}
		if res := request("GET", "/api/v1/produk?barcode="+barcode, ""); res.Code != 200 || !strings.Contains(res.Body.String(), barcode) {
			t.Fatal("barcode lookup failed", res.Body.String())
		}
		if res := request("GET", "/api/v1/produk?barcode=000000000000000", ""); res.Code != 200 || strings.TrimSpace(res.Body.String()) != `{"data":[]}` {
			t.Fatal("barcode matched wrong product", res.Body.String())
		}
		if err := db.Model(&user).Update("peran", "KASIR").Error; err != nil {
			t.Fatal(err)
		}
		if res := request("GET", "/api/v1/stok/ringkasan", ""); res.Code != 403 {
			t.Fatalf("cashier stock summary: %d", res.Code)
		}
		cashierMaster := request("GET", "/api/v1/master-data", "")
		var cashierSnapshot struct {
			Data struct {
				Sources []json.RawMessage `json:"sources"`
			} `json:"data"`
		}
		if err := json.Unmarshal(cashierMaster.Body.Bytes(), &cashierSnapshot); err != nil {
			t.Fatal(err)
		}
		if cashierMaster.Code != 200 || len(cashierSnapshot.Data.Sources) != 0 {
			t.Fatal("cashier received purchase sources")
		}
		if res := request("POST", "/api/v1/kategori", `{"nama":"forbidden"}`); res.Code != 403 {
			t.Fatalf("got %d, want 403", res.Code)
		}
	})
}
