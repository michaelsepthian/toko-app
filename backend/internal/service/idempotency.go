package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"

	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Advisory lock menyerialkan request ulang, termasuk sebelum header pertama ada.
// Payload yang berbeda tidak boleh memakai key yang sama.
func replayTransaction(tx *repository.Store, userID int64, purchase bool, in *TransactionInput) (transactionResult, bool, string, error) {
	if in.IdempotencyKey == nil {
		return transactionResult{}, false, "", nil
	}
	if !uuidPattern.MatchString(*in.IdempotencyKey) {
		return transactionResult{}, false, "", apperror.Invalid("Idempotency key harus UUID")
	}
	key := strings.ToLower(*in.IdempotencyKey)
	in.IdempotencyKey = &key
	encoded, err := json.Marshal(in)
	if err != nil {
		return transactionResult{}, false, "", err
	}
	sum := sha256.Sum256(encoded)
	hash := hex.EncodeToString(sum[:])
	table := "penjualan"
	if purchase {
		table = "pembelian"
	}
	if err := tx.LockRequest(table + ":" + key); err != nil {
		return transactionResult{}, false, "", err
	}
	var row transactionResult
	var header model.Header
	if purchase {
		var record model.Pembelian
		record, err = tx.PurchaseByKey(key)
		row.purchase, header = record, record.Header
	} else {
		var record model.Penjualan
		record, err = tx.SaleByKey(key)
		row.sale, header = record, record.Header
	}
	if repository.IsNotFound(err) {
		return transactionResult{}, false, hash, nil
	}
	if err != nil {
		return transactionResult{}, false, "", err
	}
	if header.PenggunaID != userID || header.RequestHash != hash {
		return transactionResult{}, false, "", apperror.Conflict("Idempotency key sudah digunakan untuk request lain")
	}
	return row, true, hash, nil
}
