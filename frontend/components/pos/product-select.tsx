'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useProductCatalog } from '@/lib/use-product-catalog'
import type { Product } from '@/lib/types'
import { SearchSelect } from './search-select'

export function ProductSelect({
  value,
  onValueChange,
  label,
  required,
  allowOther = false,
}: {
  value: string
  onValueChange: (value: string, product?: Product) => void
  label: string
  required?: boolean
  allowOther?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const catalog = useProductCatalog({ q: query }, open)
  const [selected, setSelected] = useState<Product | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const [selectionRevision, setSelectionRevision] = useState(0)
  useEffect(() => {
    setSelectionError('')
    if (!value || value === 'other' || selected?.id === Number(value)) return
    let current = true
    void api<Product>(`/produk/${value}`)
      .then((product) => {
        if (current) setSelected(product)
      })
      .catch(() => {
        if (current) setSelectionError('Gagal memuat produk terpilih.')
      })
    return () => {
      current = false
    }
  }, [value, selected?.id, selectionRevision])
  const options = catalog.products.filter((product) => String(product.id) !== value)
  const choice =
    catalog.products.find((product) => String(product.id) === value) ??
    (selected && String(selected.id) === value ? selected : null)
  return (
    <SearchSelect
      aria-label={label}
      value={value}
      required={required}
      onOpenChange={setOpen}
      onSearchChange={setQuery}
      selectedLabel={choice?.nama}
      loading={catalog.loading || catalog.loadingNext}
      hasNext={catalog.hasNext}
      onLoadNext={catalog.loadNext}
      error={catalog.error || selectionError}
      onRetry={() => {
        catalog.retry()
        setSelectionRevision((value) => value + 1)
      }}
      onValueChange={(next) => {
        const product =
          catalog.products.find((product) => String(product.id) === next) ??
          (String(selected?.id) === next ? selected! : undefined)
        if (product) setSelected(product)
        onValueChange(next, product)
      }}
    >
      <option value="">Pilih atau cari produk</option>
      {allowOther && <option value="other">Lainnya — tulis barang baru</option>}
      {choice &&
        (!query.trim() || catalog.products.some((product) => product.id === choice.id)) && (
          <option value={choice.id}>{choice.nama}</option>
        )}
      {options.map((product) => (
        <option key={product.id} value={product.id}>
          {product.nama}
        </option>
      ))}
    </SearchSelect>
  )
}
