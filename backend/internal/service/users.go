package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
)

type CreateUserInput struct {
	Nama     string `json:"nama"`
	Username string `json:"username"`
	Password string `json:"password"`
	Peran    string `json:"peran"`
}

func (s *Service) CreateUser(ctx context.Context, in CreateUserInput) (model.Pengguna, error) {
	var user model.Pengguna
	in.Nama = strings.TrimSpace(in.Nama)
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if in.Nama == "" || utf8.RuneCountInString(in.Nama) > 100 {
		return user, apperror.Invalid("Nama wajib diisi, maksimal 100 karakter")
	}
	if !usernamePattern.MatchString(in.Username) {
		return user, apperror.Invalid("Username 3–50 huruf, angka, titik, garis bawah, atau tanda hubung")
	}
	if len(in.Password) < 8 || len(in.Password) > 72 {
		return user, apperror.Invalid("Password harus 8–72 byte")
	}
	if in.Peran != "PEMILIK" && in.Peran != "KASIR" {
		return user, apperror.Invalid("Role harus Pemilik atau Kasir")
	}
	db := s.Store.DB.WithContext(ctx)
	// Login ignores username casing, including for legacy accounts.
	var count int64
	if err := db.Model(&user).Where("lower(username) = ?", in.Username).Count(&count).Error; err != nil {
		return user, err
	}
	if count != 0 {
		return user, apperror.Conflict("Username sudah digunakan")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return user, err
	}
	encoded := string(hash)
	user = model.Pengguna{Nama: in.Nama, Username: in.Username, PasswordHash: &encoded, Peran: in.Peran, Aktif: true}
	err = db.Create(&user).Error
	var state interface{ SQLState() string }
	if errors.As(err, &state) && state.SQLState() == "23505" {
		return model.Pengguna{}, apperror.Conflict("Username sudah digunakan")
	}
	return user, err
}
