package service_test

import (
	"context"
	"toko/backend/test/testutil"

	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

type transactionService struct{ *service.Service }

func newTransactionService(store *repository.Store) *transactionService {
	return &transactionService{Service: &service.Service{JWTKey: testutil.JWTKey, Store: store}}
}

// Adapter fixture lama saja. Kode produksi menggunakan hasil bertipe dari
// CreateSale/CreatePurchase; assertion dan kasus regresi lama tetap dipertahankan.
func (s *transactionService) CreateTransaction(ctx context.Context, userID int64, purchase bool, in service.TransactionInput) (any, error) {
	if purchase {
		row, err := s.CreatePurchase(ctx, userID, in)
		if err != nil {
			return nil, err
		}
		return row, nil
	}
	row, err := s.CreateSale(ctx, userID, in)
	if err != nil {
		return nil, err
	}
	return row, nil
}

func (s *transactionService) Cancel(ctx context.Context, userID, id int64, purchase bool, reason string) error {
	if purchase {
		return s.CancelPurchase(ctx, userID, id, reason)
	}
	return s.CancelSale(ctx, userID, id, reason)
}
