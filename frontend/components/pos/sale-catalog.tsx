'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { LoaderCircle, Search, Star } from 'lucide-react'
import type { Product } from '@/lib/types'
import { ProductLoading } from './product-loading'
import { money } from '@/lib/pos'
import { catalogOffsets, catalogWindow } from '@/lib/catalog-window'
import { catalogColumns } from '@/lib/catalog-layout'

type Props = {
  loading?: boolean
  products: Product[]
  categories: Map<number, string>
  highlight: number
  locked: boolean
  active: boolean
  onHighlight: (index: number) => void
  onAdd: (product: Product) => void
  favorites: ReadonlySet<number>
  onToggleFavorite: (id: number) => void
  favoriteEditable: boolean
  favoriteBusyID: number | null
  hasNext: boolean
  loadingNext: boolean
  onLoadNext: () => void
  pageKey: string
  loadError: boolean
}

export function SaleCatalog(props: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 600 })
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    const measure = () => {
      if (!node.clientWidth) return // Keep measurements while the sales tab is hidden.
      setViewport((previous) =>
        previous.width === node.clientWidth && previous.height === node.clientHeight
          ? previous
          : { width: node.clientWidth, height: node.clientHeight },
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [])
  // Reset row measurements when names, filter results, or card widths change.
  return (
    <div
      ref={scroller}
      id="sale-products"
      className="sale-products-grid sale-virtual-catalog"
      aria-busy={Boolean(props.loading)}
    >
      {props.loading ? (
        <ProductLoading />
      ) : (
        <CatalogRows key={viewport.width} {...props} viewport={viewport} scroller={scroller} />
      )}
    </div>
  )
}

function CatalogRows(
  props: Props & {
    viewport: { width: number; height: number }
    scroller: React.RefObject<HTMLDivElement | null>
  },
) {
  const { viewport } = props
  const columns = catalogColumns(viewport.width)
  // Appending a server page must preserve measurements and scroll position.
  return <MeasuredRows key={props.pageKey} {...props} columns={columns} />
}

