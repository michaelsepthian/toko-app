package service_test

import (
	"context"
	"errors"
	"testing"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
	"toko/backend/internal/token"
	"toko/backend/test/testutil"
)

type sessionRepositoryStub struct {
	user   model.Pengguna
	err    error
	ctx    context.Context
	id     string
	userID int64
	calls  int
}

func (r *sessionRepositoryStub) UserBySession(ctx context.Context, id string, userID int64) (model.Pengguna, error) {
	r.ctx = ctx
	r.id = id
	r.userID = userID
	r.calls++
	return r.user, r.err
}
func TestSessionAuthenticationValidatesJWTAndPreservesContext(t *testing.T) {
	now := time.Now()
	access, _, err := token.Issue(testutil.JWTKey, 42, "session", now.Add(time.Hour), now)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := &sessionRepositoryStub{user: model.Pengguna{Nama: "Kasir", Peran: "KASIR", Aktif: true}}
	user, err := service.NewSessionService(store, testutil.JWTKey).AuthenticateSession(ctx, access)
	if err != nil || user.Nama != "Kasir" || store.id != "session" || store.userID != 42 || store.ctx != ctx {
		t.Fatal(user, err, store)
	}
	for _, dbErr := range []error{repository.ErrNotFound, errors.New("database unavailable")} {
		store.err = dbErr
		_, err := service.NewSessionService(store, testutil.JWTKey).AuthenticateSession(ctx, access)
		if dbErr == repository.ErrNotFound {
			var app *apperror.Error
			if !errors.As(err, &app) || app.Status != 401 {
				t.Fatal(err)
			}
		} else if !errors.Is(err, dbErr) {
			t.Fatal(err)
		}
	}
}
func TestExpiredJWTNeverReachesRepository(t *testing.T) {
	access, _, err := token.Issue(testutil.JWTKey, 42, "session", time.Now().Add(-time.Hour), time.Now().Add(-2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	store := &sessionRepositoryStub{}
	_, err = service.NewSessionService(store, testutil.JWTKey).AuthenticateSession(context.Background(), access)
	var app *apperror.Error
	if !errors.As(err, &app) || app.Code != "ACCESS_TOKEN_EXPIRED" || store.calls != 0 {
		t.Fatal(err, store.calls)
	}
}
