package httpapi

import (
	"net/http"
	"strings"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type nameInput struct {
	Nama      string  `json:"nama"`
	Deskripsi *string `json:"deskripsi,omitempty"`
}
type productInput struct {
	KategoriID  int64           `json:"kategori_id"`
	SatuanID    int64           `json:"satuan_id"`
	SKU         string          `json:"sku"`
	Barcode     *string         `json:"barcode"`
	Nama        string          `json:"nama"`
	HargaJual   decimal.Decimal `json:"harga_jual"`
	StokMinimum decimal.Decimal `json:"stok_minimum"`
	Aktif       bool            `json:"aktif"`
	IsFavorit   bool            `json:"is_favorit"`
}
type sourceInput struct {
	Nama               string  `json:"nama"`
	Jenis              string  `json:"jenis"`
	NamaTokoPerusahaan *string `json:"nama_toko_perusahaan"`
	NamaKontak         *string `json:"nama_kontak"`
	NomorTelepon       *string `json:"nomor_telepon"`
	Alamat             *string `json:"alamat"`
	Catatan            *string `json:"catatan"`
	Aktif              bool    `json:"aktif"`
}
type paymentInput struct {
	Jenis           string          `json:"jenis"`
	Nama            string          `json:"nama"`
	TarifPersen     decimal.Decimal `json:"tarif_persen"`
	TarifTetap      decimal.Decimal `json:"tarif_tetap"`
	PenanggungBiaya string          `json:"penanggung_biaya"`
	UntukPenjualan  bool            `json:"untuk_penjualan"`
	UntukPembelian  bool            `json:"untuk_pembelian"`
	Aktif           bool            `json:"aktif"`
}

// Resource generik hanya untuk master sederhana. Transaksi memiliki service khusus.
// DTO terpisah dan daftar kolom eksplisit mencegah client mengubah ID/timestamp.
func resource[I, M any](mux *http.ServeMux, db *gorm.DB, invalidate func(), path string, columns []string, build func(I, int64) (M, error)) {
	mux.HandleFunc("GET /api/v1/"+path, func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := pagination(r)
		if err != nil {
			fail(w, err)
			return
		}
		query := db.WithContext(r.Context()).Model(new(M))
		if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
			if path == "produk" {
				query = query.Where("(nama ILIKE ? OR sku ILIKE ? OR barcode ILIKE ?)", "%"+q+"%", "%"+q+"%", "%"+q+"%")
			} else {
				query = query.Where("nama ILIKE ?", "%"+q+"%")
			}
		}
		if path == "produk" && r.URL.Query().Get("barcode") != "" {
			query = query.Where("barcode = ?", r.URL.Query().Get("barcode"))
		}
		if path == "metode-pembayaran" {
			switch r.URL.Query().Get("untuk") {
			case "penjualan":
				query = query.Where("aktif = true AND untuk_penjualan = true")
			case "pembelian":
				query = query.Where("aktif = true AND untuk_pembelian = true")
			case "":
			default:
				fail(w, apperror.Invalid("Filter untuk harus penjualan atau pembelian"))
				return
			}
		}
		rows := make([]M, 0)
		if err := query.Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, rows)
	})
	mux.HandleFunc("GET /api/v1/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var row M
		if err := db.WithContext(r.Context()).First(&row, id).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, row)
	})
	mux.HandleFunc("POST /api/v1/"+path, owner(func(w http.ResponseWriter, r *http.Request) {
		var input I
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := build(input, currentUser(r).ID)
		if err != nil {
			fail(w, err)
			return
		}
		if err := db.WithContext(r.Context()).Clauses(clause.Returning{}).Select(append(append([]string{}, columns...), "created_by", "updated_by")).Create(&row).Error; err != nil {
			fail(w, err)
			return
		}
		invalidate()
		respond(w, 201, row)
	}))
	mux.HandleFunc("PUT /api/v1/"+path+"/{id}", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var input I
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		row, err := build(input, currentUser(r).ID)
		if err != nil {
			fail(w, err)
			return
		}
		result := db.WithContext(r.Context()).Model(new(M)).Where("id = ?", id).Select(append(append([]string{}, columns...), "updated_by")).Updates(&row)
		if result.Error != nil {
			fail(w, result.Error)
			return
		}
		if result.RowsAffected == 0 {
			fail(w, gorm.ErrRecordNotFound)
			return
		}
		invalidate()
		if err := db.WithContext(r.Context()).First(&row, id).Error; err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, row)
	}))
}

