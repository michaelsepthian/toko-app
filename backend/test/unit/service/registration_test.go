package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

func TestRegistrationRejectsInvalidCredentialsBeforeDatabase(t *testing.T) {
	svc := &service.Service{}
	for _, input := range []struct{ username, password string }{
		{"a", "password-test"}, {"bad username", "password-test"}, {"owner", "short"}, {"owner", strings.Repeat("x", 73)},
	} {
		if _, err := svc.RegisterInitialOwner(context.Background(), input.username, input.password); err == nil {
			t.Fatal("invalid registration accepted")
		}
	}
}
func TestPasswordHashNeverIncludedInUserJSON(t *testing.T) {
	hash := "$2a$not-a-real-hash"
	encoded, err := json.Marshal(model.Pengguna{Username: "owner", PasswordHash: &hash})
	if err != nil || strings.Contains(string(encoded), hash) || strings.Contains(string(encoded), "password_hash") {
		t.Fatal("password hash exposed in response")
	}
}
