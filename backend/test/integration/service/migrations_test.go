package service_test

import (
	"os"
	"testing"

	"gorm.io/gorm"
	"toko/backend/test/testutil"
)

func applyIncomeDateMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	applyAuditMigration(t, db)
	sql, err := os.ReadFile(testutil.DatabasePath(t, "migrations", "20261101_tanggal_pendapatan.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(sql)).Error; err != nil {
		t.Fatal("income date migration", err)
	}
}

func applyAuditMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	sql, err := os.ReadFile(testutil.DatabasePath(t, "migrations", "20261102_audit_pengguna.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(sql)).Error; err != nil {
		t.Fatal("audit migration", err)
	}
}
