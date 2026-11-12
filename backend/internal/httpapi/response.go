package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"toko/backend/internal/apperror"
	"toko/backend/internal/dto"
	"toko/backend/internal/repository"
)

func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(dto.Envelope[any]{Data: data})
}
func fail(w http.ResponseWriter, err error) {
	status, message := http.StatusInternalServerError, "Terjadi kesalahan internal"
	code := ""
	var app *apperror.Error
	var state interface{ SQLState() string }
	switch {
	case errors.As(err, &app):
		status, message = app.Status, app.Message
		code = app.Code
	case repository.IsNotFound(err):
		status, message = 404, "Data tidak ditemukan"
	case errors.As(err, &state):
		switch state.SQLState() {
		case "23505":
			status, message = 409, "Data unik sudah digunakan atau mutasi sudah tercatat"
		case "23503":
			status, message = 400, "Relasi data tidak valid"
		case "23514", "23502", "22003":
			status, message = 400, "Data tidak memenuhi aturan database"
		case "40001", "40P01":
			status, message = 409, "Transaksi bersamaan mengalami konflik; periksa status sebelum mencoba lagi"
		}
	}
	if status >= 500 {
		slog.Error("request failed", "error", err)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(dto.ErrorResponse{Error: dto.ErrorDetail{Message: message, Code: code}})
}
func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return apperror.Invalid("Body JSON tidak valid atau berisi field yang tidak diizinkan")
	}
	if err := d.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return apperror.Invalid("Body hanya boleh berisi satu objek JSON")
	}
	return nil
}
func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, apperror.Invalid("ID harus bilangan bulat positif")
	}
	return id, nil
}
func pagination(r *http.Request) (int, int, error) {
	limit, offset := 20, 0
	var err error
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil {
			return 0, 0, apperror.Invalid("Limit tidak valid")
		}
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		offset, err = strconv.Atoi(value)
		if err != nil {
			return 0, 0, apperror.Invalid("Offset tidak valid")
		}
	}
	if limit < 1 || limit > 100 || offset < 0 || offset > 1000000 {
		return 0, 0, apperror.Invalid("Limit harus 1–100 dan offset 0–1000000")
	}
	return limit, offset, nil
}
