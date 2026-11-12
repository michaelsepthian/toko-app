package service

import (
	"context"
	"strings"

	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type NameInput struct {
	Nama      string
	Deskripsi *string
}
type ProductInput struct {
	KategoriID  int64
	SatuanID    int64
	SKU         string
	Barcode     *string
	Nama        string
	HargaJual   decimal.Decimal
	StokMinimum decimal.Decimal
	Aktif       bool
	IsFavorit   bool
}
type SourceInput struct {
	Nama               string
	Jenis              string
	NamaTokoPerusahaan *string
	NamaKontak         *string
	NomorTelepon       *string
	Alamat             *string
	Catatan            *string
	Aktif              bool
}
type PaymentInput struct {
	Jenis           string
	Nama            string
	TarifPersen     decimal.Decimal
	TarifTetap      decimal.Decimal
	PenanggungBiaya string
	UntukPenjualan  bool
	UntukPembelian  bool
	Aktif           bool
}

// Interface berada di sisi pemakai dan hanya memuat operasi yang diperlukan.
// Dipakai oleh implementasi PostgreSQL serta unit test tanpa database.
type masterRepository[M any] interface {
	List(context.Context, repository.MasterFilter) ([]M, error)
	Get(context.Context, int64) (M, error)
	Create(context.Context, *M) error
	Update(context.Context, int64, *M) error
}

// MasterService berbagi alur CRUD untuk master sederhana, bukan untuk transaksi.
type MasterService[I, M any] struct {
	repository     masterRepository[M]
	build          func(I, int64) (M, error)
	validateFilter func(MasterFilter) error
}

type MasterFilter = repository.MasterFilter

func (s MasterService[I, M]) List(ctx context.Context, filter MasterFilter) ([]M, error) {
	if s.validateFilter != nil {
		if err := s.validateFilter(filter); err != nil {
			return nil, err
		}
	}
	return s.repository.List(ctx, filter)
}

func (s MasterService[I, M]) Get(ctx context.Context, id int64) (M, error) {
	return s.repository.Get(ctx, id)
}

func (s MasterService[I, M]) Create(ctx context.Context, userID int64, input I) (M, error) {
	row, err := s.build(input, userID)
	if err != nil {
		return row, err
	}
	err = s.repository.Create(ctx, &row)
	return row, err
}

func (s MasterService[I, M]) Update(ctx context.Context, id, userID int64, input I) error {
	row, err := s.build(input, userID)
	if err != nil {
		return err
	}
	return s.repository.Update(ctx, id, &row)
}

func (s *Service) Categories() MasterService[NameInput, model.Kategori] {
	return MasterService[NameInput, model.Kategori]{
		repository: repository.Master[model.Kategori]{
			Store: s.Store, Path: "kategori", Columns: []string{"nama", "deskripsi"},
		},
		build: buildCategory,
	}
}

func (s *Service) Units() MasterService[NameInput, model.Satuan] {
	return MasterService[NameInput, model.Satuan]{
		repository: repository.Master[model.Satuan]{
			Store: s.Store, Path: "satuan", Columns: []string{"nama"},
		},
		build: buildUnit,
	}
}

func (s *Service) Products() MasterService[ProductInput, model.Produk] {
	return MasterService[ProductInput, model.Produk]{
		repository: repository.Master[model.Produk]{
			Store: s.Store, Path: "produk",
			Columns: []string{
				"kategori_id", "satuan_id", "sku", "barcode", "nama",
				"harga_jual", "stok_minimum", "aktif", "is_favorit",
			},
		},
		build: buildProduct,
	}
}

func (s *Service) Sources() MasterService[SourceInput, model.SumberPembelian] {
	return MasterService[SourceInput, model.SumberPembelian]{
		repository: repository.Master[model.SumberPembelian]{
			Store: s.Store, Path: "sumber-pembelian",
			Columns: []string{
				"nama", "jenis", "nama_toko_perusahaan", "nama_kontak",
				"nomor_telepon", "alamat", "catatan", "aktif",
			},
		},
		build: buildSource,
	}
}

func (s *Service) Payments() MasterService[PaymentInput, model.MetodePembayaran] {
	return MasterService[PaymentInput, model.MetodePembayaran]{
		repository: repository.Master[model.MetodePembayaran]{
			Store: s.Store, Path: "metode-pembayaran",
			Columns: []string{
				"nama", "jenis", "tarif_persen", "tarif_tetap", "penanggung_biaya",
				"untuk_penjualan", "untuk_pembelian", "aktif",
			},
		},
		build:          buildPayment,
		validateFilter: validatePaymentFilter,
	}
}

func validatePaymentFilter(filter MasterFilter) error {
	if filter.For != "" && filter.For != "penjualan" && filter.For != "pembelian" {
		return apperror.Invalid("Filter untuk harus penjualan atau pembelian")
	}
	return nil
}

func buildCategory(in NameInput, userID int64) (model.Kategori, error) {
	row := model.Kategori{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama), Deskripsi: in.Deskripsi}
	if row.Nama == "" {
		return row, apperror.Invalid("Nama wajib diisi")
	}
	return row, nil
}

