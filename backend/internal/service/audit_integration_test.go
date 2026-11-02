package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"toko/backend/internal/config"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

// Uses the isolated database created by TestDailySummaryIntegration.
func testAuditLifecycle(t *testing.T, db *gorm.DB, creator model.Pengguna, cash model.MetodePembayaran) {
	ctx := context.Background()
	svc := &service.Service{Store: &repository.Store{DB: db}}
	editor := model.Pengguna{Nama: "Audit editor", Username: "audit_editor", Peran: "PEMILIK", Aktif: true}
	if err := db.Create(&editor).Error; err != nil {
		t.Fatal(err)
	}
	tokens := map[int64]string{creator.ID: "toko_audit_creator", editor.ID: "toko_audit_editor"}
	for id, token := range tokens {
		if err := db.Create(&model.SesiPengguna{TokenHash: service.SessionHash(token), PenggunaID: id, ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	handler := httpapi.New(config.Config{}, svc.Store)
	request := func(actor int64, method, path, body string, status int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1/"+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+tokens[actor])
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, res.Code, res.Body.String())
		}
		if status >= 400 {
			return nil
		}
		var result struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Data
	}
	checkActor := func(row map[string]any, updated int64) {
		t.Helper()
		if row["created_by"] != float64(creator.ID) || row["updated_by"] != float64(updated) {
			t.Fatalf("wrong audit: %v", row)
		}
	}
	createMaster := func(path, body string) int64 {
		t.Helper()
		row := request(creator.ID, "POST", path, body, 201)
		checkActor(row, creator.ID)
		id := int64(row["id"].(float64))
		checkActor(request(editor.ID, "PUT", fmt.Sprintf("%s/%d", path, id), body, 200), editor.ID)
		request(editor.ID, "PUT", fmt.Sprintf("%s/%d", path, id), strings.TrimSuffix(body, "}")+`,"created_by":999}`, 400)
		return id
	}
	categoryID := createMaster("kategori", `{"nama":"Audit category"}`)
	unitID := createMaster("satuan", `{"nama":"Audit unit"}`)
	createMaster("sumber-pembelian", `{"nama":"Audit supplier","jenis":"TOKO","aktif":true}`)
	createMaster("metode-pembayaran", `{"nama":"Audit payment","jenis":"CASH","tarif_persen":"0","tarif_tetap":"0","penanggung_biaya":"TOKO","untuk_penjualan":true,"untuk_pembelian":true,"aktif":true}`)
	productID := createMaster("produk", fmt.Sprintf(`{"nama":"Audit product","sku":"AUDIT-PRODUCT","kategori_id":%d,"satuan_id":%d,"harga_jual":"1000","stok_minimum":"0","aktif":true,"is_favorit":false}`, categoryID, unitID))
	checkActor(request(creator.ID, "PUT", fmt.Sprintf("produk/%d/favorit", productID), `{"is_favorit":true}`, 200), creator.ID)

	noteIn := service.CashPurchaseNoteInput{IdempotencyKey: "00000000-0000-4000-8000-000000000711", Tanggal: time.Now().In(time.FixedZone("WIB", 25200)).Format("2006-01-02"), Total: decimal.NewFromInt(1000)}
	note, err := svc.CreateCashPurchaseNote(ctx, creator.ID, noteIn)
	if err != nil {
		t.Fatal(err)
	}
	price := decimal.NewFromInt(1000)
	key := "00000000-0000-4000-8000-000000000712"
	in := service.TransactionInput{IdempotencyKey: &key, CatatanBelanjaID: &note.ID, MetodePembayaranID: cash.ID, Items: []service.ItemInput{{ProdukID: productID, Jumlah: decimal.NewFromInt(1), HargaBeli: &price}}}
	output, err := svc.CreateTransaction(ctx, editor.ID, true, in)
	if err != nil {
		t.Fatal(err)
	}
	purchase := output.(model.Pembelian)
	if err := db.First(&note, note.ID).Error; err != nil {
		t.Fatal(err)
	}
	if note.CreatedBy == nil || *note.CreatedBy != creator.ID || note.UpdatedBy == nil || *note.UpdatedBy != editor.ID {
		t.Fatal("itemization lost original creator", note)
	}
	if purchase.CreatedBy == nil || *purchase.CreatedBy != editor.ID {
		t.Fatal("purchase creator missing", purchase)
	}
	key = "00000000-0000-4000-8000-000000000713"
	in.CatatanBelanjaID = nil
	in.Items[0].HargaBeli = nil
	in.JumlahDibayar = price
	output, err = svc.CreateTransaction(ctx, creator.ID, false, in)
	if err != nil {
		t.Fatal(err)
	}
	sale := output.(model.Penjualan)
	if sale.CancelTransactionAt != nil || sale.CancelTransactionBy != nil {
		t.Fatal("uncanceled sale has cancellation audit")
	}
	if err := svc.Cancel(ctx, editor.ID, sale.ID, false, ""); err == nil {
		t.Fatal("empty cancellation reason accepted")
	}
	if err := svc.Cancel(ctx, editor.ID, sale.ID, false, "audit test"); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&sale, sale.ID).Error; err != nil {
		t.Fatal(err)
	}
	if sale.CreatedBy == nil || *sale.CreatedBy != creator.ID || sale.UpdatedBy == nil || *sale.UpdatedBy != editor.ID || sale.CancelTransactionBy == nil || *sale.CancelTransactionBy != editor.ID || sale.CancelTransactionAt == nil {
		t.Fatal("sale cancellation audit", sale)
	}
	originalAt := *sale.CancelTransactionAt
	if err := svc.Cancel(ctx, creator.ID, sale.ID, false, "again"); err == nil {
		t.Fatal("repeat cancel accepted")
	}
	if err := db.First(&sale, sale.ID).Error; err != nil || !sale.CancelTransactionAt.Equal(originalAt) {
		t.Fatal("repeat cancellation changed audit", err)
	}
	if err := svc.Cancel(ctx, creator.ID, purchase.ID, true, "audit purchase"); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&purchase, purchase.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&note, note.ID).Error; err != nil {
		t.Fatal(err)
	}
	if note.CancelTransactionBy == nil || *note.CancelTransactionBy != creator.ID || note.CancelTransactionAt == nil || purchase.CancelTransactionAt == nil || !note.CancelTransactionAt.Equal(*purchase.CancelTransactionAt) {
		t.Fatal("linked cancellation audit mismatch", note, purchase)
	}
	noteIn.IdempotencyKey = "00000000-0000-4000-8000-000000000714"
	open, err := svc.CreateCashPurchaseNote(ctx, creator.ID, noteIn)
	if err != nil {
		t.Fatal(err)
	}
	request(editor.ID, "POST", fmt.Sprintf("catatan-belanja/%d/batal", open.ID), "", 200)
	if err := db.First(&open, open.ID).Error; err != nil {
		t.Fatal(err)
	}
	if open.CancelTransactionBy == nil || *open.CancelTransactionBy != editor.ID || open.CreatedBy == nil || *open.CreatedBy != creator.ID || open.UpdatedBy == nil || *open.UpdatedBy != editor.ID || open.CancelTransactionAt == nil {
		t.Fatal("open note audit", open)
	}
	// Reapplying the migration preserves existing actor and timestamp history.
	updatedAt := sale.UpdatedAt
	applyAuditMigration(t, db)
	applyAuditMigration(t, db)
	if err := db.First(&sale, sale.ID).Error; err != nil || !sale.UpdatedAt.Equal(updatedAt) || !sale.CancelTransactionAt.Equal(originalAt) || *sale.CreatedBy != creator.ID || *sale.UpdatedBy != editor.ID {
		t.Fatal("migration rewrote audit", sale, err)
	}
}
