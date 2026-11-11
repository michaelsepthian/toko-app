package config

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func cleanEnvironment(t *testing.T) {
	t.Helper()
	t.Chdir(t.TempDir())
	for _, key := range []string{"DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "HTTP_ADDR", "CORS_ORIGIN", "ENV_FILE", "INITIAL_SETUP_TOKEN", "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSLMODE", "PRODUCT_CACHE_TTL_SECONDS"} {
		t.Setenv(key, "")
		if err := os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
	}
}

const sampleEnv = "DATABASE_URL='postgresql://test:test@localhost/toko_test'\nSUPABASE_URL=https://example.supabase.co/\nSUPABASE_ANON_KEY=public-test-key\n"

func TestProductCacheTTLConfiguration(t *testing.T) {
	cleanEnvironment(t)
	t.Setenv("DATABASE_URL", "postgresql://localhost/toko_test")
	cfg, err := Load()
	if err != nil || cfg.ProductCacheTTL != time.Hour {
		t.Fatal("default TTL must be one hour", cfg.ProductCacheTTL, err)
	}
	if err := os.WriteFile(".env", []byte("PRODUCT_CACHE_TTL_SECONDS=7200\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load()
	if err != nil || cfg.ProductCacheTTL != 2*time.Hour {
		t.Fatal("file TTL not loaded", cfg.ProductCacheTTL, err)
	}
	t.Setenv("PRODUCT_CACHE_TTL_SECONDS", "1800")
	cfg, err = Load()
	if err != nil || cfg.ProductCacheTTL != 30*time.Minute {
		t.Fatal("process TTL must override file", cfg.ProductCacheTTL, err)
	}
	t.Setenv("PRODUCT_CACHE_TTL_SECONDS", "")
	cfg, err = Load()
	if err != nil || cfg.ProductCacheTTL != time.Hour {
		t.Fatal("empty TTL must use default", cfg.ProductCacheTTL, err)
	}
	for _, value := range []string{"0", "-1", "1.5", "1h", "31536001", "999999999999999999999"} {
		t.Setenv("PRODUCT_CACHE_TTL_SECONDS", value)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "PRODUCT_CACHE_TTL_SECONDS") {
			t.Fatal("invalid TTL accepted", value, err)
		}
	}
}

func TestLoadLocalEnvAndPreserveProcessOverride(t *testing.T) {
	cleanEnvironment(t)
	if err := os.WriteFile(".env", []byte(sampleEnv), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SUPABASE_ANON_KEY", "hosting-test-key")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL == "" || cfg.SupabaseURL != "https://example.supabase.co" || cfg.SupabaseKey != "hosting-test-key" || cfg.HTTPAddr != "127.0.0.1:8080" {
		t.Fatal("configuration loading failed")
	}
	if _, exists := os.LookupEnv("DATABASE_URL"); exists {
		t.Fatal("loader modified process environment")
	}
}
func TestLoadFromWorkspaceRoot(t *testing.T) {
	cleanEnvironment(t)
	if err := os.Mkdir("backend", 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join("backend", ".env"), []byte(sampleEnv), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}
func TestLoadExplicitFileAndNoFileHosting(t *testing.T) {
	cleanEnvironment(t)
	if err := os.WriteFile("custom.env", []byte(sampleEnv), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENV_FILE", "custom.env")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENV_FILE", "")
	t.Setenv("DATABASE_URL", "postgresql://localhost/toko_test")
	t.Setenv("SUPABASE_URL", "https://example.supabase.co")
	t.Setenv("SUPABASE_ANON_KEY", "public-test-key")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}
func TestMissingDatabaseAndMalformedFileDoNotLeakSecrets(t *testing.T) {
	cleanEnvironment(t)
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatal("missing database accepted")
	}
	if err := os.WriteFile(".env", []byte("DATABASE_URL='secret-unclosed"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err = Load()
	if err == nil || strings.Contains(err.Error(), "secret-unclosed") {
		t.Fatal("parser error leaked file content")
	}
}
func TestOnlyDatabaseURLRequired(t *testing.T) {
	cleanEnvironment(t)
	t.Setenv("DATABASE_URL", "postgresql://localhost/toko_test")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadDatabaseComponentsAndURLOverride(t *testing.T) {
	cleanEnvironment(t)
	t.Setenv("DB_HOST", "postgres")
	t.Setenv("DB_NAME", "toko")
	t.Setenv("DB_USER", "toko_app")
	t.Setenv("DB_PASSWORD", "p@ss:$#/%word")
	t.Setenv("DB_SSLMODE", "disable")
	t.Setenv("HTTP_ADDR", "0.0.0.0:8080")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	dsn, err := url.Parse(cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	password, _ := dsn.User.Password()
	if dsn.Host != "postgres:5432" || password != "p@ss:$#/%word" || dsn.User.Username() != "toko_app" || dsn.Path != "/toko" || dsn.Query().Get("sslmode") != "disable" || cfg.HTTPAddr != "0.0.0.0:8080" {
		t.Fatal("database components were not preserved")
	}
	t.Setenv("DATABASE_URL", "postgresql://override/toko")
	cfg, err = Load()
	if err != nil || cfg.DatabaseURL != "postgresql://override/toko" {
		t.Fatal("DATABASE_URL must take precedence")
	}
}

func TestLoadInvalidDatabaseComponents(t *testing.T) {
	cleanEnvironment(t)
	t.Setenv("DB_HOST", "postgres")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "DB_NAME") {
		t.Fatal("missing database name accepted")
	}
	t.Setenv("DB_NAME", "toko")
	t.Setenv("DB_USER", "toko_app")
	t.Setenv("DB_PASSWORD", "secret-do-not-log")
	t.Setenv("DB_PORT", "secret-do-not-log")
	if _, err := Load(); err == nil || strings.Contains(err.Error(), "secret-do-not-log") {
		t.Fatal("invalid port accepted or secret leaked")
	}
}
