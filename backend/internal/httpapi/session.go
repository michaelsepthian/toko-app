package httpapi

import (
	"net/http"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/config"
	"toko/backend/internal/dto"
	"toko/backend/internal/service"
)

const refreshCookieName = "toko_refresh"

func setRefreshCookie(w http.ResponseWriter, value string, expiry time.Time, secure bool) {
	maxAge := int(time.Until(expiry).Seconds())
	if value == "" {
		maxAge = -1
		expiry = time.Unix(1, 0)
	}
	http.SetCookie(w, &http.Cookie{Name: refreshCookieName, Value: value, Path: "/api/v1/auth", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expiry, MaxAge: maxAge})
}
func cookieOrigin(next http.HandlerFunc, c config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if c.CORSOrigin == "" || r.Header.Get("Origin") != c.CORSOrigin {
			fail(w, apperror.Forbidden())
			return
		}
		next(w, r)
	}
}
func registerSession(api, root *http.ServeMux, svc *service.Service, c config.Config) {
	root.HandleFunc("POST /api/v1/auth/refresh", cookieOrigin(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(refreshCookieName)
		if err != nil || cookie.Value == "" {
			setRefreshCookie(w, "", time.Time{}, c.SessionCookieSecure)
			fail(w, &apperror.Error{Status: 401, Code: "SESSION_INVALID", Message: "Sesi berakhir. Silakan masuk kembali"})
			return
		}
		result, err := svc.Refresh(r.Context(), cookie.Value)
		if err != nil {
			// Database/network failures must not remove a usable refresh cookie.
			if app, ok := err.(*apperror.Error); ok && app.Status == 401 {
				setRefreshCookie(w, "", time.Time{}, c.SessionCookieSecure)
			}
			fail(w, err)
			return
		}
		setRefreshCookie(w, result.RefreshToken, result.SessionExpiresAt, c.SessionCookieSecure)
		respond(w, 200, dto.Login(result))
	}, c))
	root.HandleFunc("POST /api/v1/auth/logout", cookieOrigin(func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie(refreshCookieName); err == nil {
			if err := svc.Logout(r.Context(), cookie.Value); err != nil {
				fail(w, err)
				return
			}
		}
		setRefreshCookie(w, "", time.Time{}, c.SessionCookieSecure)
		respond(w, 200, map[string]bool{"logged_out": true})
	}, c))
	api.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, dto.User(currentUser(r))) })
}
