import type { ProductPage } from './types'

/** Bounded session-scoped page cache, including in-flight request coalescing. */
export class ProductPageCache {
  private entries = new Map<string, { promise: Promise<ProductPage>; expires: number }>()
  constructor(private capacity = 100, private ttl = 3600000, private now = () => Date.now()) {}
  get(key: string, load: () => Promise<ProductPage>): Promise<ProductPage> {
    const existing = this.entries.get(key)
    if (existing && existing.expires > this.now()) {
      this.entries.delete(key); this.entries.set(key, existing)
      return existing.promise
    }
    this.entries.delete(key)
    const entry = { promise: Promise.resolve().then(load), expires: Infinity }
    this.entries.set(key, entry)
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!)
    entry.promise = entry.promise.then(page => {
      // Backend supplies the runtime policy so changing env needs no frontend rebuild.
      const seconds = page.cache_ttl_seconds
      const ttl = typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= 31536000 ? seconds * 1000 : this.ttl
      entry.expires = this.now() + ttl
      return page
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    })
    return entry.promise
  }
  clear() { this.entries.clear() }
}

export const productPageCache = new ProductPageCache()
let revision = 0
const listeners = new Set<() => void>()
export const productRevision = () => revision
export function subscribeProducts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function invalidateProducts() {
  productPageCache.clear(); revision++
  for (const listener of listeners) listener()
}
