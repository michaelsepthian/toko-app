import { api, readSession } from './api'
import { productPageCache } from './product-cache'
import type { Product, ProductPage } from './types'
import type { ProductSort } from './product-sort'

export type ProductQuery = {
  q?: string
  sort?: ProductSort
  aktif?: 'true' | 'false' | 'all'
  favoritesFirst?: boolean
}
export function productQueryString(query: ProductQuery) {
  return new URLSearchParams({
    q: query.q?.trim().replace(/\s+/g, ' ') ?? '',
    sort: query.sort ?? 'name-asc',
    aktif: query.aktif ?? 'true',
    favorites_first: String(Boolean(query.favoritesFirst)),
    limit: '50',
  }).toString()
}
export function fetchProductPage(
  query: string,
  cursor: string | null = null,
  refresh = false,
): Promise<ProductPage> {
  const path = `/katalog/produk?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${refresh ? '&refresh=true' : ''}`
  const load = () =>
    api<ProductPage>(path).then((page) => {
      if (
        !Array.isArray(page.items) ||
        typeof page.has_next !== 'boolean' ||
        (page.has_next && !page.next_cursor)
      )
        throw new Error('Respons katalog produk tidak valid.')
      return page
    })
  const session = readSession()
  // Never serve a cache hit after session expiry or across accounts.
  if (!session || refresh) return load()
  return productPageCache.get(`${session.access_token}:${path}`, load)
}
export async function exactCatalogProduct(code: string): Promise<Product | undefined> {
  const page = await api<ProductPage>(
    `/katalog/produk?${new URLSearchParams({ exact: code.trim(), aktif: 'true', limit: '2' })}`,
  )
  return (
    page.items.find((product) => product.barcode === code.trim()) ??
    page.items.find((product) => product.sku.toLowerCase() === code.trim().toLowerCase())
  )
}
