package service

import (
	"context"
	"errors"
	"testing"

	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type categoryRepositoryStub struct {
	created []model.Kategori
	err     error
}

func (s *categoryRepositoryStub) List(context.Context, repository.MasterFilter) ([]model.Kategori, error) {
	return s.created, s.err
}
func (s *categoryRepositoryStub) Get(context.Context, int64) (model.Kategori, error) {
	return model.Kategori{}, s.err
}
func (s *categoryRepositoryStub) Update(context.Context, int64, *model.Kategori) error { return s.err }
func (s *categoryRepositoryStub) Create(_ context.Context, row *model.Kategori) error {
	s.created = append(s.created, *row)
	return s.err
}

func TestMasterServiceValidatesAndBuildsAuditBeforePersistence(t *testing.T) {
	store := &categoryRepositoryStub{}
	svc := MasterService[NameInput, model.Kategori]{repository: store, build: buildCategory}
	if _, err := svc.Create(context.Background(), 7, NameInput{Nama: "  "}); err == nil {
		t.Fatal("accepted empty category")
	}
	if len(store.created) != 0 {
		t.Fatal("invalid input reached repository")
	}
	row, err := svc.Create(context.Background(), 7, NameInput{Nama: "  Sembako  "})
	if err != nil || row.Nama != "Sembako" || row.CreatedBy == nil || *row.CreatedBy != 7 || row.UpdatedBy == nil || *row.UpdatedBy != 7 {
		t.Fatal(row, err)
	}
	if len(store.created) != 1 {
		t.Fatal("expected one repository call")
	}
	store.err = errors.New("database unavailable")
	if _, err := svc.Create(context.Background(), 7, NameInput{Nama: "Minuman"}); !errors.Is(err, store.err) {
		t.Fatal("persistence error not propagated", err)
	}
}

func TestMasterValidationDoesNotNeedDatabase(t *testing.T) {
	svc := &Service{}
	if _, err := svc.Products().Create(context.Background(), 1, ProductInput{}); err == nil {
		t.Fatal("invalid product accepted")
	}
	if _, err := svc.Sources().Create(context.Background(), 1, SourceInput{Nama: "Toko", Jenis: "unknown"}); err == nil {
		t.Fatal("invalid source kind accepted")
	}
	if _, err := svc.Payments().Create(context.Background(), 1, PaymentInput{Jenis: "unknown"}); err == nil {
		t.Fatal("invalid payment kind accepted")
	}
	if _, err := svc.Payments().List(context.Background(), MasterFilter{For: "unknown"}); err == nil {
		t.Fatal("invalid payment filter accepted")
	}
}
