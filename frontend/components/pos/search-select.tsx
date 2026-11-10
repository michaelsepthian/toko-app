'use client'

import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { inputClass } from './common'

type Props = {
  children: ReactNode
  value: string | number
  onValueChange: (value: string) => void
  'aria-label': string
  required?: boolean
  disabled?: boolean
  className?: string
}

/** Pilihan bertampilan seragam dengan pencarian dan navigasi keyboard. */
export function SearchSelect({ children, value, onValueChange, 'aria-label': label, required, disabled, className = inputClass }: Props) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const options = Children.toArray(children).filter(isValidElement).map(child => {
    const props = child.props as { value?: string | number; children: ReactNode; disabled?: boolean }
    const text = Children.toArray(props.children).join('')
    return { value: String(props.value ?? text), label: text, disabled: props.disabled }
  })
  const selected = options.find(option => option.value === String(value))
  const filtered = options.filter(option => option.label.toLocaleLowerCase('id').includes(query.trim().toLocaleLowerCase('id')))
  const available = filtered.filter(option => !option.disabled)

  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus() }
  function choose(next: string, restore = true) {
    if (next !== String(value)) root.current?.dispatchEvent(new Event('toko-field-change', { bubbles: true }))
    onValueChange(next); close(restore); if (!restore) search.current?.blur()
  }
  function show() {
    if (disabled) return
    window.dispatchEvent(new Event('toko-close-popovers'))
    setQuery(''); setHighlight(Math.max(0, options.filter(option => !option.disabled).findIndex(option => option.value === String(value)))); setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    search.current?.focus()
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) { search.current?.blur(); close(false) } }
    function dismiss() { close(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('toko-close-popovers', dismiss)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('toko-close-popovers', dismiss) }
  }, [open])
  useEffect(() => {
    if (open) root.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight, query])

  return <div ref={root} className="search-select" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab' && open) { trigger.current?.focus(); close(false) }
  }} onBlur={event => { if (open && !root.current?.contains(event.relatedTarget as Node | null)) close(false) }}>
    <button ref={trigger} type="button" className={`${className} search-select-trigger`} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() }
      else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); show(); setQuery(event.key); setHighlight(0) }
    }}><span>{selected?.label || `Pilih ${label.toLowerCase()}`}</span><ChevronDown className="size-4 shrink-0" /></button>
    {required && <input aria-label={`${label} wajib dipilih`} className="search-select-validation" tabIndex={-1} value={value} required disabled={disabled} onChange={() => {}} onInvalid={event => { event.preventDefault(); show() }} />}
    {!required && <input type="hidden" value={value} readOnly />}
    {open && <div className="search-select-popup"><div className="search-select-search"><Search className="size-4" /><input ref={search} role="combobox" aria-label={`Cari ${label.toLowerCase()}`} aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={available[highlight] ? `${id}-option-${options.indexOf(available[highlight])}` : undefined} autoComplete="off" placeholder={`Cari ${label.toLowerCase()}…`} value={query} onChange={event => { setQuery(event.target.value); setHighlight(0) }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setHighlight(current => Math.max(0, Math.min(available.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))) }
      if (event.key === 'Enter') { event.preventDefault(); if (available[highlight]) choose(available[highlight].value) }
    }} /></div><div id={`${id}-list`} role="listbox" aria-label={label} className="search-select-options">
      {filtered.map(option => <button key={option.value} id={`${id}-option-${options.indexOf(option)}`} role="option" aria-selected={String(value) === option.value} type="button" tabIndex={-1} disabled={option.disabled} data-highlighted={available[highlight] === option} onMouseEnter={() => setHighlight(available.indexOf(option))} onMouseDown={event => event.preventDefault()} onClick={event => choose(option.value, event.detail === 0)}><span>{option.label}</span>{String(value) === option.value && <Check className="size-4" />}</button>)}
      {!filtered.length && <p className="p-3 text-sm text-muted-foreground">Tidak ada pilihan yang cocok.</p>}
    </div></div>}
  </div>
}