func registerMasters(mux *http.ServeMux, db *gorm.DB, invalidate func()) {
	mux.HandleFunc("PUT /api/v1/produk/{id}/favorit", owner(func(w http.ResponseWriter, r *http.Request) {
		id, err := pathID(r)
		if err != nil {
			fail(w, err)
			return
		}
		var input struct {
			IsFavorit *bool `json:"is_favorit"`
		}
		if err := decode(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		if input.IsFavorit == nil {
			fail(w, apperror.Invalid("is_favorit wajib diisi true atau false"))
			return
		}
		var product model.Produk
		result := db.WithContext(r.Context()).Model(&product).Clauses(clause.Returning{}).Where("id = ?", id).Updates(map[string]any{"is_favorit": *input.IsFavorit, "updated_by": currentUser(r).ID})
		if result.Error != nil {
			fail(w, result.Error)
			return
		}
		if result.RowsAffected == 0 {
			fail(w, gorm.ErrRecordNotFound)
			return
		}
		invalidate()
		respond(w, 200, product)
	}))
	resource(mux, db, invalidate, "kategori", []string{"nama", "deskripsi"}, func(in nameInput, userID int64) (model.Kategori, error) {
		row := model.Kategori{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama), Deskripsi: in.Deskripsi}
		if row.Nama == "" {
			return row, apperror.Invalid("Nama wajib diisi")
		}
		return row, nil
	})
	resource(mux, db, invalidate, "satuan", []string{"nama"}, func(in nameInput, userID int64) (model.Satuan, error) {
		row := model.Satuan{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama)}
		if row.Nama == "" || in.Deskripsi != nil {
			return row, apperror.Invalid("Satuan hanya menerima nama")
		}
		return row, nil
	})
	resource(mux, db, invalidate, "produk", []string{"kategori_id", "satuan_id", "sku", "barcode", "nama", "harga_jual", "stok_minimum", "aktif", "is_favorit"}, func(in productInput, userID int64) (model.Produk, error) {
		row := model.Produk{Audit: model.NewAudit(userID), KategoriID: in.KategoriID, SatuanID: in.SatuanID, SKU: strings.TrimSpace(in.SKU), Barcode: in.Barcode,
			Nama: strings.TrimSpace(in.Nama), HargaJual: in.HargaJual, StokMinimum: in.StokMinimum, Aktif: in.Aktif, IsFavorit: in.IsFavorit}
		if row.KategoriID <= 0 || row.SatuanID <= 0 || row.Nama == "" || row.SKU == "" || !service.Money(row.HargaJual) || row.StokMinimum.IsNegative() || !row.StokMinimum.Equal(row.StokMinimum.Round(3)) {
			return row, apperror.Invalid("Kategori, satuan, nama, SKU, harga, atau stok minimum tidak valid")
		}
		return row, nil
	})
	resource(mux, db, invalidate, "sumber-pembelian", []string{"nama", "jenis", "nama_toko_perusahaan", "nama_kontak", "nomor_telepon", "alamat", "catatan", "aktif"}, func(in sourceInput, userID int64) (model.SumberPembelian, error) {
		row := model.SumberPembelian{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama), Jenis: in.Jenis, NamaTokoPerusahaan: in.NamaTokoPerusahaan,
			NamaKontak: in.NamaKontak, NomorTelepon: in.NomorTelepon, Alamat: in.Alamat, Catatan: in.Catatan, Aktif: in.Aktif}
		if row.Nama == "" || (row.Jenis != "TOKO" && row.Jenis != "SALES") {
			return row, apperror.Invalid("Nama wajib; jenis harus TOKO atau SALES")
		}
		return row, nil
	})
	resource(mux, db, invalidate, "metode-pembayaran", []string{"nama", "jenis", "tarif_persen", "tarif_tetap", "penanggung_biaya", "untuk_penjualan", "untuk_pembelian", "aktif"}, func(in paymentInput, userID int64) (model.MetodePembayaran, error) {
		if in.Jenis == "" {
			in.Jenis = "LAINNYA"
		}
		if in.Jenis != "CASH" && in.Jenis != "QRIS" && in.Jenis != "DEBIT" && in.Jenis != "TRANSFER" && in.Jenis != "LAINNYA" {
			return model.MetodePembayaran{}, apperror.Invalid("Jenis metode pembayaran tidak valid")
		}
		row := model.MetodePembayaran{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama), TarifPersen: in.TarifPersen, TarifTetap: in.TarifTetap,
			Jenis:           in.Jenis,
			PenanggungBiaya: in.PenanggungBiaya, UntukPenjualan: in.UntukPenjualan, UntukPembelian: in.UntukPembelian, Aktif: in.Aktif}
		if row.Nama == "" || row.TarifPersen.IsNegative() || row.TarifPersen.GreaterThan(decimal.NewFromInt(100)) || !row.TarifPersen.Equal(row.TarifPersen.Round(4)) || !service.Money(row.TarifTetap) ||
			(row.PenanggungBiaya != "TOKO" && row.PenanggungBiaya != "PELANGGAN") {
			return row, apperror.Invalid("Pengaturan metode pembayaran tidak valid")
		}
		return row, nil
	})
}
