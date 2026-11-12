package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	"toko/backend/internal/config"
	"toko/backend/internal/database"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
	"toko/backend/internal/token"
	"toko/backend/test/testutil"
)

func isolatedAuthDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL belum diisi")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") || u.Path != "/toko_test" {
		t.Fatal("only localhost toko_test allowed")
	}
	admin, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("toko_test_refresh_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	db, err := database.Open(context.Background(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool, _ := db.DB()
		_ = pool.Close()
		if err := admin.Exec("DROP DATABASE " + name + " WITH (FORCE)").Error; err != nil {
			t.Error(err)
		}
		pool, _ = admin.DB()
		_ = pool.Close()
	})
	schema, err := os.ReadFile(testutil.DatabasePath(t, "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(schema)).Error; err != nil {
		t.Fatal(err)
	}
	return db
}
func TestJWTRefreshPostgres(t *testing.T) {
	db := isolatedAuthDatabase(t)
	ctx := context.Background()
	store := &repository.Store{DB: db}
	svc := &service.Service{Store: store, JWTKey: testutil.JWTKey}
	first, err := svc.RegisterInitialOwner(ctx, "refresh-owner", "password-test")
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Until(first.ExpiresAt); d > 30*time.Minute || d < 29*time.Minute {
		t.Fatal(d)
	}
	if d := time.Until(first.SessionExpiresAt); d > 17*time.Hour || d < 16*time.Hour+59*time.Minute {
		t.Fatal(d)
	}
	handler := httpapi.New(config.Config{JWTKey: testutil.JWTKey, CORSOrigin: "https://toko.test", SessionCookieSecure: true}, store)
	call := func(path, raw, access, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", path, strings.NewReader(body))
		req.Header.Set("Origin", "https://toko.test")
		if raw != "" {
			req.AddCookie(&http.Cookie{Name: "toko_refresh", Value: raw})
		}
		if access != "" {
			req.Header.Set("Authorization", "Bearer "+access)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res
	}
	me := func(access string) int {
		req := httptest.NewRequest("GET", "/api/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+access)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res.Code
	}
	if me(first.AccessToken) != 200 {
		t.Fatal("JWT rejected")
	}
	login := call("/api/v1/auth/login", "", "", `{"username":"refresh-owner","password":"password-test"}`)
	if login.Code != 200 {
		t.Fatal(login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/v1/auth" || cookie.Domain != "" || cookie.MaxAge > 17*3600 || cookie.MaxAge < 17*3600-5 {
		t.Fatal(cookie)
	}
	if strings.Contains(login.Body.String(), cookie.Value) || strings.Contains(login.Body.String(), "password_hash") {
		t.Fatal("secret exposed in JSON")
	}
	res := call("/api/v1/auth/refresh", cookie.Value, "", "")
	if res.Code != 200 {
		t.Fatal(res.Code, res.Body.String())
	}
	rotated := res.Result().Cookies()[0]
	if rotated.Value == cookie.Value {
		t.Fatal("refresh token was not rotated")
	}
	var payload struct {
		Data service.LoginResult `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if me(payload.Data.AccessToken) != 200 {
		t.Fatal("refreshed JWT rejected")
	}
	if res := call("/api/v1/auth/refresh", cookie.Value, "", ""); res.Code != 401 {
		t.Fatal("replay accepted", res.Code)
	}
	if me(payload.Data.AccessToken) != 401 {
		t.Fatal("replay did not revoke family")
	}
	if res := call("/api/v1/auth/refresh", rotated.Value, "", ""); res.Code != 401 {
		t.Fatal("revoked family refreshed")
	}
	t.Run("deadline and inactive account", func(t *testing.T) {
		for _, inactive := range []bool{false, true} {
			fresh, err := svc.Login(ctx, "refresh-owner", "password-test")
			if err != nil {
				t.Fatal(err)
			}
			claims, err := token.Parse(testutil.JWTKey, fresh.AccessToken)
			if err != nil {
				t.Fatal(err)
			}
			if inactive {
				db.Model(&model.Pengguna{}).Where("id = ?", first.User.ID).Update("aktif", false)
			} else {
				db.Model(&model.SesiPengguna{}).Where("id = ?", claims.SessionID).Update("expires_at", time.Now().Add(-time.Second))
			}
			if res := call("/api/v1/auth/refresh", fresh.RefreshToken, "", ""); res.Code != 401 {
				t.Fatal(res.Code, res.Body.String())
			}
			db.Model(&model.Pengguna{}).Where("id = ?", first.User.ID).Update("aktif", true)
		}
	})
	t.Run("logout accepts expired access and invalidates session", func(t *testing.T) {
		fresh, err := svc.Login(ctx, "refresh-owner", "password-test")
		if err != nil {
			t.Fatal(err)
		}
		res := call("/api/v1/auth/logout", fresh.RefreshToken, "expired.jwt.token", "")
		if res.Code != 200 || res.Result().Cookies()[0].MaxAge != -1 {
			t.Fatal(res.Code, res.Body.String())
		}
		if me(fresh.AccessToken) != 401 {
			t.Fatal("logout left JWT valid")
		}
		if res := call("/api/v1/auth/logout", fresh.RefreshToken, "", ""); res.Code != 200 {
			t.Fatal(res.Code)
		}
	})
	t.Run("parallel consumption detects replay atomically", func(t *testing.T) {
		fresh, err := svc.Login(ctx, "refresh-owner", "password-test")
		if err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		results := make(chan error, 2)
		start := make(chan struct{})
		for range 2 {
			wg.Add(1)
			go func() { defer wg.Done(); <-start; _, err := svc.Refresh(ctx, fresh.RefreshToken); results <- err }()
		}
		close(start)
		wg.Wait()
		close(results)
		ok, bad := 0, 0
		for err := range results {
			if err == nil {
				ok++
			} else {
				bad++
			}
		}
		if ok != 1 || bad != 1 || me(fresh.AccessToken) != 401 {
			t.Fatal(ok, bad, "replay must revoke the entire family")
		}
	})
	t.Run("absolute deadline is not extended", func(t *testing.T) {
		fresh, err := svc.Login(ctx, "refresh-owner", "password-test")
		if err != nil {
			t.Fatal(err)
		}
		claims, _ := token.Parse(testutil.JWTKey, fresh.AccessToken)
		deadline := time.Now().UTC().Add(5 * time.Minute).Truncate(time.Second)
		if err := db.Model(&model.SesiPengguna{}).Where("id = ?", claims.SessionID).Update("expires_at", deadline).Error; err != nil {
			t.Fatal(err)
		}
		refreshed, err := svc.Refresh(ctx, fresh.RefreshToken)
		if err != nil {
			t.Fatal(err)
		}
		if !refreshed.SessionExpiresAt.Equal(deadline) || !refreshed.ExpiresAt.Equal(deadline) {
			t.Fatal(refreshed.ExpiresAt, refreshed.SessionExpiresAt)
		}
	})
	var rows []model.RefreshToken
	if err := db.Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if len(row.TokenHash) != 64 || strings.Contains(row.TokenHash, "toko_refresh_") {
			t.Fatal("raw token stored")
		}
	}
}
func TestJWTMigrationPostgres(t *testing.T) {
	db := isolatedAuthDatabase(t)
	if err := db.Exec(`DROP TABLE public.refresh_token_pengguna; DROP TABLE public.sesi_pengguna;
 ALTER TABLE public.pengguna ADD COLUMN auth_user_id uuid;
 CREATE TABLE public.sesi_pengguna(token_hash text primary key,pengguna_id bigint REFERENCES public.pengguna(id),expires_at timestamptz,created_at timestamptz DEFAULT now());
 INSERT INTO public.pengguna(nama,username,password_hash) VALUES('Owner','owner','local-hash');
 INSERT INTO public.sesi_pengguna(token_hash,pengguna_id,expires_at) SELECT 'old-token',id,now()+interval '12 hours' FROM public.pengguna;`).Error; err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(testutil.DatabasePath(t, "migrations", "20261112_jwt_refresh.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := db.Exec(string(migration)).Error; err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	db.Model(&model.Pengguna{}).Count(&count)
	if count != 1 {
		t.Fatal("users lost")
	}
	db.Model(&model.SesiPengguna{}).Count(&count)
	if count != 0 {
		t.Fatal("old sessions survived")
	}
	var exists bool
	db.Raw("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pengguna' AND column_name='auth_user_id')").Scan(&exists)
	if exists {
		t.Fatal("obsolete identity column survived")
	}
	if err := db.Exec("INSERT INTO public.pengguna(nama,username) VALUES('Legacy','legacy')").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(migration)).Error; err == nil {
		t.Fatal("active account without local password was silently migrated")
	}
	// Failed explicit transaction must be rolled back before the connection is reused.
	db.Exec("ROLLBACK")
}
