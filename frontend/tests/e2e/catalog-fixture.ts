import { sortProducts, type ProductPopularity, type ProductSort } from '../../lib/product-sort'
import type { Product } from '../../lib/types'

type FixtureProduct = Omit<Product, 'is_favorit'> & { is_favorit?: boolean }
/** Test-only cursor fixture; production uses database keysets, not offsets. */
export function catalogFixture(
  products: FixtureProduct[],
  params: URLSearchParams,
  version = '1',
  popularity: ProductPopularity[] = [],
) {
  let items = products.map((product) => ({ ...product, is_favorit: product.is_favorit ?? false }))
  const exact = params.get('exact')
  const words = (params.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const active = params.get('aktif') ?? 'true'
  items = items.filter(
    (product) =>
      (active === 'all' || product.aktif === (active === 'true')) &&
      (!exact || product.barcode === exact || product.sku.toLowerCase() === exact.toLowerCase()) &&
      words.every((word) =>
        `${product.nama} ${product.sku} ${product.barcode ?? ''} Sembako`
          .toLowerCase()
          .includes(word),
      ),
  )
  items = sortProducts(
    items,
    (params.get('sort') ?? 'name-asc') as ProductSort,
    new Map(popularity.map((row) => [row.produk_id, row.transaksi])),
    params.get('favorites_first') === 'true',
  )
  const offset = Number(params.get('cursor') ?? 0),
    limit = Number(params.get('limit') ?? 50)
  const has_next = offset + limit < items.length
  return {
    items: items.slice(offset, offset + limit),
    has_next,
    next_cursor: has_next ? String(offset + limit) : null,
    version,
  }
}
