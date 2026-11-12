package token

import (
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"strings"
	"testing"
	"time"
)

var testKey = []byte("0123456789abcdef0123456789abcdef")

func TestAccessTTLAndAbsoluteDeadline(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	for _, remaining := range []time.Duration{17 * time.Hour, 5 * time.Minute} {
		raw, expiry, err := Issue(testKey, 42, "session", now.Add(remaining), now)
		if err != nil {
			t.Fatal(err)
		}
		expected := now.Add(AccessTTL)
		if remaining < AccessTTL {
			expected = now.Add(remaining)
		}
		if !expiry.Equal(expected) {
			t.Fatal(expiry, expected)
		}
		claims, err := Parse(testKey, raw)
		if err != nil || claims.Subject != "42" || claims.SessionID != "session" {
			t.Fatal(claims, err)
		}
	}
}
func TestAccessRejectsInvalidClaimsAndSignatures(t *testing.T) {
	now := time.Now().UTC()
	base := Claims{SessionID: "session", RegisteredClaims: jwt.RegisteredClaims{Issuer: Issuer, Audience: jwt.ClaimStrings{Audience}, Subject: "42", ID: "unique", IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute))}}
	cases := []struct {
		name   string
		change func(*Claims)
		method jwt.SigningMethod
		key    []byte
	}{
		{"wrong signature", func(*Claims) {}, jwt.SigningMethodHS256, []byte(strings.Repeat("x", 32))},
		{"wrong algorithm", func(*Claims) {}, jwt.SigningMethodHS384, testKey},
		{"missing expiry", func(c *Claims) { c.ExpiresAt = nil }, jwt.SigningMethodHS256, testKey},
		{"missing issued at", func(c *Claims) { c.IssuedAt = nil }, jwt.SigningMethodHS256, testKey},
		{"wrong issuer", func(c *Claims) { c.Issuer = "other" }, jwt.SigningMethodHS256, testKey},
		{"wrong audience", func(c *Claims) { c.Audience = jwt.ClaimStrings{"other"} }, jwt.SigningMethodHS256, testKey},
		{"missing subject", func(c *Claims) { c.Subject = "" }, jwt.SigningMethodHS256, testKey},
		{"missing session", func(c *Claims) { c.SessionID = "" }, jwt.SigningMethodHS256, testKey},
		{"missing jti", func(c *Claims) { c.ID = "" }, jwt.SigningMethodHS256, testKey},
		{"future issued at", func(c *Claims) { c.IssuedAt = jwt.NewNumericDate(now.Add(time.Hour)) }, jwt.SigningMethodHS256, testKey},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			claims := base
			tc.change(&claims)
			raw, err := jwt.NewWithClaims(tc.method, claims).SignedString(tc.key)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Parse(testKey, raw); err == nil {
				t.Fatal("accepted invalid token")
			}
		})
	}
	raw, _, err := Issue(testKey, 42, "session", now.Add(-time.Minute), now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Parse(testKey, raw); !errors.Is(err, ErrExpired) {
		t.Fatal(err)
	}
	if _, err := Parse(testKey, "toko_old_token"); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}
