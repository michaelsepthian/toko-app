// Package config membaca konfigurasi proses. Rahasia tidak disimpan di source code.
package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const DefaultProductCacheTTL = time.Hour

type Config struct {
	DatabaseURL, SupabaseURL, SupabaseKey, HTTPAddr, CORSOrigin string
	ProductCacheTTL                                             time.Duration
}

func Load() (Config, error) {
	values, err := readEnvFile()
	if err != nil {
		return Config{}, err
	}
	// Environment dari hosting/shell lebih diutamakan daripada file lokal.
	// Read dipakai agar konfigurasi tidak mengubah environment proses secara global.
	get := func(key string) string {
		if value, exists := os.LookupEnv(key); exists {
			return strings.TrimSpace(value)
		}
		return strings.TrimSpace(values[key])
	}
	c := Config{
		DatabaseURL: get("DATABASE_URL"), SupabaseURL: strings.TrimRight(get("SUPABASE_URL"), "/"),
		SupabaseKey: get("SUPABASE_ANON_KEY"), HTTPAddr: get("HTTP_ADDR"), CORSOrigin: get("CORS_ORIGIN"),
		ProductCacheTTL: DefaultProductCacheTTL,
	}
	if value := get("PRODUCT_CACHE_TTL_SECONDS"); value != "" {
		seconds, err := strconv.ParseInt(value, 10, 64)
		if err != nil || seconds < 1 || seconds > 31536000 {
			return Config{}, fmt.Errorf("PRODUCT_CACHE_TTL_SECONDS harus bilangan bulat 1–31536000")
		}
		c.ProductCacheTTL = time.Duration(seconds) * time.Second
	}
	// Compose memakai field terpisah agar password tidak perlu di-URL-encode manual.
	if c.DatabaseURL == "" && get("DB_HOST") != "" {
		for _, key := range []string{"DB_NAME", "DB_USER", "DB_PASSWORD"} {
			if get(key) == "" {
				return Config{}, fmt.Errorf("%s wajib diisi saat memakai DB_HOST", key)
			}
		}
		port := get("DB_PORT")
		if port == "" {
			port = "5432"
		}
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return Config{}, fmt.Errorf("DB_PORT harus berupa port 1–65535")
		}
		sslMode := get("DB_SSLMODE")
		if sslMode == "" {
			sslMode = "require"
		}
		dsn := url.URL{Scheme: "postgresql", Host: net.JoinHostPort(get("DB_HOST"), port),
			User: url.UserPassword(get("DB_USER"), get("DB_PASSWORD")), Path: "/" + get("DB_NAME")}
		dsn.RawQuery = url.Values{"sslmode": {sslMode}}.Encode()
		c.DatabaseURL = dsn.String()
	}
	if c.HTTPAddr == "" {
		c.HTTPAddr = "127.0.0.1:8080"
	}
	var missing []string
	for _, key := range []string{"DATABASE_URL"} {
		if c.DatabaseURL == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("environment belum diisi: %s; periksa backend/.env atau environment proses", strings.Join(missing, ", "))
	}
	u, err := url.Parse(c.SupabaseURL)
	if c.SupabaseURL != "" && (err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http")) {
		return Config{}, fmt.Errorf("SUPABASE_URL tidak valid")
	}
	return c, nil
}

func readEnvFile() (map[string]string, error) {
	path := strings.TrimSpace(os.Getenv("ENV_FILE"))
	paths := []string{".env", "backend/.env"}
	if path != "" {
		paths = []string{path}
	}
	for _, candidate := range paths {
		values, err := godotenv.Read(candidate)
		if err == nil {
			return values, nil
		}
		if os.IsNotExist(err) && path == "" {
			continue
		}
		// Error parser dapat memuat isi baris. Jangan teruskan kredensial ke log.
		return nil, fmt.Errorf("file konfigurasi .env tidak dapat dibaca; periksa lokasi ENV_FILE, izin, dan format KEY=value")
	}
	return nil, nil // Hosting dapat menyediakan seluruh environment tanpa file.
}
