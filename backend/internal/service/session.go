package service

import (
	"context"
	"errors"
	"strconv"
	"time"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
	"toko/backend/internal/token"
)

type sessionRepository interface {
	UserBySession(context.Context, string, int64) (model.Pengguna, error)
}
type SessionService struct {
	repository sessionRepository
	key        []byte
}

func NewSessionService(store sessionRepository, key []byte) *SessionService {
	return &SessionService{repository: store, key: key}
}
func invalidSession() error {
	return &apperror.Error{Status: 401, Code: "SESSION_INVALID", Message: "Sesi berakhir. Silakan masuk kembali"}
}
func (s *SessionService) AuthenticateSession(ctx context.Context, access string) (model.Pengguna, error) {
	claims, err := token.Parse(s.key, access)
	if errors.Is(err, token.ErrExpired) {
		return model.Pengguna{}, &apperror.Error{Status: 401, Code: "ACCESS_TOKEN_EXPIRED", Message: "Access token kedaluwarsa"}
	}
	if err != nil {
		return model.Pengguna{}, invalidSession()
	}
	id, _ := strconv.ParseInt(claims.Subject, 10, 64)
	user, err := s.repository.UserBySession(ctx, claims.SessionID, id)
	if repository.IsNotFound(err) {
		return model.Pengguna{}, invalidSession()
	}
	return user, err
}
func (s *Service) Refresh(ctx context.Context, raw string) (LoginResult, error) {
	var output LoginResult
	rejected := false
	err := s.Store.Transaction(ctx, func(tx *repository.Store) error {
		row, err := tx.RefreshToken(SessionHash(raw))
		if err != nil {
			return err
		}
		session, err := tx.LockSession(row.SesiID)
		if err != nil {
			return err
		}
		// Re-read under the session lock: concurrent rotation/logout uses the same lock.
		row, err = tx.RefreshToken(SessionHash(raw))
		if err != nil {
			return err
		}
		if session.RevokedAt != nil || !session.ExpiresAt.After(time.Now()) {
			rejected = true
			return nil
		}
		if row.UsedAt != nil {
			rejected = true
			return tx.RevokeSession(session.ID)
		}
		user, err := tx.UserBySession(ctx, session.ID, session.PenggunaID)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := tx.ConsumeRefreshToken(row.TokenHash, now); err != nil {
			return err
		}
		output, err = issueSessionTokens(tx, user, session, s.JWTKey, now)
		return err
	})
	if rejected || repository.IsNotFound(err) {
		return LoginResult{}, invalidSession()
	}
	return output, err
}
func (s *Service) Logout(ctx context.Context, raw string) error {
	return s.Store.Transaction(ctx, func(tx *repository.Store) error {
		row, err := tx.RefreshToken(SessionHash(raw))
		if repository.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err = tx.LockSession(row.SesiID); repository.IsNotFound(err) {
			return nil
		} else if err != nil {
			return err
		}
		return tx.RevokeSession(row.SesiID)
	})
}
