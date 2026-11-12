package dto_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/dto"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

func jsonValue(t *testing.T, value any) any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result any
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestExplicitResponseMappingPreservesExistingJSONContract(t *testing.T) {
	now := time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)
	id := int64(7)
	text := "test-value"
	amount := decimal.RequireFromString("12500.50")
	base := model.Base{ID: id, CreatedAt: now, UpdatedAt: now}
	audit := model.NewAudit(id)
	cancel := model.Cancellation{CancelTransactionAt: &now, CancelTransactionBy: &id}
	header := model.Header{Base: base, Audit: audit, Cancellation: cancel, IdempotencyKey: &text,
		RequestHash: "hidden-request-hash", Nomor: "PJ-001", PenggunaID: id, MetodePembayaranID: id,
		Tanggal: now, Status: model.StatusCompleted, SubtotalBarang: amount, DiskonTransaksi: amount,
		TotalBelanja: amount, TarifPersen: amount, TarifTetap: amount, BiayaPembayaran: amount, NomorReferensi: &text, Catatan: &text}
	detail := model.Detail{Base: base, NamaProduk: text, ProdukID: id, Jumlah: amount, Diskon: amount, Subtotal: amount}
	user := model.Pengguna{Base: base, Nama: text, Username: text, PasswordHash: &text, Peran: model.RoleOwner, Aktif: true}
	category := model.Kategori{Base: base, Audit: audit, Nama: text, Deskripsi: &text}
	unit := model.Satuan{Base: base, Audit: audit, Nama: text}
	product := model.Produk{Base: base, Audit: audit, KategoriID: id, SatuanID: id, SKU: text, Barcode: &text, Nama: text,
		HargaJual: amount, StokMinimum: amount, Aktif: true, IsFavorit: true}
	source := model.SumberPembelian{Base: base, Audit: audit, Nama: text, Jenis: model.SourceStore, NamaTokoPerusahaan: &text,
		NamaKontak: &text, NomorTelepon: &text, Alamat: &text, Catatan: &text, Aktif: true}
	payment := model.MetodePembayaran{Base: base, Audit: audit, Jenis: model.PaymentCash, Nama: text, TarifPersen: amount,
		TarifTetap: amount, PenanggungBiaya: model.FeeStore, UntukPenjualan: true, UntukPembelian: true, Aktif: true}
	sale := model.Penjualan{Header: header, TanggalPendapatan: "2026-11-11", PenanggungBiaya: model.FeeStore,
		TotalTagihan: amount, JumlahDibayar: amount, Kembalian: amount, Detail: []model.DetailPenjualan{{Detail: detail, PenjualanID: id, HargaJual: amount}}}
	purchase := model.Pembelian{Header: header, SumberPembelianID: &id, NomorNota: &text, TotalPembayaran: amount,
		Detail: []model.DetailPembelian{{Detail: detail, PembelianID: id, HargaBeli: amount}}}
	stock := model.MutasiStok{ID: id, ProdukID: id, PenggunaID: id, DetailPenjualanID: &id, DetailPembelianID: &id,
		Tanggal: now, Jenis: model.StockReversal, Perubahan: amount, Catatan: &text, CreatedAt: now}
	shopping := model.RencanaBelanjaItem{Base: base, Audit: audit, IdempotencyKey: text, RequestHash: text, UrutanInput: 5,
		Tanggal: "2026-11-11", SumberPembelianID: &id, ProdukID: &id, NamaBarang: text, Jumlah: &amount,
		Satuan: text, Catatan: text, DibeliAt: &now, DibeliBy: &id, DeletedBy: &id}
	note := model.CatatanBelanja{ID: id, Audit: audit, Cancellation: cancel, IdempotencyKey: text, RequestHash: text,
		Tanggal: "2026-11-11", Total: amount, Catatan: text, PenggunaID: id, Status: model.NoteCompleted, PembelianID: &id, CreatedAt: now, UpdatedAt: now}
	summary := model.RingkasanHarian{ID: id, IdempotencyKey: text, RequestHash: text, Tanggal: "2026-11-11", PenggunaID: id,
		NamaPencatat: text, NamaToko: text, EmailTujuan: &text, KasAktual: amount, BelanjaBesok: amount,
		TotalDanaSeharusnya: amount, TotalDanaAktual: amount, KasSeharusnya: amount, SelisihKas: amount, SisaKas: amount,
		Catatan: text, Snapshot: json.RawMessage(`{"versi":2}`), CreatedAt: now}
	snapshot := model.DailySnapshot{Versi: 2, Tanggal: "2026-11-11", DihitungPada: now, HashSumber: text,
		Pembelian: []model.DailyPurchase{{CatatanID: &id, PembelianID: &id, Nomor: text, Metode: text, Total: amount,
			Items: []model.DailyPurchaseItem{{Nama: text, Jumlah: amount, Subtotal: amount}}}},
		Metode: []model.DailyPayment{{MetodePembayaranID: id, Nama: text, Jenis: "CASH", TotalSelesai: amount}}}
	tests := []struct {
		name          string
		before, after any
	}{
		{"user", user, dto.User(user)}, {"category", category, dto.Category(category)},
		{"unit", unit, dto.Unit(unit)}, {"product", product, dto.Product(product)},
		{"source", source, dto.Source(source)}, {"payment", payment, dto.Payment(payment)},
		{"sale", sale, dto.Sale(sale)}, {"purchase", purchase, dto.Purchase(purchase)},
		{"movement", stock, dto.Movement(stock)}, {"shopping", shopping, dto.ShoppingItem(shopping)},
		{"note", note, dto.CashPurchaseNote(note)}, {"summary", summary, dto.DailySummary(summary)},
		{"snapshot", snapshot, dto.DailySnapshot(snapshot)},
		{"login", service.LoginResult{User: user, AccessToken: text, ExpiresAt: now}, dto.Login(service.LoginResult{User: user, AccessToken: text, ExpiresAt: now})},
		{"empty sale", model.Penjualan{}, dto.Sale(model.Penjualan{})},
		{"empty purchase", model.Pembelian{}, dto.Purchase(model.Pembelian{})},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !reflect.DeepEqual(jsonValue(t, tt.before), jsonValue(t, tt.after)) {
				t.Fatalf("JSON contract changed\nbefore: %#v\nafter: %#v", jsonValue(t, tt.before), jsonValue(t, tt.after))
			}
		})
	}
}

