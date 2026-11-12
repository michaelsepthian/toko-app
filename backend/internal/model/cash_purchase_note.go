package model

import (
	"time"

	"github.com/shopspring/decimal"
)

type CashNoteStatus string

const (
	NoteOpen      CashNoteStatus = "TERBUKA"
	NoteCompleted CashNoteStatus = "SELESAI"
	NoteCancelled CashNoteStatus = "BATAL"
)

func (s CashNoteStatus) Valid() bool {
	return s == NoteOpen || s == NoteCompleted || s == NoteCancelled
}

type CatatanBelanja struct {
	Audit
	Cancellation
	ID             int64           `json:"id" gorm:"primaryKey;autoIncrement"`
	IdempotencyKey string          `json:"-"`
	RequestHash    string          `json:"-"`
	Tanggal        ReportDate      `json:"tanggal" gorm:"type:date"`
	Total          decimal.Decimal `json:"total"`
	Catatan        string          `json:"catatan"`
	PenggunaID     int64           `json:"pengguna_id"`
	Status         CashNoteStatus  `json:"status"`
	PembelianID    *int64          `json:"pembelian_id"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

func (CatatanBelanja) TableName() string { return "catatan_belanja" }
