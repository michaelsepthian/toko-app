package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
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
)

func TestUsernamePasswordRegistration(t *testing.T) {
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
	dbName := fmt.Sprintf("toko_test_auth_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + dbName).Error; err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + dbName
	db, err := database.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	t.Cleanup(func() {
		_ = pool.Close()
		if err := admin.Exec("DROP DATABASE " + dbName + " WITH (FORCE)").Error; err != nil {
			t.Error(err)
		}
		_ = adminPool.Close()
	})
	_, file, _, _ := runtime.Caller(0)
	schema, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../supabase/schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(schema)).Error; err != nil {
		t.Fatal(err)
	}
	handler := httpapi.New(config.Config{}, &repository.Store{DB: db})
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res
	}
	credentials := func(username, password string) string {
		data, _ := json.Marshal(map[string]string{"username": username, "password": password})
		return string(data)
	}
	if res := request("GET", "/api/v1/setup", "", ""); res.Code != 200 || !strings.Contains(res.Body.String(), `"registration_open":true`) {
		t.Fatal(res.Code, res.Body.String())
	}
	if res := request("POST", "/api/v1/auth/register", "", credentials("owner", "short")); res.Code != 400 {
		t.Fatal("weak password accepted", res.Code)
	}
	if res := request("POST", "/api/v1/auth/register", "", `{"username":"owner","password":"password-test","peran":"PEMILIK"}`); res.Code != 400 {
		t.Fatal("role accepted from client", res.Code)
	}
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for _, username := range []string{"owner1", "owner2"} {
		wg.Add(1)
		go func(username string) {
			defer wg.Done()
			<-start
			results <- request("POST", "/api/v1/auth/register", "", credentials(username, "password-test"))
		}(username)
	}
	close(start)
	wg.Wait()
	close(results)
	var winner service.LoginResult
	success, denied := 0, 0
	for res := range results {
		if res.Code == 201 {
			success++
			var payload struct {
				Data service.LoginResult `json:"data"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			winner = payload.Data
			if strings.Contains(res.Body.String(), "password_hash") || strings.Contains(res.Body.String(), "password-test") {
				t.Fatal("password leaked")
			}
		} else if res.Code == 409 {
			denied++
		} else {
			t.Fatal(res.Code, res.Body.String())
		}
	}
	if success != 1 || denied != 1 || winner.User.Peran != "PEMILIK" || winner.User.Nama != winner.User.Username {
		t.Fatal("invalid initial registration")
	}
	var user model.Pengguna
	if err := db.First(&user, winner.User.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.PasswordHash == nil || *user.PasswordHash == "password-test" || !strings.HasPrefix(*user.PasswordHash, "$2") {
		t.Fatal("password not hashed")
	}
	if res := request("GET", "/api/v1/me", winner.AccessToken, ""); res.Code != 200 {
		t.Fatal("session invalid", res.Body.String())
	}

	t.Run("payment checkbox updates preserve false values and allow hiding both menus", func(t *testing.T) {
		input := map[string]any{"nama": "Hidden payment", "jenis": "LAINNYA", "tarif_persen": "0", "tarif_tetap": "0", "penanggung_biaya": "TOKO", "untuk_penjualan": false, "untuk_pembelian": false, "aktif": true}
		body, _ := json.Marshal(input)
		res := request("POST", "/api/v1/metode-pembayaran", winner.AccessToken, string(body))
		if res.Code != 201 {
			t.Fatal("hidden payment rejected", res.Code, res.Body.String())
		}
		var result struct {
			Data model.MetodePembayaran `json:"data"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		path := fmt.Sprintf("/api/v1/metode-pembayaran/%d", result.Data.ID)
		for _, flags := range [][3]bool{{true, true, true}, {false, true, true}, {false, false, true}, {false, false, false}} {
			input["untuk_penjualan"], input["untuk_pembelian"], input["aktif"] = flags[0], flags[1], flags[2]
			body, _ = json.Marshal(input)
			res = request("PUT", path, winner.AccessToken, string(body))
			if res.Code != 200 {
				t.Fatal("checkbox update rejected", res.Code, res.Body.String())
			}
			var stored model.MetodePembayaran
			if err := db.First(&stored, result.Data.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.UntukPenjualan != flags[0] || stored.UntukPembelian != flags[1] || stored.Aktif != flags[2] {
				t.Fatal("false checkbox value lost")
			}
		}
	})
	if res := request("GET", "/api/v1/setup", "", ""); !strings.Contains(res.Body.String(), `"registration_open":false`) {
		t.Fatal("registration stayed open")
	}
	if res := request("POST", "/api/v1/auth/login", "", credentials(user.Username, "wrong-password")); res.Code != 401 {
		t.Fatal("wrong password accepted")
	}
	res := request("POST", "/api/v1/auth/login", "", credentials(strings.ToUpper(user.Username), "password-test"))
	if res.Code != 200 {
		t.Fatal("login failed", res.Body.String())
	}
	var login struct {
		Data service.LoginResult `json:"data"`
	}
	_ = json.Unmarshal(res.Body.Bytes(), &login)
	if res := request("POST", "/api/v1/auth/logout", login.Data.AccessToken, ""); res.Code != 200 {
		t.Fatal("logout failed")
	}
	if res := request("GET", "/api/v1/me", login.Data.AccessToken, ""); res.Code != 401 {
		t.Fatal("revoked token accepted")
	}
	if err := db.Model(&model.SesiPengguna{}).Where("token_hash = ?", service.SessionHash(winner.AccessToken)).Update("expires_at", time.Now().Add(-time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if res := request("GET", "/api/v1/me", winner.AccessToken, ""); res.Code != 401 {
		t.Fatal("expired token accepted")
	}
	if err := db.Model(&user).Update("aktif", false).Error; err != nil {
		t.Fatal(err)
	}
	if res := request("GET", "/api/v1/setup", "", ""); !strings.Contains(res.Body.String(), `"registration_open":false`) {
		t.Fatal("deactivation reopened registration")
	}
}
