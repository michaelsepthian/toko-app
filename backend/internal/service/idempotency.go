package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"gorm.io/gorm"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Advisory lock menyerialkan request ulang, termasuk sebelum header pertama ada.
// Payload yang berbeda tidak boleh memakai key yang sama.
func replayTransaction(tx *gorm.DB, userID int64, purchase bool, in *TransactionInput) (any, bool, string, error) {
	if in.IdempotencyKey == nil {
		return nil, false, "", nil
	}
	if !uuidPattern.MatchString(*in.IdempotencyKey) {
		return nil, false, "", apperror.Invalid("Idempotency key harus UUID")
	}
	key := strings.ToLower(*in.IdempotencyKey)
	in.IdempotencyKey = &key
	encoded, err := json.Marshal(in)
	if err != nil {
		return nil, false, "", err
	}
	sum := sha256.Sum256(encoded)
	hash := hex.EncodeToString(sum[:])
	table := "penjualan"
	if purchase {
		table = "pembelian"
	}
	if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", table+":"+key).Error; err != nil {
		return nil, false, "", err
	}
	var row any
	var header model.Header
	if purchase {
		var record model.Pembelian
		err = tx.Preload("Detail").Where("idempotency_key = ?", key).First(&record).Error
		row, header = record, record.Header
	} else {
		var record model.Penjualan
		err = tx.Preload("Detail").Where("idempotency_key = ?", key).First(&record).Error
		row, header = record, record.Header
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, hash, nil
	}
	if err != nil {
		return nil, false, "", err
	}
	if header.PenggunaID != userID || header.RequestHash != hash {
		return nil, false, "", apperror.Conflict("Idempotency key sudah digunakan untuk request lain")
	}
	return row, true, hash, nil
}
