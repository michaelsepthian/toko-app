package model

import (
	"encoding/json"
	"github.com/shopspring/decimal"
	"time"
)

type RingkasanHarian struct {
	ID                  int64           `json:"id" gorm:"primaryKey;autoIncrement"`
	IdempotencyKey      string          `json:"-"`
	RequestHash         string          `json:"-"`
	Tanggal             ReportDate      `json:"tanggal" gorm:"type:date"`
	PenggunaID          int64           `json:"pengguna_id"`
	NamaPencatat        string          `json:"nama_pencatat"`
	NamaToko            string          `json:"nama_toko"`
	EmailTujuan         *string         `json:"email_tujuan"`
	KasAktual           decimal.Decimal `json:"kas_aktual"`
	BelanjaBesok        decimal.Decimal `json:"belanja_besok"`
	TotalDanaSeharusnya decimal.Decimal `json:"total_dana_seharusnya"`
	TotalDanaAktual     decimal.Decimal `json:"total_dana_aktual"`
	KasSeharusnya       decimal.Decimal `json:"kas_seharusnya"`
	SelisihKas          decimal.Decimal `json:"selisih_kas"`
	SisaKas             decimal.Decimal `json:"sisa_kas"`
	Catatan             string          `json:"catatan"`
	Snapshot            json.RawMessage `json:"snapshot" gorm:"type:jsonb"`
	CreatedAt           time.Time       `json:"created_at"`
}

func (RingkasanHarian) TableName() string { return "ringkasan_harian" }
