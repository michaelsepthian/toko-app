package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/token"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,50}$`)
var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-user-password"), bcrypt.DefaultCost)

type LoginResult struct {
	User             model.Pengguna `json:"user"`
	AccessToken      string         `json:"access_token"`
	ExpiresAt        time.Time      `json:"expires_at"`
	SessionExpiresAt time.Time      `json:"session_expires_at"`
	RefreshToken     string         `json:"-"`
}

func (s *Service) SetupInitialized(ctx context.Context) (bool, error) {
	return s.Store.WithContext(ctx).UsersExist()
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
	err = s.Store.Transaction(ctx, func(tx *repository.Store) error {
		if err := tx.LockInitialRegistration(); err != nil {
			return err
		}
		exists, err := tx.UsersExist()
		if err != nil {
			return err
		}
		if exists {
			return apperror.Conflict("Registrasi awal sudah ditutup. Silakan masuk dengan akun yang tersedia")
		}
		// Nama untuk kompatibilitas tabel/struk diisi otomatis dari username.
		user := model.Pengguna{Nama: username, Username: username, PasswordHash: &encoded, Peran: "PEMILIK", Aktif: true}
		if err := tx.CreateUser(&user); err != nil {
			return err
		}
		output, err = createSession(tx, user, s.JWTKey)
		return err
	})
	return output, err
}

func (s *Service) Login(ctx context.Context, username, password string) (LoginResult, error) {
	var output LoginResult
	username = strings.ToLower(strings.TrimSpace(username))
	if !usernamePattern.MatchString(username) || len(password) == 0 || len(password) > 72 {
		return output, invalidCredentials()
	}
	user, err := s.Store.WithContext(ctx).UserByUsername(username)
	if repository.IsNotFound(err) {
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
		return output, invalidCredentials()
	}
	if err != nil {
		return output, err
	}
	if !user.Aktif {
		return output, invalidCredentials()
	}
	if user.PasswordHash == nil || bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)) != nil {
		return output, invalidCredentials()
	}

	err = s.Store.Transaction(ctx, func(tx *repository.Store) error {
		if err := tx.DeleteExpiredSessions(); err != nil {
			return err
		}
		var err error
		output, err = createSession(tx, user, s.JWTKey)
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
func createSession(tx *repository.Store, user model.Pengguna, key []byte) (LoginResult, error) {
	id, err := token.Random()
	if err != nil {
		return LoginResult{}, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	session := model.SesiPengguna{ID: id, PenggunaID: user.ID, ExpiresAt: now.Add(token.SessionTTL)}
	if err := tx.CreateSession(&session); err != nil {
		return LoginResult{}, err
	}
	return issueSessionTokens(tx, user, session, key, now)
}
func issueSessionTokens(tx *repository.Store, user model.Pengguna, session model.SesiPengguna, key []byte, now time.Time) (LoginResult, error) {
	access, expiry, err := token.Issue(key, user.ID, session.ID, session.ExpiresAt, now)
	if err != nil {
		return LoginResult{}, err
	}
	raw, err := token.Random()
	if err != nil {
		return LoginResult{}, err
	}
	refresh := "toko_refresh_" + raw
	if err := tx.CreateRefreshToken(&model.RefreshToken{TokenHash: SessionHash(refresh), SesiID: session.ID}); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{User: user, AccessToken: access, ExpiresAt: expiry, SessionExpiresAt: session.ExpiresAt, RefreshToken: refresh}, nil
}
