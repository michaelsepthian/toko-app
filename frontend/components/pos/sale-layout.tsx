'use client'

import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'

const storageKey = 'toko:sale-panel-width'
const initialWidth = 45
const minimumPanel = 360
const dividerWidth = 18
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export function SaleLayout({ children }: { children: ReactNode }) {
  const panels = Children.toArray(children)
  const layout = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initialWidth)
  const [limits, setLimits] = useState({ minimum: 20, maximum: 80 })
  const [resizing, setResizing] = useState(false)
  // Constrain the rendered split, not the saved preference, while space is tight.
  const panelWidth = clamp(width, limits.minimum, limits.maximum)

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      if (saved >= 20 && saved <= 80) setWidth(saved)
    } catch { /* Tata letak tetap bisa dipakai saat penyimpanan browser tidak tersedia. */ }
    const element = layout.current
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - dividerWidth
      if (available < minimumPanel * 2) return
      const minimum = Math.max(20, minimumPanel / available * 100)
      const maximum = 100 - minimum
      setLimits({ minimum, maximum })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    return () => observer.disconnect()
  }, [])

  function change(next: number) {
    const value = clamp(next, limits.minimum, limits.maximum)
    setWidth(value)
    try { localStorage.setItem(storageKey, String(value)) } catch { /* Penyimpanan opsional. */ }
  }
  function drag(clientX: number) {
    const element = layout.current
    if (!element) return
    const bounds = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const left = parseFloat(style.paddingLeft)
    const available = bounds.width - left - parseFloat(style.paddingRight) - dividerWidth
    if (available > 0) change((clientX - bounds.left - left - dividerWidth / 2) / available * 100)
  }

  return <div ref={layout} className="sale-layout" data-resizing={resizing} style={{ '--sale-cart-share': `${panelWidth}fr`, '--sale-catalog-share': `${100 - panelWidth}fr` } as CSSProperties}>
    {panels[0]}
    <div className="sale-panel-divider" role="separator" tabIndex={0} aria-label="Atur lebar daftar belanja" aria-orientation="vertical" aria-valuemin={Math.floor(limits.minimum)} aria-valuemax={Math.ceil(limits.maximum)} aria-valuenow={Math.round(panelWidth)} aria-valuetext={`Daftar belanja ${Math.round(panelWidth)} persen`} title="Geser kiri/kanan atau gunakan tombol panah. Klik dua kali untuk mengembalikan ukuran." onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true)
    }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event.clientX) }} onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      setResizing(false)
    }} onPointerCancel={() => setResizing(false)} onLostPointerCapture={() => setResizing(false)} onDoubleClick={() => change(initialWidth)} onKeyDown={event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); change(panelWidth - 2) }
      if (event.key === 'ArrowRight') { event.preventDefault(); change(panelWidth + 2) }
      if (event.key === 'Home') { event.preventDefault(); change(limits.minimum) }
      if (event.key === 'End') { event.preventDefault(); change(limits.maximum) }
    }}><GripVertical aria-hidden="true" /></div>
    {panels[1]}
  </div>
}