func buildUnit(in NameInput, userID int64) (model.Satuan, error) {
	row := model.Satuan{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama)}
	if row.Nama == "" || in.Deskripsi != nil {
		return row, apperror.Invalid("Satuan hanya menerima nama")
	}
	return row, nil
}

func buildProduct(in ProductInput, userID int64) (model.Produk, error) {
	row := model.Produk{Audit: model.NewAudit(userID), KategoriID: in.KategoriID, SatuanID: in.SatuanID,
		SKU: strings.TrimSpace(in.SKU), Barcode: in.Barcode, Nama: strings.TrimSpace(in.Nama),
		HargaJual: in.HargaJual, StokMinimum: in.StokMinimum, Aktif: in.Aktif, IsFavorit: in.IsFavorit}
	if row.KategoriID <= 0 || row.SatuanID <= 0 || row.Nama == "" || row.SKU == "" || !Money(row.HargaJual) || row.StokMinimum.IsNegative() || !row.StokMinimum.Equal(row.StokMinimum.Round(3)) {
		return row, apperror.Invalid("Kategori, satuan, nama, SKU, harga, atau stok minimum tidak valid")
	}
	return row, nil
}

func buildSource(in SourceInput, userID int64) (model.SumberPembelian, error) {
	row := model.SumberPembelian{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama), Jenis: model.SourceKind(in.Jenis),
		NamaTokoPerusahaan: in.NamaTokoPerusahaan, NamaKontak: in.NamaKontak, NomorTelepon: in.NomorTelepon, Alamat: in.Alamat, Catatan: in.Catatan, Aktif: in.Aktif}
	if row.Nama == "" || !row.Jenis.Valid() {
		return row, apperror.Invalid("Nama wajib; jenis harus TOKO atau SALES")
	}
	return row, nil
}

func buildPayment(in PaymentInput, userID int64) (model.MetodePembayaran, error) {
	if in.Jenis == "" {
		in.Jenis = string(model.PaymentOther)
	}
	if !model.PaymentKind(in.Jenis).Valid() {
		return model.MetodePembayaran{}, apperror.Invalid("Jenis metode pembayaran tidak valid")
	}
	row := model.MetodePembayaran{Audit: model.NewAudit(userID), Nama: strings.TrimSpace(in.Nama), Jenis: model.PaymentKind(in.Jenis),
		TarifPersen: in.TarifPersen, TarifTetap: in.TarifTetap, PenanggungBiaya: model.FeeBearer(in.PenanggungBiaya),
		UntukPenjualan: in.UntukPenjualan, UntukPembelian: in.UntukPembelian, Aktif: in.Aktif}
	if row.Nama == "" || row.TarifPersen.IsNegative() || row.TarifPersen.GreaterThan(decimal.NewFromInt(100)) || !row.TarifPersen.Equal(row.TarifPersen.Round(4)) || !Money(row.TarifTetap) || !row.PenanggungBiaya.Valid() {
		return row, apperror.Invalid("Pengaturan metode pembayaran tidak valid")
	}
	return row, nil
}
