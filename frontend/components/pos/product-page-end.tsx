import type { RefObject } from 'react'

export function ProductPageEnd({ endRef }: { endRef: RefObject<HTMLDivElement | null> }) {
  return <div ref={endRef} className="product-page-end">Gulir untuk memuat 50 produk berikutnya</div>
}
