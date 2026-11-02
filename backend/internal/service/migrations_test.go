package service_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"gorm.io/gorm"
)

func applyIncomeDateMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	applyAuditMigration(t, db)
	_, file, _, _ := runtime.Caller(0)
	sql, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../database/migrations/20261101_tanggal_pendapatan.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(sql)).Error; err != nil {
		t.Fatal("income date migration", err)
	}
}

func applyAuditMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	sql, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../database/migrations/20261102_audit_pengguna.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(sql)).Error; err != nil {
		t.Fatal("audit migration", err)
	}
}
