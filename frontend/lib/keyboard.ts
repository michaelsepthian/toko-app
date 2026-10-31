import type { Product } from './types'

type Key = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>
export function isSearchCharacter(event: Key) {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing
}
export function exactProduct(products: Product[], value: string) {
  const query = value.trim()
  return products.find(product => product.aktif && (product.barcode === query || product.sku.toLowerCase() === query.toLowerCase()))
}
export function isBarcodeQuery(value: string) { return /^\d+$/.test(value.trim()) }
export function groupedCash(value: string) { return value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
