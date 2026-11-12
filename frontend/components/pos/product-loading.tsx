'use client'

import { LoaderCircle } from 'lucide-react'

export function ProductLoading() {
  return (
    <div className="product-loading" role="status" aria-label="Memuat daftar produk">
      <p>
        <LoaderCircle aria-hidden="true" />
        <span>Memuat produk…</span>
      </p>
      <div className="product-loading-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="product-loading-card" key={index}>
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}
