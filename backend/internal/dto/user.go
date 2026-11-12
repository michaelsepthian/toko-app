package dto

import (
	"time"

	"toko/backend/internal/model"
	"toko/backend/internal/service"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type CreateUserRequest struct {
	Nama     string `json:"nama"`
	Username string `json:"username"`
	Password string `json:"password"`
	Peran    string `json:"peran"`
}

func (r CreateUserRequest) Input() service.CreateUserInput { return service.CreateUserInput(r) }

type UserResponse struct {
	BaseResponse
	Nama     string `json:"nama"`
	Username string `json:"username"`
	Peran    string `json:"peran"`
	Aktif    bool   `json:"aktif"`
}

func User(row model.Pengguna) UserResponse {
	return UserResponse{
		BaseResponse: BaseResponse{ID: row.ID, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt},
		Nama:         row.Nama, Username: row.Username, Peran: string(row.Peran), Aktif: row.Aktif,
	}
}

type LoginResponse struct {
	User             UserResponse `json:"user"`
	AccessToken      string       `json:"access_token"`
	ExpiresAt        time.Time    `json:"expires_at"`
	SessionExpiresAt time.Time    `json:"session_expires_at"`
}

func Login(result service.LoginResult) LoginResponse {
	return LoginResponse{User: User(result.User), AccessToken: result.AccessToken, ExpiresAt: result.ExpiresAt, SessionExpiresAt: result.SessionExpiresAt}
}
