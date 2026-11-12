package model

import "time"

type Role string

const (
	RoleOwner   Role = "PEMILIK"
	RoleCashier Role = "KASIR"
)

func (r Role) Valid() bool { return r == RoleOwner || r == RoleCashier }

type Pengguna struct {
	Base
	Nama         string  `json:"nama"`
	Username     string  `json:"username"`
	PasswordHash *string `json:"-"`
	Peran        Role    `json:"peran"`
	Aktif        bool    `json:"aktif"`
}

func (Pengguna) TableName() string { return "pengguna" }

type SesiPengguna struct {
	ID         string     `json:"-" gorm:"primaryKey"`
	PenggunaID int64      `json:"-"`
	ExpiresAt  time.Time  `json:"expires_at"`
	RevokedAt  *time.Time `json:"-"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (SesiPengguna) TableName() string { return "sesi_pengguna" }

type RefreshToken struct {
	TokenHash string     `json:"-" gorm:"primaryKey"`
	SesiID    string     `json:"-"`
	UsedAt    *time.Time `json:"-"`
	CreatedAt time.Time  `json:"-"`
}

func (RefreshToken) TableName() string { return "refresh_token_pengguna" }
