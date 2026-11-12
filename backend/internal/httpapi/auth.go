package httpapi

import (
	"context"
	"net/http"
	"strings"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/service"
)

type userKey struct{}
type Auth struct{ sessions *service.SessionService }

func NewAuth(key []byte, store *repository.Store) *Auth {
	return &Auth{sessions: service.NewSessionService(store, key)}
}
func currentUser(r *http.Request) model.Pengguna {
	return r.Context().Value(userKey{}).(model.Pengguna)
}
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			fail(w, &apperror.Error{Status: 401, Code: "SESSION_INVALID", Message: "Bearer token diperlukan"})
			return
		}
		user, err := a.sessions.AuthenticateSession(r.Context(), parts[1])
		if err != nil {
			fail(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
	})
}
func owner(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if currentUser(r).Peran != model.RoleOwner {
			fail(w, apperror.Forbidden())
			return
		}
		next(w, r)
	}
}
