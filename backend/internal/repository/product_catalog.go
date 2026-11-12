package repository

import (
	"strings"

	"toko/backend/internal/model"
)

type CatalogFilter struct {
	Query, Sort, Active, Exact string
	FavoritesFirst             bool
	Limit                      int
}

type CatalogCursor struct {
	ID          int64
	Name, Price string
	Favorite    bool
	Popularity  int64
}

type CatalogProduct struct {
	model.Produk
	SortName   string
	Popularity int64
}

type productOrder struct {
	column, direction string
	value             any
}

func productOrders(o CatalogFilter, c CatalogCursor) []productOrder {
	orders := []productOrder{}
	if o.FavoritesFirst {
		orders = append(orders, productOrder{"p.is_favorit", "DESC", c.Favorite})
	}
	switch o.Sort {
	case "recommended":
		orders = append(orders, productOrder{"COALESCE(pop.transaksi, 0)", "DESC", c.Popularity})
	case "newest":
		return append(orders, productOrder{"p.id", "DESC", c.ID})
	case "price-asc":
		orders = append(orders, productOrder{"p.harga_jual", "ASC", c.Price})
	case "price-desc":
		orders = append(orders, productOrder{"p.harga_jual", "DESC", c.Price})
	}
	direction := "ASC"
	if o.Sort == "name-desc" {
		direction = "DESC"
	}
	return append(orders, productOrder{"lower(p.nama)", direction, c.Name}, productOrder{"p.id", "ASC", c.ID})
}

// Keyset pagination: tanpa OFFSET dan tanpa COUNT seluruh produk.
func productSeek(orders []productOrder) (string, []any) {
	clauses := []string{}
	args := []any{}
	for i, order := range orders {
		parts := []string{}
		for _, previous := range orders[:i] {
			parts = append(parts, previous.column+" = ?")
			args = append(args, previous.value)
		}
		op := " > ?"
		if order.direction == "DESC" {
			op = " < ?"
		}
		parts = append(parts, order.column+op)
		args = append(args, order.value)
		clauses = append(clauses, "("+strings.Join(parts, " AND ")+")")
	}
	return "(" + strings.Join(clauses, " OR ") + ")", args
}

func (s *Store) CatalogProducts(o CatalogFilter, cursor *CatalogCursor) ([]CatalogProduct, error) {
	query := s.DB.Table("public.produk AS p").Select("p.*, lower(p.nama) AS sort_name")
	if o.Active != "all" {
		query = query.Where("p.aktif = ?", o.Active == "true")
	}
	if o.Exact != "" {
		query = query.Where("(p.barcode = ? OR lower(p.sku) = lower(?))", o.Exact, o.Exact)
	}
	if o.Query != "" {
		query = query.Joins("LEFT JOIN public.kategori k ON k.id = p.kategori_id")
		for _, word := range strings.Fields(o.Query) {
			word = "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(word) + "%"
			query = query.Where("(p.nama ILIKE ? OR p.sku ILIKE ? OR p.barcode ILIKE ? OR k.nama ILIKE ?)", word, word, word, word)
		}
	}
	if o.Sort == "recommended" {
		query = query.Joins(`LEFT JOIN (SELECT d.produk_id, COUNT(DISTINCT d.penjualan_id) AS transaksi
FROM public.detail_penjualan d JOIN public.penjualan s ON s.id = d.penjualan_id
WHERE s.status = 'SELESAI' GROUP BY d.produk_id) pop ON pop.produk_id = p.id`).Select("p.*, lower(p.nama) AS sort_name, COALESCE(pop.transaksi, 0) AS popularity")
	}
	var current CatalogCursor
	if cursor != nil {
		current = *cursor
	}
	orders := productOrders(o, current)
	if cursor != nil {
		condition, args := productSeek(orders)
		query = query.Where(condition, args...)
	}
	for _, order := range orders {
		query = query.Order(order.column + " " + order.direction)
	}
	rows := []CatalogProduct{}
	err := query.Limit(o.Limit + 1).Scan(&rows).Error
	return rows, err
}
