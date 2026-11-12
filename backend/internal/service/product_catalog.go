package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/shopspring/decimal"
	"toko/backend/internal/apperror"
	"toko/backend/internal/model"
	"toko/backend/internal/repository"
)

type ProductCatalogOptions struct {
	Query, Sort, Active, Exact, Cursor string
	FavoritesFirst                     bool
	Limit                              int
	Refresh                            bool
}

func (o ProductCatalogOptions) Signature() string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%q|%q|%q|%q|%t|%d", o.Query, o.Sort, o.Active, o.Exact, o.FavoritesFirst, o.Limit))))
}

type ProductPage struct {
	Items           []model.Produk
	HasNext         bool
	NextCursor      *string
	Version         string
	CacheTTLSeconds int64
}

type productCursor struct {
	Signature  string `json:"s"`
	Version    string `json:"v"`
	ID         int64  `json:"id"`
	Name       string `json:"n"`
	Price      string `json:"p"`
	Favorite   bool   `json:"f"`
	Popularity int64  `json:"t"`
}

func (s *Service) ProductPage(ctx context.Context, o ProductCatalogOptions, version string) (ProductPage, error) {
	page := ProductPage{Items: []model.Produk{}, Version: version}
	var cursor *repository.CatalogCursor
	if o.Cursor != "" {
		var decoded productCursor
		bytes, err := base64.RawURLEncoding.DecodeString(o.Cursor)
		if err != nil || json.Unmarshal(bytes, &decoded) != nil || decoded.ID <= 0 || decoded.Signature != o.Signature() {
			return page, apperror.Invalid("Cursor produk tidak valid untuk pencarian ini")
		}
		if _, err := decimal.NewFromString(decoded.Price); err != nil {
			return page, apperror.Invalid("Cursor harga tidak valid")
		}
		if decoded.Version != version {
			return page, apperror.Conflict("Katalog berubah; muat ulang halaman pertama")
		}
		cursor = &repository.CatalogCursor{ID: decoded.ID, Name: decoded.Name, Price: decoded.Price, Favorite: decoded.Favorite, Popularity: decoded.Popularity}
	}
	rows, err := s.Store.WithContext(ctx).CatalogProducts(repository.CatalogFilter{
		Query: o.Query, Sort: o.Sort, Active: o.Active, Exact: o.Exact, FavoritesFirst: o.FavoritesFirst, Limit: o.Limit,
	}, cursor)
	if err != nil {
		return page, err
	}
	page.HasNext = len(rows) > o.Limit
	if page.HasNext {
		rows = rows[:o.Limit]
	}
	for _, row := range rows {
		page.Items = append(page.Items, row.Produk)
	}
	if page.HasNext {
		last := rows[len(rows)-1]
		bytes, _ := json.Marshal(productCursor{Signature: o.Signature(), Version: version, ID: last.ID, Name: last.SortName, Price: last.HargaJual.String(), Favorite: last.IsFavorit, Popularity: last.Popularity})
		next := base64.RawURLEncoding.EncodeToString(bytes)
		page.NextCursor = &next
	}
	return page, nil
}
