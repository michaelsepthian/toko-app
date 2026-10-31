package database

import (
	"context"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Open(ctx context.Context, dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN: dsn, PreferSimpleProtocol: true, // Kompatibel dengan transaction pooler Supabase.
	}), &gorm.Config{
		Logger:               logger.Default.LogMode(logger.Silent), // Jangan bocorkan input/SQL sensitif.
		DisableAutomaticPing: true,
	})
	if err != nil {
		return nil, err
	}
	pool, err := db.DB()
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(10)
	pool.SetMaxIdleConns(5)
	pool.SetConnMaxLifetime(30 * time.Minute)
	if err := pool.PingContext(ctx); err != nil {
		_ = pool.Close()
		return nil, err
	}
	// SQL menjadi sumber skema; jangan gunakan AutoMigrate untuk menimpa trigger/constraint.
	return db, nil
}
