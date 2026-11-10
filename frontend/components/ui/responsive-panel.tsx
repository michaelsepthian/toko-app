'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './button'
import { clearActionHash } from '@/lib/ui-interactions'

let scrollLocks = 0
let previousOverflow = ''

function formValues(node: HTMLElement) {
  return JSON.stringify(Array.from(node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')).map(input => input instanceof HTMLInputElement && ['checkbox', 'radio'].includes(input.type) ? input.checked : input.value))
}

/** Native modal focus trapping, shared responsive presentation and exit lifecycle. */
export function ResponsivePanel({ open, onClose, title, children, busy = false, dirty, className = '', closeLabel }: { open: boolean; onClose: () => void; title: string; children: ReactNode; busy?: boolean; dirty?: boolean; className?: string; closeLabel?: string }) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [present, setPresent] = useState(open)
  const baseline = useRef('')
  const changed = useRef(false)
  const pointerStartedOutside = useRef(false)
  const requestClose = () => {
    if (busy) return
    if ((dirty ?? changed.current) && !window.confirm('Tutup panel? Isian belum disimpan.')) return
    clearActionHash(); onClose()
  }

  useEffect(() => {
    if (open) { setPresent(true); return }
    const timeout = window.setTimeout(() => setPresent(false), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200)
    return () => window.clearTimeout(timeout)
  }, [open])

  useEffect(() => {
    if (!present || !dialog.current) return
    const node = dialog.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (scrollLocks++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
    changed.current = false
    window.dispatchEvent(new Event('toko-close-popovers'))
    node.showModal()
    ;(node.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ?? node.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea:not([disabled])') ?? node.querySelector<HTMLElement>('.responsive-panel-title'))?.focus({ preventScroll: true })
    baseline.current = formValues(node)
    const fieldChanged = () => { changed.current = true }
    node.addEventListener('toko-field-change', fieldChanged)
    clearActionHash()
    const viewport = window.visualViewport
    function resize() {
      node.style.setProperty('--panel-viewport', `${viewport?.height ?? window.innerHeight}px`)
      node.style.setProperty('--panel-keyboard', `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`)
    }
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize)
    return () => {
      node.close()
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize)
      node.removeEventListener('toko-field-change', fieldChanged)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [present])

  if (!present) return null
  return <dialog ref={dialog} className={`responsive-panel ${className}`} data-state={open ? 'open' : 'closing'} aria-labelledby={id} aria-busy={busy} onCancel={event => { event.preventDefault(); requestClose() }} onPointerDown={event => { pointerStartedOutside.current = event.target === event.currentTarget }} onClick={event => { if (pointerStartedOutside.current && event.target === event.currentTarget) requestClose(); pointerStartedOutside.current = false }} onChangeCapture={() => { if (dialog.current) changed.current = formValues(dialog.current) !== baseline.current }}>
    <div className="responsive-panel-surface" inert={!open}>
      <div className="responsive-panel-handle" aria-hidden="true" />
      <div className="responsive-panel-heading"><h2 id={id} className="responsive-panel-title" tabIndex={-1}>{title}</h2><Button type="button" size="icon" variant="ghost" aria-label={closeLabel ?? `Tutup ${title}`} disabled={busy} onClick={requestClose}><X /></Button></div>
      <div className="responsive-panel-body">{children}</div>
    </div>
  </dialog>
}
