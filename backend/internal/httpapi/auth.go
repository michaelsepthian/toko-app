package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

type userKey struct{}
type Identity struct {
	ID               string  `json:"id"`
	Email            string  `json:"email"`
	EmailConfirmedAt *string `json:"email_confirmed_at"`
	IsAnonymous      bool    `json:"is_anonymous"`
}
type Auth struct {
	URL, Key string
	Client   *http.Client
	Store    *repository.Store
}

func NewAuth(url, key string, store *repository.Store) *Auth {
	return &Auth{URL: url, Key: key, Store: store, Client: &http.Client{Timeout: 5 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
}
func currentUser(r *http.Request) model.Pengguna {
	return r.Context().Value(userKey{}).(model.Pengguna)
}

// VerifyIdentity juga dapat dipakai sebelum profil pengguna toko tersedia.
func (a *Auth) VerifyIdentity(r *http.Request) (Identity, error) {
	var identity Identity
	if a.URL == "" || a.Key == "" {
		return identity, &apperror.Error{Status: 401, Message: "Sesi tidak valid. Silakan masuk kembali"}
	}
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return identity, &apperror.Error{Status: 401, Message: "Bearer token diperlukan"}
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.URL+"/auth/v1/user", nil)
	if err != nil {
		return identity, err
	}
	req.Header.Set("Authorization", "Bearer "+parts[1])
	req.Header.Set("apikey", a.Key)
	res, err := a.Client.Do(req)
	if err != nil {
		return identity, &apperror.Error{Status: 503, Message: "Layanan autentikasi tidak tersedia"}
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return identity, &apperror.Error{Status: 401, Message: "Token tidak valid atau kedaluwarsa"}
	}
	if res.StatusCode != http.StatusOK {
		return identity, &apperror.Error{Status: 503, Message: "Layanan autentikasi tidak tersedia"}
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&identity); err != nil || identity.ID == "" {
		return Identity{}, &apperror.Error{Status: 503, Message: "Respons autentikasi tidak valid"}
	}
	return identity, nil
}

// Memverifikasi sesi lokal; token Supabase lama tetap didukung selama migrasi.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") && strings.HasPrefix(parts[1], "toko_") {
			var user model.Pengguna
			err := a.Store.DB.WithContext(r.Context()).Table("public.pengguna AS p").Select("p.*").Joins("JOIN public.sesi_pengguna s ON s.pengguna_id = p.id").Where("s.token_hash = ? AND s.expires_at > now() AND p.aktif = true", service.SessionHash(parts[1])).Take(&user).Error
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					fail(w, &apperror.Error{Status: 401, Message: "Sesi berakhir. Silakan masuk kembali"})
				} else {
					fail(w, err)
				}
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
			return
		}
		identity, err := a.VerifyIdentity(r)
		if err != nil {
			fail(w, err)
			return
		}
		user, err := a.Store.UserByAuthID(r.Context(), identity.ID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				fail(w, apperror.Forbidden())
			} else {
				fail(w, err)
			}
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
	})
}

// Kompatibilitas akun yang terlanjur dibuat melalui Supabase Auth.
// Email dicari oleh server; pengguna tetap mengisi username dan password saja.
func (a *Auth) VerifyLegacyPassword(ctx context.Context, authID, password string) error {
	invalid := &apperror.Error{Status: 401, Message: "Username atau password salah"}
	if a.URL == "" || a.Key == "" {
		return invalid
	}
	var account struct{ Email string }
	if err := a.Store.DB.WithContext(ctx).Table("auth.users").Select("email").Where("id = ?", authID).Take(&account).Error; err != nil {
		return invalid
	}
	body, err := json.Marshal(map[string]string{"email": account.Email, "password": password})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.URL+"/auth/v1/token?grant_type=password", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", a.Key)
	req.Header.Set("Content-Type", "application/json")
	res, err := a.Client.Do(req)
	if err != nil {
		return &apperror.Error{Status: 503, Message: "Akun lama belum dapat diverifikasi. Coba lagi"}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return invalid
	}
	var result struct {
		AccessToken string   `json:"access_token"`
		User        Identity `json:"user"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&result); err != nil || result.AccessToken == "" || result.User.ID != authID {
		return invalid
	}
	return nil
}
func owner(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if currentUser(r).Peran != "PEMILIK" {
			fail(w, apperror.Forbidden())
			return
		}
		next(w, r)
	}
}
