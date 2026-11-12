package model

import "github.com/shopspring/decimal"

type PaymentKind string
type FeeBearer string

const (
	PaymentCash     PaymentKind = "CASH"
	PaymentQRIS     PaymentKind = "QRIS"
	PaymentDebit    PaymentKind = "DEBIT"
	PaymentTransfer PaymentKind = "TRANSFER"
	PaymentOther    PaymentKind = "LAINNYA"
	FeeStore        FeeBearer   = "TOKO"
	FeeCustomer     FeeBearer   = "PELANGGAN"
)

func (k PaymentKind) Valid() bool {
	switch k {
	case PaymentCash, PaymentQRIS, PaymentDebit, PaymentTransfer, PaymentOther:
		return true
	default:
		return false
	}
}

func (b FeeBearer) Valid() bool { return b == FeeStore || b == FeeCustomer }

type MetodePembayaran struct {
	Base
	Audit
	Jenis           PaymentKind     `json:"jenis" gorm:"default:LAINNYA"`
	Nama            string          `json:"nama"`
	TarifPersen     decimal.Decimal `json:"tarif_persen" gorm:"type:numeric(7,4)"`
	TarifTetap      decimal.Decimal `json:"tarif_tetap" gorm:"type:numeric(18,2)"`
	PenanggungBiaya FeeBearer       `json:"penanggung_biaya"`
	UntukPenjualan  bool            `json:"untuk_penjualan"`
	UntukPembelian  bool            `json:"untuk_pembelian"`
	Aktif           bool            `json:"aktif"`
}

func (MetodePembayaran) TableName() string { return "metode_pembayaran" }

func (m MetodePembayaran) AvailableFor(kind TransactionKind) bool {
	return m.Aktif && ((kind == Sale && m.UntukPenjualan) || (kind == Purchase && m.UntukPembelian))
}
