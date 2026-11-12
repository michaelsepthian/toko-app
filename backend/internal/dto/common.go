// Package dto mendefinisikan kontrak HTTP yang terpisah dari model database.
// Mapping dilakukan eksplisit agar kolom baru tidak otomatis terekspos di API.
package dto

import "time"

type Envelope[T any] struct {
	Data T `json:"data"`
}
type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}
type ErrorDetail struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

type BaseResponse struct {
	ID        int64     `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AuditResponse struct {
	CreatedBy *int64 `json:"created_by"`
	UpdatedBy *int64 `json:"updated_by"`
}

type CancellationResponse struct {
	CancelTransactionAt *time.Time `json:"cancel_transaction_at"`
	CancelTransactionBy *int64     `json:"cancel_transaction_by"`
}

func Map[M, R any](rows []M, convert func(M) R) []R {
	if rows == nil {
		return nil
	}
	result := make([]R, len(rows))
	for i, row := range rows {
		result[i] = convert(row)
	}
	return result
}
