'use client'

export type MobileCartPanel = 'products' | 'cart'

export function MobileCartTabs({ prefix, label, panel, count, onChange }: { prefix: string; label: string; panel: MobileCartPanel; count: string | number; onChange: (panel: MobileCartPanel) => void }) {
  return <div className="mobile-cart-tabs" role="tablist" aria-label={label}>
    {(['products', 'cart'] as const).map(value => <button type="button" key={value} id={`${prefix}-tab-${value}`} role="tab" aria-selected={panel === value} aria-controls={`${prefix}-panel-${value}`} tabIndex={panel === value ? 0 : -1} onClick={() => onChange(value)} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); return }
      const next = event.key === 'Home' ? 'products' : event.key === 'End' ? 'cart' : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? value === 'products' ? 'cart' : 'products' : null
      if (!next) return
      event.preventDefault(); event.stopPropagation(); onChange(next)
      document.getElementById(`${prefix}-tab-${next}`)?.focus()
    }}>{value === 'products' ? 'Produk' : <>Keranjang <span>{count}</span></>}</button>)}
  </div>
}
