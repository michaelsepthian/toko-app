'use client'

import { useEffect, type RefObject } from 'react'

const actionHashes = new Set([
  '#source-editor',
  '#payment-editor',
  '#user-editor',
  '#stock-adjustment',
])

export function clearActionHash() {
  if (
    window.location.hash &&
    (actionHashes.has(window.location.hash) || window.location.href.endsWith('#'))
  ) {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    )
  }
}

/** Animate existing content, never remount transaction/draft state to animate a tab. */
export function useContentMotion(ref: RefObject<HTMLElement | null>, value: unknown) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Keep sticky/fixed elements anchored while the workspace is transitioning.
    const animation = ref.current?.animate?.([{ opacity: 0.45 }, { opacity: 1 }], {
      duration: 200,
      easing: 'ease-out',
    })
    return () => animation?.cancel()
  }, [ref, value])
}

/** Only transient menus participate; expandable report contents are left alone. */
export function useDismissInteractions() {
  useEffect(() => {
    const menus = () =>
      document.querySelectorAll<HTMLDetailsElement>(
        '.pos-more[open], .shopping-item-menu[open], .sale-shortcuts[open], .sale-product-options[open]',
      )
    function outside(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      for (const menu of menus()) if (!menu.contains(target)) menu.open = false
      const focused = document.activeElement
      if (
        focused instanceof HTMLElement &&
        focused.matches('button, summary') &&
        !focused.contains(target)
      )
        focused.blur()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      for (const menu of menus()) {
        menu.open = false
        menu.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])
}
