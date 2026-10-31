package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/shopspring/decimal"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
	"toko/backend/internal/config"
	"toko/backend/internal/database"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

func TestDailySummaryIntegration(t *testing.T) {
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
	dbName := fmt.Sprintf("toko_test_summary_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + dbName).Error; err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + dbName
	db, err := database.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	t.Cleanup(func() {
		_ = pool.Close()
		if err := admin.Exec("DROP DATABASE " + dbName + " WITH (FORCE)").Error; err != nil {
			t.Error(err)
		}
		_ = adminPool.Close()
	})
	_, file, _, _ := runtime.Caller(0)
	schema, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../supabase/schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(schema)).Error; err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../supabase/ringkasan_harian.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(migration)).Error; err != nil {
		t.Fatal("rerun migration", err)
	}
	user := model.Pengguna{Nama: "Summary Owner", Username: "summary_owner", Peran: "PEMILIK", Aktif: true}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	var cash, qris, debit model.MetodePembayaran
	for name, target := range map[string]*model.MetodePembayaran{"Cash": &cash, "QRIS": &qris, "Debit": &debit} {
		if err := db.Where("nama = ?", name).Take(target).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&qris).Update("tarif_persen", decimal.NewFromInt(1)).Error; err != nil {
		t.Fatal(err)
	}
	qris.TarifPersen = decimal.NewFromInt(1)
	start, end, err := service.SummaryDay("2026-02-11", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	money := func(value int64) decimal.Decimal { return decimal.NewFromInt(value) }
	sale := func(method int64, amount int64, status string, date time.Time) model.Penjualan {
		row := model.Penjualan{Header: model.Header{PenggunaID: user.ID, MetodePembayaranID: method, Tanggal: date, Status: status, SubtotalBarang: money(amount)}, JumlahDibayar: money(amount + 10000)}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	first := sale(cash.ID, 100000, "SELESAI", start)
	sale(qris.ID, 200000, "SELESAI", start.Add(5*time.Hour))
	sale(cash.ID, 50000, "BATAL", start.Add(6*time.Hour))
	sale(cash.ID, 99999, "DRAFT", start.Add(7*time.Hour))
	sale(cash.ID, 70000, "SELESAI", end)
	sale(cash.ID, 80000, "SELESAI", start.Add(-time.Second))
	for _, fixture := range []struct {
		method int64
		amount int64
		status string
	}{{cash.ID, 30000, "SELESAI"}, {cash.ID, 9000, "BATAL"}, {debit.ID, 40000, "SELESAI"}} {
		row := model.Pembelian{Header: model.Header{PenggunaID: user.ID, MetodePembayaranID: fixture.method, Tanggal: start.Add(8 * time.Hour), Status: fixture.status, SubtotalBarang: money(fixture.amount)}}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	correction, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../supabase/ringkasan_pengeluaran.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := db.Exec(string(correction)).Error; err != nil {
			t.Fatal("repeat correction migration", err)
		}
	}
	var backfilled int64
	db.Model(&model.CatatanBelanja{}).Count(&backfilled)
	if backfilled != 2 {
		t.Fatal("backfill must include cash and debit, exclude canceled", backfilled)
	}

	svc := service.Service{Store: &repository.Store{DB: db}}

	previous, err := svc.PreviewDailySummary(ctx, "2026-02-10")
	if err != nil {
		t.Fatal(err)
	}
	counted := money(80000)
	previousInput := service.DailySummaryInput{VersiPerhitungan: 2, IdempotencyKey: "00000000-0000-4000-8000-000000000105", Tanggal: "2026-02-10", HashSumber: previous.HashSumber, NamaToko: "Toko Summary Test", KasAktual: &counted, BelanjaBesok: money(50000)}
	previousSaved, err := svc.SaveDailySummary(ctx, user, previousInput)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := svc.PreviewDailySummary(ctx, "2026-02-11")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.JumlahSelesai != 2 || snapshot.JumlahBatal != 1 || !snapshot.TotalSelesai.Equal(money(300000)) || !snapshot.TotalBatal.Equal(money(50000)) || !snapshot.TotalCash.Equal(money(100000)) || !snapshot.TotalNonCash.Equal(money(200000)) || !snapshot.TotalPembelian.Equal(money(70000)) || !snapshot.BiayaToko.Equal(money(2000)) || !snapshot.TotalBersih.Equal(money(298000)) {
		t.Fatalf("wrong snapshot: %+v", snapshot)
	}
	if snapshot.AlokasiSebelumnyaID == nil || *snapshot.AlokasiSebelumnyaID != previousSaved.ID || !snapshot.AlokasiSebelumnya.Equal(money(50000)) || !snapshot.SelisihBelanja.Equal(money(-20000)) {
		t.Fatal("previous budget missing", snapshot)
	}
	again, err := svc.PreviewDailySummary(ctx, "2026-02-11")
	if err != nil || again.HashSumber != snapshot.HashSumber {
		t.Fatal("unstable hash", err)
	}
	actual := money(279000)
	input := service.DailySummaryInput{VersiPerhitungan: 2, IdempotencyKey: "00000000-0000-4000-8000-000000000111", Tanggal: "2026-02-11", HashSumber: snapshot.HashSumber, NamaToko: "Toko Summary Test", EmailTujuan: "owner@example.com", KasAktual: &actual, BelanjaBesok: money(350000), Catatan: "Catatan penutupan"}
	var saved model.RingkasanHarian
	t.Run("concurrent retry saves one snapshot", func(t *testing.T) {
		results := make(chan model.RingkasanHarian, 2)
		errs := make(chan error, 2)
		var wait sync.WaitGroup
		for i := 0; i < 2; i++ {
			wait.Add(1)
			go func() {
				defer wait.Done()
				row, err := svc.SaveDailySummary(ctx, user, input)
				results <- row
				errs <- err
			}()
		}
		wait.Wait()
		close(results)
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatal(err)
			}
		}
		for row := range results {
			if saved.ID != 0 && row.ID != saved.ID {
				t.Fatal("duplicate snapshots")
			}
			saved = row
		}
		var count int64
		db.Model(&model.RingkasanHarian{}).Where("tanggal = ?", input.Tanggal).Count(&count)
		if count != 1 {
			t.Fatal("duplicates", count)
		}
	})
	if string(saved.Tanggal) != "2026-02-11" || !saved.KasSeharusnya.Equal(money(280000)) || !saved.SelisihKas.Equal(money(-1000)) || !saved.SisaKas.Equal(money(-71000)) {
		t.Fatalf("wrong stored reconciliation: %+v", saved)
	}
	changed := input
	changed.Catatan = "changed"
	if _, err := svc.SaveDailySummary(ctx, user, changed); err == nil {
		t.Fatal("same key accepted different body")
	}
	previousInput.IdempotencyKey = "00000000-0000-4000-8000-000000000106"
	previousInput.BelanjaBesok = money(60000)
	latestPrevious, err := svc.SaveDailySummary(ctx, user, previousInput)
	if err != nil {
		t.Fatal(err)
	}
	withNewBudget, err := svc.PreviewDailySummary(ctx, input.Tanggal)
	if err != nil || withNewBudget.HashSumber == snapshot.HashSumber || withNewBudget.AlokasiSebelumnyaID == nil || *withNewBudget.AlokasiSebelumnyaID != latestPrevious.ID || !withNewBudget.AlokasiSebelumnya.Equal(money(60000)) {
		t.Fatal("latest prior allocation not used", withNewBudget, err)
	}

	if err := db.Model(&qris).Update("nama", "QRIS renamed").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&first).Update("status", "BATAL").Error; err != nil {
		t.Fatal(err)
	}
	changed = input
	changed.IdempotencyKey = "00000000-0000-4000-8000-000000000112"
	if _, err := svc.SaveDailySummary(ctx, user, changed); err == nil || !strings.Contains(err.Error(), "Data transaksi berubah") {
		t.Fatal("stale source accepted", err)
	}
	var historic model.RingkasanHarian
	if err := db.First(&historic, saved.ID).Error; err != nil {
		t.Fatal(err)
	}
	var original service.DailySnapshot
	if err := json.Unmarshal(historic.Snapshot, &original); err != nil {
		t.Fatal(err)
	}
	if !original.TotalCash.Equal(money(100000)) || !strings.Contains(string(historic.Snapshot), `"nama": "QRIS"`) {
		t.Fatal("saved snapshot changed", string(historic.Snapshot))
	}
	email, err := service.BuildDailySummaryEmail(historic)
	if err != nil || !strings.Contains(email.HTML, "−Rp 71.000") || email.To == nil {
		t.Fatal("email", err)
	}
	ownerToken := "toko_summary_owner_session"
	db.Create(&model.SesiPengguna{TokenHash: service.SessionHash(ownerToken), PenggunaID: user.ID, ExpiresAt: time.Now().Add(time.Hour)})
	cashier := model.Pengguna{Nama: "Cashier", Username: "summary_cashier", Peran: "KASIR", Aktif: true}
	db.Create(&cashier)
	cashierToken := "toko_summary_cashier_session"
	db.Create(&model.SesiPengguna{TokenHash: service.SessionHash(cashierToken), PenggunaID: cashier.ID, ExpiresAt: time.Now().Add(time.Hour)})
	handler := httpapi.New(config.Config{}, &repository.Store{DB: db})
	for _, fixture := range []struct {
		token, path string
		want        int
	}{{ownerToken, "/api/v1/ringkasan-harian?tanggal=2026-02-11", 200}, {ownerToken, fmt.Sprintf("/api/v1/ringkasan-harian/%d/email", saved.ID), 200}, {cashierToken, "/api/v1/ringkasan-harian/preview?tanggal=2026-02-11", 403}, {cashierToken, "/api/v1/catatan-belanja", 403}, {cashierToken, "/api/v1/ringkasan-harian", 403}, {cashierToken, fmt.Sprintf("/api/v1/ringkasan-harian/%d/email", saved.ID), 403}} {
		request := httptest.NewRequest("GET", fixture.path, nil)
		request.Header.Set("Authorization", "Bearer "+fixture.token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != fixture.want {
			t.Fatal(fixture.path, response.Code, response.Body.String())
		}
	}
	t.Run("cash purchase can be itemized later without counting twice", func(t *testing.T) {
		noteInput := service.CashPurchaseNoteInput{IdempotencyKey: "00000000-0000-4000-8000-000000000121", Tanggal: "2026-02-11", Total: money(12000), Catatan: "Belanja pasar"}
		note, err := svc.CreateCashPurchaseNote(ctx, user.ID, noteInput)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := svc.CreateCashPurchaseNote(ctx, user.ID, noteInput)
		if err != nil || replay.ID != note.ID {
			t.Fatal("note replay", err)
		}
		snapshot, err := svc.PreviewDailySummary(ctx, noteInput.Tanggal)
		if err != nil || !snapshot.TotalPembelian.Equal(money(82000)) || !snapshot.PembelianBelumDirinci.Equal(money(12000)) {
			t.Fatal("note not counted", snapshot, err)
		}
		category := model.Kategori{Nama: "Summary test"}
		unit := model.Satuan{Nama: "summary unit"}
		if err := db.Create(&category).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&unit).Error; err != nil {
			t.Fatal(err)
		}
		product := model.Produk{Nama: "Summary product", SKU: "SUMMARY-ITEM", KategoriID: category.ID, SatuanID: unit.ID, HargaJual: money(15000), Aktif: true}
		if err := db.Create(&product).Error; err != nil {
			t.Fatal(err)
		}
		price := money(11000)
		key := "00000000-0000-4000-8000-000000000122"
		detail := service.TransactionInput{IdempotencyKey: &key, CatatanBelanjaID: &note.ID, MetodePembayaranID: cash.ID, Items: []service.ItemInput{{ProdukID: product.ID, Jumlah: money(1), HargaBeli: &price}}}
		if _, err := svc.CreateTransaction(ctx, user.ID, true, detail); err == nil {
			t.Fatal("mismatched note accepted")
		}
		var count int64
		db.Model(&model.MutasiStok{}).Where("produk_id = ?", product.ID).Count(&count)
		if count != 0 {
			t.Fatal("mismatched note changed stock")
		}
		price = money(12000)
		detail.MetodePembayaranID = debit.ID
		result, err := svc.CreateTransaction(ctx, user.ID, true, detail)
		if err != nil {
			t.Fatal(err)
		}
		purchase := result.(model.Pembelian)
		if _, err := svc.CreateTransaction(ctx, user.ID, true, detail); err != nil {
			t.Fatal("linked purchase retry", err)
		}
		db.Model(&model.MutasiStok{}).Where("produk_id = ?", product.ID).Count(&count)
		if count != 1 {
			t.Fatal("duplicate stock", count)
		}
		snapshot, err = svc.PreviewDailySummary(ctx, noteInput.Tanggal)
		if err != nil || !snapshot.TotalPembelian.Equal(money(82000)) || !snapshot.PembelianBelumDirinci.IsZero() {
			t.Fatal("linked purchase counted twice", snapshot, err)
		}
		today := time.Now().In(time.FixedZone("WIB", 7*3600)).Format("2006-01-02")
		current, err := svc.PreviewDailySummary(ctx, today)
		if err != nil || !current.TotalPembelian.IsZero() {
			t.Fatal("cash out moved to itemization day", current, err)
		}
		if err := svc.CancelCashPurchaseNote(ctx, note.ID); err == nil {
			t.Fatal("linked note independently canceled")
		}
		key = "00000000-0000-4000-8000-000000000123"
		if _, err := svc.CreateTransaction(ctx, user.ID, true, detail); err == nil {
			t.Fatal("note linked twice")
		}
		if err := svc.Cancel(ctx, user.ID, purchase.ID, true, "test cancellation"); err != nil {
			t.Fatal(err)
		}
		snapshot, err = svc.PreviewDailySummary(ctx, noteInput.Tanggal)
		if err != nil || !snapshot.TotalPembelian.Equal(money(70000)) {
			t.Fatal("canceled note still counted", snapshot, err)
		}
		ordinaryKey := "00000000-0000-4000-8000-000000000125"
		ordinary := detail
		ordinary.CatatanBelanjaID = nil
		ordinary.IdempotencyKey = &ordinaryKey
		ordinaryResult, err := svc.CreateTransaction(ctx, user.ID, true, ordinary)
		if err != nil {
			t.Fatal(err)
		}
		ordinaryPurchase := ordinaryResult.(model.Pembelian)
		var auto model.CatatanBelanja
		if err := db.Where("pembelian_id = ?", ordinaryPurchase.ID).Take(&auto).Error; err != nil || auto.Status != "SELESAI" || string(auto.Tanggal) != today {
			t.Fatal("automatic note missing", auto, err)
		}
		if _, err := svc.CreateTransaction(ctx, user.ID, true, ordinary); err != nil {
			t.Fatal("ordinary retry", err)
		}
		var autoCount int64
		db.Model(&model.CatatanBelanja{}).Where("pembelian_id = ?", ordinaryPurchase.ID).Count(&autoCount)
		if autoCount != 1 {
			t.Fatal("duplicate automatic note")
		}
		current, err = svc.PreviewDailySummary(ctx, today)
		if err != nil || !current.TotalPembelian.Equal(money(12000)) || len(current.Pembelian) != 1 || len(current.Pembelian[0].Items) != 1 {
			t.Fatal("ordinary noncash purchase not in summary", current, err)
		}

		noteInput.IdempotencyKey = "00000000-0000-4000-8000-000000000124"
		open, err := svc.CreateCashPurchaseNote(ctx, user.ID, noteInput)
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.CancelCashPurchaseNote(ctx, open.ID); err != nil {
			t.Fatal(err)
		}
		snapshot, err = svc.PreviewDailySummary(ctx, noteInput.Tanggal)
		if err != nil || !snapshot.TotalPembelian.Equal(money(70000)) {
			t.Fatal("voided note counted", snapshot, err)
		}
	})

}
