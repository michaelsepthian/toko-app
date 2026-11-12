// Package token signs and validates local access JWTs. It never stores credentials.
package token

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"strconv"
	"time"
)

const AccessTTL = 30 * time.Minute
const SessionTTL = 17 * time.Hour
const Issuer = "toko-api"
const Audience = "toko-frontend"

var ErrExpired = errors.New("access token expired")
var ErrInvalid = errors.New("invalid access token")

type Claims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

func Random() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
func Issue(key []byte, userID int64, sessionID string, deadline, timeNow time.Time) (string, time.Time, error) {
	if len(key) < 32 {
		return "", time.Time{}, fmt.Errorf("JWT signing key must contain at least 32 bytes")
	}
	expiry := timeNow.Add(AccessTTL)
	if deadline.Before(expiry) {
		expiry = deadline
	}
	expiry = expiry.Truncate(time.Second)
	id, err := Random()
	if err != nil {
		return "", expiry, err
	}
	claims := Claims{SessionID: sessionID, RegisteredClaims: jwt.RegisteredClaims{
		Issuer: Issuer, Subject: strconv.FormatInt(userID, 10), Audience: jwt.ClaimStrings{Audience}, ID: id,
		IssuedAt: jwt.NewNumericDate(timeNow), ExpiresAt: jwt.NewNumericDate(expiry),
	}}
	value, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(key)
	return value, expiry, err
}
func Parse(key []byte, value string) (Claims, error) {
	var claims Claims
	if len(key) < 32 {
		return claims, ErrInvalid
	}
	// Verify the signature first. Distinguish pure expiry from malformed claims.
	_, err := jwt.ParseWithClaims(value, &claims, func(t *jwt.Token) (any, error) { return key, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithoutClaimsValidation())
	if err != nil {
		return claims, ErrInvalid
	}
	id, e := strconv.ParseInt(claims.Subject, 10, 64)
	if e != nil || id <= 0 || claims.SessionID == "" || claims.ID == "" || claims.IssuedAt == nil {
		return claims, ErrInvalid
	}
	validator := jwt.NewValidator(jwt.WithIssuer(Issuer), jwt.WithAudience(Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	err = validator.Validate(&claims)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) && !errors.Is(err, jwt.ErrTokenInvalidIssuer) && !errors.Is(err, jwt.ErrTokenInvalidAudience) && !errors.Is(err, jwt.ErrTokenUsedBeforeIssued) && !errors.Is(err, jwt.ErrTokenNotValidYet) && !errors.Is(err, jwt.ErrTokenRequiredClaimMissing) {
			return claims, ErrExpired
		}
		return claims, ErrInvalid
	}
	return claims, nil
}
