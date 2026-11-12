'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { APIError, message } from './api'
import { fetchProductPage, productQueryString, type ProductQuery } from './product-catalog'
import {
  invalidateProducts,
  productPageCache,
  productRevision,
  subscribeProducts,
} from './product-cache'
import type { Product } from './types'

type CatalogState = {
  key: string
  items: Product[]
  cursor: string | null
  hasNext: boolean
  loading: boolean
  error: string
}
export function useProductCatalog(
  options: ProductQuery = {},
  enabled = true,
  root?: RefObject<HTMLElement | null>,
) {
  const revision = useSyncExternalStore(subscribeProducts, productRevision, () => 0)
  const query = productQueryString(options)
  const key = `${revision}:${query}`
  const [debounced, setDebounced] = useState(query)
  const lastQuery = useRef(options.q ?? '')
  useEffect(() => {
    // Only typing is debounced; sorting and clearing search apply immediately.
    const delay = options.q && options.q !== lastQuery.current ? 300 : 0
    lastQuery.current = options.q ?? ''
    const timer = setTimeout(() => setDebounced(query), delay)
    return () => clearTimeout(timer)
  }, [query, options.q])
  const [state, setState] = useState<CatalogState>({
    key: '',
    items: [],
    cursor: null,
    hasNext: false,
    loading: false,
    error: '',
  })
  const current = useRef(state)
  const generation = useRef(0)
  const desiredKey = useRef(key)
  desiredKey.current = key
  const endRef = useRef<HTMLDivElement>(null)
  const force = useRef(false)
  const [retry, setRetry] = useState(0)
  const commit = useCallback((value: CatalogState) => {
    current.current = value
    setState(value)
  }, [])

  const load = useCallback(
    async (append: boolean) => {
      const previous = current.current
      if (
        !enabled ||
        query !== debounced ||
        (append && (previous.key !== key || previous.loading || !previous.hasNext))
      )
        return
      const ticket = ++generation.current
      const base: CatalogState = append
        ? previous
        : { key, items: [], cursor: null, hasNext: false, loading: false, error: '' }
      commit({ ...base, loading: true, error: '' })
      const refresh = force.current
      force.current = false
      try {
        const page = await fetchProductPage(query, append ? previous.cursor : null, refresh)
        if (ticket !== generation.current || desiredKey.current !== key) return
        const items = append
          ? [
              ...new Map(
                [...base.items, ...page.items].map((product) => [product.id, product]),
              ).values(),
            ]
          : page.items
        commit({
          key,
          items,
          cursor: page.next_cursor,
          hasNext: page.has_next,
          loading: false,
          error: '',
        })
      } catch (error) {
        if (ticket !== generation.current || desiredKey.current !== key) return
        if (error instanceof APIError && error.status === 409 && append) {
          invalidateProducts()
          return
        }
        commit({ ...base, loading: false, error: message(error) })
      }
    },
    [enabled, query, debounced, key, commit],
  )

  useEffect(() => {
    if (!enabled || query !== debounced) return
    if (root?.current) root.current.scrollTop = 0
    void load(false)
    return () => {
      generation.current++
    }
  }, [load, retry, enabled, query, debounced, root])

  const loadNext = useCallback(() => {
    void load(true)
  }, [load])
  const loading =
    enabled && (state.key !== key || query !== debounced || (state.loading && !state.items.length))
  const items = state.key === key && query === debounced ? state.items : []
  const hasNext = state.key === key && state.hasNext
  useEffect(() => {
    const end = endRef.current
    if (!enabled || !end || !hasNext || state.loading || state.error || loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNext()
      },
      { root: root?.current ?? null, rootMargin: '250px 0px' },
    )
    observer.observe(end)
    return () => observer.disconnect()
  }, [enabled, hasNext, loading, state.loading, state.error, items.length, loadNext, root])

  return {
    products: items,
    loading,
    loadingNext: state.loading && items.length > 0,
    hasNext,
    endRef,
    loadNext,
    error: state.key === key ? state.error : '',
    retry: () => (state.items.length ? loadNext() : setRetry((value) => value + 1)),
    refresh: () => {
      productPageCache.clear()
      force.current = true
      setRetry((value) => value + 1)
    },
  }
}
