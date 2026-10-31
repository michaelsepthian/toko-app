package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,50}$`)
var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-user-password"), bcrypt.DefaultCost)

type LoginResult struct {
	User        model.Pengguna `json:"user"`
	AccessToken string         `json:"access_token"`
	ExpiresAt   time.Time      `json:"expires_at"`
}

func (s *Service) SetupInitialized(ctx context.Context) (bool, error) {
	var exists bool
	err := s.Store.DB.WithContext(ctx).Raw("SELECT EXISTS (SELECT 1 FROM public.pengguna)").Scan(&exists).Error
	return exists, err
}

func (s *Service) RegisterInitialOwner(ctx context.Context, username, password string) (LoginResult, error) {
	var output LoginResult
	username = strings.ToLower(strings.TrimSpace(username))
	if !usernamePattern.MatchString(username) {
		return output, apperror.Invalid("Username 3–50 huruf, angka, titik, garis bawah, atau tanda hubung")
	}
	if len(password) < 8 || len(password) > 72 {
		return output, apperror.Invalid("Password harus 8–72 byte")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return output, err
	}
	encoded := string(hash)
	err = s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(726519031)").Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.Pengguna{}).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return apperror.Conflict("Registrasi awal sudah ditutup. Silakan masuk dengan akun yang tersedia")
		}
		// Nama untuk kompatibilitas tabel/struk diisi otomatis dari username.
		user := model.Pengguna{Nama: username, Username: username, PasswordHash: &encoded, Peran: "PEMILIK", Aktif: true}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		var err error
		output, err = createSession(tx, user)
		return err
	})
	return output, err
}

// legacyCheck hanya untuk akun lama yang sudah terhubung ke Supabase Auth.
// Akun baru tidak memakai email atau panggilan Supabase Auth.
func (s *Service) Login(ctx context.Context, username, password string, legacyCheck func(context.Context, string, string) error) (LoginResult, error) {
	var output LoginResult
	username = strings.ToLower(strings.TrimSpace(username))
	if !usernamePattern.MatchString(username) || len(password) == 0 || len(password) > 72 {
		return output, invalidCredentials()
	}
	var user model.Pengguna
	err := s.Store.DB.WithContext(ctx).Where("lower(username) = ?", username).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
		return output, invalidCredentials()
	}
	if err != nil {
		return output, err
	}
	if !user.Aktif {
		return output, invalidCredentials()
	}
	if user.PasswordHash != nil {
		if bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)) != nil {
			return output, invalidCredentials()
		}
	} else {
		if user.AuthUserID == nil || legacyCheck == nil {
			return output, invalidCredentials()
		}
		if err := legacyCheck(ctx, *user.AuthUserID, password); err != nil {
			return output, err
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return output, err
		}
		encoded := string(hash)
		if err := s.Store.DB.WithContext(ctx).Model(&user).Where("password_hash IS NULL").Update("password_hash", encoded).Error; err != nil {
			return output, err
		}
	}
	err = s.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM public.sesi_pengguna WHERE expires_at <= now()").Error; err != nil {
			return err
		}
		var err error
		output, err = createSession(tx, user)
		return err
	})
	return output, err
}

func invalidCredentials() error {
	return &apperror.Error{Status: 401, Message: "Username atau password salah"}
}

func SessionHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func createSession(tx *gorm.DB, user model.Pengguna) (LoginResult, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return LoginResult{}, err
	}
	token := "toko_" + hex.EncodeToString(bytes[:])
	expires := time.Now().UTC().Add(12 * time.Hour)
	session := model.SesiPengguna{TokenHash: SessionHash(token), PenggunaID: user.ID, ExpiresAt: expires}
	if err := tx.Create(&session).Error; err != nil {
		return LoginResult{}, err
	}
	return LoginResult{User: user, AccessToken: token, ExpiresAt: expires}, nil
}
