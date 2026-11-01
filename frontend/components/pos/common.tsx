'use client'
import type { ReactNode } from 'react'
import { formatRupiahInput, parseRupiahInput } from '@/lib/rupiah-input'

export const inputClass = 'h-12 w-full rounded-xl border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50'
export function Field({ label, value, onChange, type = 'text', required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; disabled?: boolean }) {
  return <label className="flex flex-col gap-1.5 text-sm font-semibold">{label}<input className={inputClass} type={type === 'decimal' ? 'text' : type} inputMode={type === 'decimal' ? 'decimal' : undefined} value={value} required={required} disabled={disabled} onChange={e => { if (type !== 'decimal' || /^(\d+(?:\.\d*)?)?$/.test(e.target.value)) onChange(e.target.value) }} /></label>
}
export function RupiahField({ label, value, onChange, required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean }) {
  return <label className="flex flex-col gap-1.5 text-sm font-semibold">{label}<span className="flex h-12 items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40"><span aria-hidden="true" className="text-muted-foreground">Rp</span><input aria-label={label} className="h-full min-w-0 flex-1 bg-transparent text-base font-normal tabular-nums outline-none disabled:opacity-50" type="text" inputMode="decimal" placeholder="Masukkan nominal" value={formatRupiahInput(value)} required={required} disabled={disabled} onFocus={event => event.currentTarget.select()} onChange={event => {
    const input = event.currentTarget
    const next = parseRupiahInput(input.value)
    if (next === null) return
    const count = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/[^\d,]/g, '').length
    onChange(next)
    requestAnimationFrame(() => {
      if (document.activeElement !== input) return
      let position = 0, remaining = count
      while (position < input.value.length && remaining > 0) {
        if (/[\d,]/.test(input.value[position])) remaining--
        position++
      }
      input.setSelectionRange(position, position)
    })
  }} /></span></label>
}
export function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="rounded-3xl border bg-card p-5 shadow-sm"><h2 className="text-xl font-bold">{title}</h2>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}<div className="mt-5">{children}</div></section>
}
export function ErrorBox({ children }: { children: ReactNode }) { return children ? <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{children}</p> : null }
