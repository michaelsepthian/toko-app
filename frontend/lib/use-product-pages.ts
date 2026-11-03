'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

export const productPageSize = 50

/** Page the rendered list while retaining the complete catalog for search and scans. */
export function useProductPages<T>(items: T[], enabled = true, root?: RefObject<HTMLElement | null>) {
  const [page, setPage] = useState({ items, limit: productPageSize })
  const endRef = useRef<HTMLDivElement>(null)
  const limit = page.items === items ? page.limit : productPageSize
  const hasMore = limit < items.length
  useLayoutEffect(() => {
    setPage(previous => previous.items === items ? previous : { items, limit: productPageSize })
    if (root?.current) root.current.scrollTop = 0
  }, [items, root])
  useEffect(() => {
    const end = endRef.current
    if (!enabled || !hasMore || !end) return
    let requested = false
    const observer = new IntersectionObserver(entries => {
      if (requested || !entries.some(entry => entry.isIntersecting)) return
      requested = true
      setPage(previous => ({ items, limit: Math.min(items.length, (previous.items === items ? previous.limit : productPageSize) + productPageSize) }))
    }, { root: root?.current ?? null, rootMargin: '200px 0px' })
    observer.observe(end)
    return () => observer.disconnect()
  }, [enabled, hasMore, items, limit, root])
  return { visibleProducts: useMemo(() => items.slice(0, limit), [items, limit]), endRef, hasMore }
}
