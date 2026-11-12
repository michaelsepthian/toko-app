package model

type SourceKind string

const (
	SourceStore SourceKind = "TOKO"
	SourceSales SourceKind = "SALES"
)

func (k SourceKind) Valid() bool { return k == SourceStore || k == SourceSales }

type SumberPembelian struct {
	Base
	Audit
	Nama               string     `json:"nama"`
	Jenis              SourceKind `json:"jenis"`
	NamaTokoPerusahaan *string    `json:"nama_toko_perusahaan"`
	NamaKontak         *string    `json:"nama_kontak"`
	NomorTelepon       *string    `json:"nomor_telepon"`
	Alamat             *string    `json:"alamat"`
	Catatan            *string    `json:"catatan"`
	Aktif              bool       `json:"aktif"`
}

func (SumberPembelian) TableName() string { return "sumber_pembelian" }
