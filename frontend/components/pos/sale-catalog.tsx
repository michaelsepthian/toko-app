'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, Plus, Search, Star } from 'lucide-react'
import type { Product } from '@/lib/types'
import { money } from '@/lib/pos'
import { catalogOffsets, catalogWindow } from '@/lib/catalog-window'

type Props = { products: Product[]; categories: Map<number, string>; highlight: number; locked: boolean; active: boolean; onHighlight: (index: number) => void; onAdd: (product: Product) => void; favorites: ReadonlySet<number>; onToggleFavorite: (id: number) => void; favoriteEditable: boolean; favoriteBusyID: number | null }

export function SaleCatalog(props: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 600 })
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    const measure = () => {
      if (!node.clientWidth) return // Keep measurements while the sales tab is hidden.
      setViewport(previous => previous.width === node.clientWidth && previous.height === node.clientHeight ? previous : { width: node.clientWidth, height: node.clientHeight })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node); measure()
    return () => observer.disconnect()
  }, [])
  // Reset row measurements when names, filter results, or card widths change.
  return <div ref={scroller} id="sale-products" className="sale-products-grid sale-virtual-catalog">
    <CatalogRows key={viewport.width} {...props} viewport={viewport} scroller={scroller} />
  </div>
}

function CatalogRows({ products, categories, highlight, locked, active, onHighlight, onAdd, favorites, onToggleFavorite, favoriteEditable, favoriteBusyID, viewport, scroller }: Props & { viewport: { width: number; height: number }; scroller: React.RefObject<HTMLDivElement | null> }) {
  const columns = viewport.width >= 700 ? 3 : 2
  const resultKey = useMemo(() => products.map(product => product.id).join(','), [products])
  // A separate keyed component discards old measurements when the search changes.
  return <MeasuredRows key={resultKey} {...{ products, categories, highlight, locked, active, onHighlight, onAdd, favorites, onToggleFavorite, favoriteEditable, favoriteBusyID, viewport, scroller, columns }} />
}

function MeasuredRows({ products, categories, highlight, locked, active, onHighlight, onAdd, favorites, onToggleFavorite, favoriteEditable, favoriteBusyID, viewport, scroller, columns }: Props & { viewport: { width: number; height: number }; scroller: React.RefObject<HTMLDivElement | null>; columns: number }) {
  const [heights, setHeights] = useState<Map<number, number>>(() => new Map())
  const [top, setTop] = useState(0)
  const offsets = useMemo(() => catalogOffsets(Math.ceil(products.length / columns), heights), [products.length, columns, heights])
  const geometry = useRef(offsets)
  useLayoutEffect(() => { geometry.current = offsets }, [offsets])
  const measureRow = useCallback((row: number, height: number) => {
    if (height <= 0) return
    setHeights(previous => {
      if (Math.abs((previous.get(row) ?? 0) - height) < 1) return previous
      return new Map(previous).set(row, height)
    })
  }, [])
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    node.scrollTop = 0
    let frame = 0
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setTop(node.scrollTop) })
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => { node.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [scroller])
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node || !active || !products.length) return
    const row = Math.floor(highlight / columns)
    const positions = geometry.current
    const start = positions[row] + 14
    const end = positions[row + 1] + 3
    if (start < node.scrollTop) node.scrollTop = Math.max(0, start - 14)
    else if (end > node.scrollTop + node.clientHeight) node.scrollTop = end - node.clientHeight + 14
    setTop(node.scrollTop)
  }, [highlight, active, columns, products.length, scroller])

  if (!products.length) return <div className="sale-empty sale-no-products"><Search /><strong>Produk tidak ditemukan</strong><p>Periksa nama, SKU, atau barcode produk.</p></div>
  const { start, end } = catalogWindow(offsets, Math.max(0, top - 14), viewport.height)
  return <div className="sale-virtual-space" style={{ height: offsets.at(-1)! + 17 }}>
    {Array.from({ length: end - start }, (_, offset) => {
      const row = start + offset
      return <MeasuredRow key={row} row={row} top={offsets[row] + 14} columns={columns} onMeasure={measureRow}>
        {products.slice(row * columns, (row + 1) * columns).map((product, column) => {
          const index = row * columns + column
          return <div className="sale-product-tile" key={product.id}><button type="button" disabled={locked} aria-label={`Tambah ${product.nama} ke keranjang`} data-highlighted={index === highlight} aria-current={index === highlight ? 'true' : undefined} onFocus={() => onHighlight(index)} onMouseEnter={() => onHighlight(index)} className="sale-product" onClick={() => onAdd(product)}>
            <div className="sale-product-top"><span>{categories.get(product.kategori_id) ?? 'Produk'}</span><Plus /></div><h3>{product.nama}</h3><strong>{money(product.harga_jual)}</strong>
          </button><button type="button" className="sale-product-favorite" disabled={locked || favoriteBusyID !== null || !favoriteEditable} aria-busy={favoriteBusyID === product.id} aria-label={favoriteBusyID === product.id ? `Menyimpan favorit ${product.nama}` : `${favorites.has(product.id) ? 'Hapus' : 'Tandai'} favorit ${product.nama}`} aria-pressed={favorites.has(product.id)} title={!favoriteEditable ? 'Favorit toko diatur oleh pemilik' : favorites.has(product.id) ? 'Hapus favorit untuk semua pengguna' : 'Jadikan favorit untuk semua pengguna'} onClick={() => onToggleFavorite(product.id)}>{favoriteBusyID === product.id ? <LoaderCircle className="animate-spin" /> : <Star fill={favorites.has(product.id) ? 'currentColor' : 'none'} />}</button></div>
        })}
      </MeasuredRow>
    })}
  </div>
}

function MeasuredRow({ row, top, columns, onMeasure, children }: { row: number; top: number; columns: number; onMeasure: (row: number, height: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(() => onMeasure(row, node.getBoundingClientRect().height))
    observer.observe(node)
    onMeasure(row, node.getBoundingClientRect().height)
    return () => observer.disconnect()
  }, [row, onMeasure])
  return <div ref={ref} className="sale-product-row" style={{ top, gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}>{children}</div>
}