func TestResponsesNeverExposeInternalSecrets(t *testing.T) {
	secret := "do-not-expose"
	responses := []any{
		dto.User(model.Pengguna{PasswordHash: &secret}),
		dto.Sale(model.Penjualan{Header: model.Header{RequestHash: secret}}),
		dto.ShoppingItem(model.RencanaBelanjaItem{RequestHash: secret, IdempotencyKey: secret}),
		dto.CashPurchaseNote(model.CatatanBelanja{RequestHash: secret, IdempotencyKey: secret}),
		dto.DailySummary(model.RingkasanHarian{RequestHash: secret, IdempotencyKey: secret}),
	}
	for _, response := range responses {
		raw, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), secret) || strings.Contains(string(raw), "password_hash") || strings.Contains(string(raw), "request_hash") {
			t.Fatalf("internal value exposed: %s", raw)
		}
	}
}

func TestRequestMappingPreservesIdempotencyPayload(t *testing.T) {
	const body = `{"tanggal_pendapatan":"2026-11-10","idempotency_key":"11111111-1111-4111-8111-111111111111","metode_pembayaran_id":7,"diskon_transaksi":"0","jumlah_dibayar":"10000","items":[{"produk_id":3,"jumlah":"0.125","diskon":"0"}]}`
	var request dto.TransactionRequest
	var previous service.TransactionInput
	if err := json.Unmarshal([]byte(body), &request); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(body), &previous); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(previous)
	after, _ := json.Marshal(request.Input())
	if string(before) != string(after) {
		t.Fatalf("idempotency serialization changed\n%s\n%s", before, after)
	}
	if dto.Map([]model.Produk(nil), dto.Product) != nil {
		t.Fatal("nil became empty array")
	}
	if dto.Map([]model.Produk{}, dto.Product) == nil {
		t.Fatal("empty array became null")
	}
}
