// Package model memetakan data bisnis dan tabel PostgreSQL.
// Model tidak digunakan langsung sebagai kontrak respons HTTP; gunakan dto.
package model

import "time"

type Base struct {
	ID        int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Nil berarti pelaku data lama tidak diketahui.
type Audit struct {
	CreatedBy *int64 `json:"created_by"`
	UpdatedBy *int64 `json:"updated_by"`
}

func NewAudit(userID int64) Audit {
	return Audit{CreatedBy: &userID, UpdatedBy: &userID}
}

type Cancellation struct {
	CancelTransactionAt *time.Time `json:"cancel_transaction_at"`
	CancelTransactionBy *int64     `json:"cancel_transaction_by"`
}
