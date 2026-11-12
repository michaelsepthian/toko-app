package service

import "toko/backend/internal/repository"

// Service mengoordinasikan aturan bisnis. SQL dan objek GORM tetap di repository.
type Service struct {
	Store  *repository.Store
	JWTKey []byte
}
