import Decimal from 'decimal.js'
import type { Product } from './types'

export const productSortOptions = [
  { value: 'recommended', label: 'Paling sering dibeli' },
  { value: 'name-asc', label: 'Nama A–Z' },
  { value: 'name-desc', label: 'Nama Z–A' },
  { value: 'newest', label: 'Produk terbaru' },
  { value: 'price-asc', label: 'Harga terendah' },
  { value: 'price-desc', label: 'Harga tertinggi' },
] as const
export type ProductSort = typeof productSortOptions[number]['value']
export type ProductPopularity = { produk_id: number; transaksi: number }
export type ProductOrderSettings = { sort: ProductSort; favoritesFirst: boolean }
const names = new Intl.Collator('id', { numeric: true, sensitivity: 'base' })

export function parseProductOrder(value: string | null): ProductOrderSettings {
  try {
    const parsed = JSON.parse(value ?? '{}')
    return {
      favoritesFirst: parsed?.favoritesFirst === true,
      sort: productSortOptions.some(option => option.value === parsed?.sort) ? parsed.sort : 'recommended',
    }
  } catch { return { sort: 'recommended', favoritesFirst: false } }
}

export function sortProducts(products: Product[], sort: ProductSort, popularity: ReadonlyMap<number, number>, favoritesFirst = false) {
  return [...products].sort((a, b) => {
    const favoriteOrder = favoritesFirst ? Number(Boolean(b.is_favorit)) - Number(Boolean(a.is_favorit)) : 0
    if (favoriteOrder) return favoriteOrder
    let order = 0
    if (sort === 'recommended') order = (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0)
    if (sort === 'newest') order = b.id - a.id
    if (sort === 'price-asc' || sort === 'price-desc') order = new Decimal(a.harga_jual).cmp(b.harga_jual) * (sort === 'price-desc' ? -1 : 1)
    if (sort === 'name-desc') order = names.compare(b.nama, a.nama)
    return order || names.compare(a.nama, b.nama) || a.id - b.id
  })
}