function MeasuredRows({
  products,
  categories,
  highlight,
  locked,
  active,
  onHighlight,
  onAdd,
  favorites,
  onToggleFavorite,
  favoriteEditable,
  favoriteBusyID,
  viewport,
  scroller,
  columns,
  hasNext,
  loadingNext,
  onLoadNext,
  loadError,
}: Props & {
  viewport: { width: number; height: number }
  scroller: React.RefObject<HTMLDivElement | null>
  columns: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  // Keep feedback on the hovered/tapped card when adding resets the keyboard
  // selection. Keyboard input takes over without relying on native :hover.
  useEffect(() => {
    const clearHover = () => setHovered(null)
    window.addEventListener('keydown', clearHover, true)
    return () => window.removeEventListener('keydown', clearHover, true)
  }, [])
  const selected = hovered ?? highlight
  const visibleCount = products.length
  const [heights, setHeights] = useState<Map<number, number>>(() => new Map())
  const [top, setTop] = useState(0)
  const offsets = useMemo(
    () => catalogOffsets(Math.ceil(visibleCount / columns), heights),
    [visibleCount, columns, heights],
  )
  const geometry = useRef(offsets)
  useLayoutEffect(() => {
    geometry.current = offsets
  }, [offsets])
  const measureRow = useCallback((row: number, height: number) => {
    if (height <= 0) return
    setHeights((previous) => {
      if (Math.abs((previous.get(row) ?? 0) - height) < 1) return previous
      return new Map(previous).set(row, height)
    })
  }, [])
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    let frame = 0
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          setTop(node.scrollTop)
          if (
            active &&
            hasNext &&
            !loadingNext &&
            !loadError &&
            node.scrollHeight - node.scrollTop - node.clientHeight < 250
          )
            onLoadNext()
        })
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      node.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [scroller, active, hasNext, loadingNext, onLoadNext, loadError])
  useLayoutEffect(() => {
    const node = scroller.current
    // Tall/wide monitors can fit a complete page. Fill the viewport until there
    // is something to scroll, otherwise the remaining products are unreachable.
    if (
      active &&
      node &&
      node.clientHeight > 0 &&
      hasNext &&
      !loadingNext &&
      !loadError &&
      node.scrollHeight - node.scrollTop - node.clientHeight < 250
    ) {
      onLoadNext()
    }
  }, [
    active,
    offsets,
    viewport.height,
    visibleCount,
    hasNext,
    loadingNext,
    loadError,
    onLoadNext,
    scroller,
  ])
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
  }, [highlight, active, columns, scroller])

  if (!products.length && loadError)
    return (
      <div className="sale-empty">
        <strong>Produk belum berhasil dimuat</strong>
        <p>Gunakan Coba lagi untuk memuat katalog.</p>
      </div>
    )
  if (!products.length)
    return (
      <div className="sale-empty sale-no-products">
        <Search />
        <strong>Produk tidak ditemukan</strong>
        <p>Periksa nama, SKU, atau barcode produk.</p>
      </div>
    )
  const { start, end } = catalogWindow(offsets, Math.max(0, top - 14), viewport.height)
  const hasMore = hasNext
  return (
    <div
      className="sale-virtual-space"
      data-loaded-count={visibleCount}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setHovered(null)
      }}
      style={{ height: offsets.at(-1)! + 17 + (hasMore ? 48 : 0) }}
    >
      {Array.from({ length: end - start }, (_, offset) => {
        const row = start + offset
        return (
          <MeasuredRow
            key={row}
            row={row}
            top={offsets[row] + 14}
            columns={columns}
            onMeasure={measureRow}
          >
            {products
              .slice(row * columns, Math.min((row + 1) * columns, visibleCount))
              .map((product, column) => {
                const index = row * columns + column
                return (
                  <div
                    className="sale-product-tile"
                    data-favorite-busy={favoriteBusyID === product.id}
                    key={product.id}
                  >
                    <button
                      type="button"
                      disabled={locked || favoriteBusyID === product.id}
                      aria-label={`Tambah ${product.nama} ke keranjang`}
                      data-highlighted={index === selected}
                      aria-current={index === selected ? 'true' : undefined}
                      onFocus={() => onHighlight(index)}
                      onPointerDown={() => {
                        setHovered(index)
                        onHighlight(index)
                      }}
                      onPointerMove={(event) => {
                        if (event.pointerType === 'mouse') {
                          setHovered(index)
                          onHighlight(index)
                        }
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType === 'mouse') setHovered(null)
                      }}
                      onPointerCancel={() => setHovered(null)}
                      className="sale-product"
                      onClick={() => onAdd(product)}
                    >
                      <div className="sale-product-top">
                        <span>{categories.get(product.kategori_id) ?? 'Produk'}</span>
                      </div>
                      <h3>{product.nama}</h3>
                      <strong>{money(product.harga_jual)}</strong>
                    </button>
                    <button
                      type="button"
                      className="sale-product-favorite"
                      disabled={locked || favoriteBusyID !== null || !favoriteEditable}
                      aria-busy={favoriteBusyID === product.id}
                      aria-label={
                        favoriteBusyID === product.id
                          ? `Menyimpan favorit ${product.nama}`
                          : `${favorites.has(product.id) ? 'Hapus' : 'Tandai'} favorit ${product.nama}`
                      }
                      aria-pressed={favorites.has(product.id)}
                      title={
                        !favoriteEditable
                          ? 'Favorit toko diatur oleh pemilik'
                          : favorites.has(product.id)
                            ? 'Hapus favorit untuk semua pengguna'
                            : 'Jadikan favorit untuk semua pengguna'
                      }
                      onClick={() => onToggleFavorite(product.id)}
                    >
                      {favoriteBusyID === product.id ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Star fill={favorites.has(product.id) ? 'currentColor' : 'none'} />
                      )}
                    </button>
                    {favoriteBusyID === product.id && (
                      <div className="product-favorite-progress" aria-hidden="true">
                        <LoaderCircle />
                        <span>Menyimpan favorit…</span>
                      </div>
                    )}
                  </div>
                )
              })}
          </MeasuredRow>
        )
      })}
      {hasMore && (
        <div className="product-page-end sale-page-end" style={{ top: offsets.at(-1)! + 14 }}>
          {loadingNext
            ? 'Memuat produk…'
            : loadError
              ? 'Gagal memuat halaman berikutnya. Klik Coba lagi.'
              : 'Gulir untuk memuat 50 produk berikutnya'}
        </div>
      )}
    </div>
  )
}

function MeasuredRow({
  row,
  top,
  columns,
  onMeasure,
  children,
}: {
  row: number
  top: number
  columns: number
  onMeasure: (row: number, height: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(() => onMeasure(row, node.getBoundingClientRect().height))
    observer.observe(node)
    onMeasure(row, node.getBoundingClientRect().height)
    return () => observer.disconnect()
  }, [row, onMeasure])
  return (
    <div
      ref={ref}
      className="sale-product-row"
      style={{ top, gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
    >
      {children}
    </div>
  )
}
