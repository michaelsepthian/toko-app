package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"toko/backend/internal/config"
	"toko/backend/internal/database"
	"toko/backend/internal/httpapi"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
	"toko/backend/test/testutil"
)

func TestUsersPostgresIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL belum diisi")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") || u.Path != "/toko_test" {
		t.Fatal("test hanya untuk PostgreSQL lokal toko_test")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	adminPool, _ := admin.DB()
	defer adminPool.Close()
	name := fmt.Sprintf("toko_test_users_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name + " WITH (FORCE)")
	u.Path = "/" + name
	db, err := database.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	schema, err := os.ReadFile(testutil.DatabasePath(t, "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(schema)).Error; err != nil {
		t.Fatal(err)
	}
	store := &repository.Store{DB: db}
	svc := &service.Service{JWTKey: testutil.JWTKey, Store: store}
	ownerSession, err := svc.RegisterInitialOwner(ctx, "owner", "password-test")
	if err != nil {
		t.Fatal(err)
	}
	handler := httpapi.New(config.Config{JWTKey: testutil.JWTKey, CORSOrigin: "http://localhost:3000"}, store)
	request := func(method, token, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1/pengguna?limit=100", strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s expected %d got %d: %s", method, status, res.Code, res.Body.String())
		}
		return res
	}
	request("GET", "", "", 401)
	for _, role := range []string{"KASIR", "PEMILIK"} {
		username := strings.ToLower(role)
		body := fmt.Sprintf(`{"nama":"  Tim Toko  ","username":"  %s  ","password":"password-test","peran":"%s"}`, strings.ToUpper(username), role)
		res := request("POST", ownerSession.AccessToken, body, 201)
		if strings.Contains(res.Body.String(), "password") {
			t.Fatal("password exposed")
		}
		var created struct {
			Data model.Pengguna `json:"data"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
			t.Fatal(err)
		}
		if created.Data.Nama != "Tim Toko" || created.Data.Username != username || created.Data.Peran != model.Role(role) || !created.Data.Aktif {
			t.Fatal("incorrect created user")
		}
		var stored model.Pengguna
		if err := db.First(&stored, created.Data.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.PasswordHash == nil || bcrypt.CompareHashAndPassword([]byte(*stored.PasswordHash), []byte("password-test")) != nil {
			t.Fatal("password was not hashed")
		}
		session, err := svc.Login(ctx, username, "password-test")
		if err != nil || session.User.Peran != model.Role(role) {
			t.Fatal("new user cannot login with selected role", err)
		}
		request("POST", ownerSession.AccessToken, body, 409)
		if role == "KASIR" {
			request("GET", session.AccessToken, "", 403)
			request("POST", session.AccessToken, body, 403)
		}
	}
	res := request("GET", ownerSession.AccessToken, "", 200)
	if strings.Contains(res.Body.String(), "password") {
		t.Fatal("password exposed in list")
	}
	var listed struct {
		Data []model.Pengguna `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &listed); err != nil || len(listed.Data) != 3 {
		t.Fatal("incorrect user list", err)
	}
}
