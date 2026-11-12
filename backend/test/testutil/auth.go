package testutil

import (
	"gorm.io/gorm"
	"testing"
	"time"
	"toko/backend/internal/model"
	"toko/backend/internal/token"
)

var JWTKey = []byte("test-only-0123456789abcdef01234567")

func AccessToken(t testing.TB, db *gorm.DB, userID int64) string {
	t.Helper()
	sid, err := token.Random()
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(token.SessionTTL)
	if err := db.Create(&model.SesiPengguna{ID: sid, PenggunaID: userID, ExpiresAt: deadline}).Error; err != nil {
		t.Fatal(err)
	}
	access, _, err := token.Issue(JWTKey, userID, sid, deadline, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return access
}
