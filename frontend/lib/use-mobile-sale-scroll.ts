'use client'

import { useEffect, type RefObject } from 'react'

/** Collapse the page header before scrolling a nested mobile sales list. */
export function useMobileSaleScroll(rootRef: RefObject<HTMLDivElement | null>, active: boolean) {
  useEffect(() => {
    const root = rootRef.current
    const tabs = root?.querySelector<HTMLElement>('.mobile-cart-tabs')
    if (!active || !root || !tabs) return
    const mobile = window.matchMedia('(max-width: 1023px)')
    const measure = () => {
      if (mobile.matches)
        root.style.setProperty(
          '--sale-mobile-tabs-height',
          `${tabs.getBoundingClientRect().height}px`,
        )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(tabs)
    measure()
    mobile.addEventListener('change', measure)

    const listAt = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>('.sale-virtual-catalog, .sale-cart-body')
        : null
    const headerGap = () => Math.max(0, tabs.getBoundingClientRect().top)
    const movePage = (delta: number) => {
      const before = window.scrollY
      window.scrollBy({ top: delta, behavior: 'instant' })
      return window.scrollY - before
    }
    const scroll = (list: HTMLElement, delta: number) => {
      if (delta > 0) {
        const consumed = movePage(Math.min(delta, headerGap()))
        list.scrollTop += delta - consumed
      } else {
        const before = list.scrollTop
        list.scrollTop += delta
        const remaining = delta - (list.scrollTop - before)
        if (remaining < 0) movePage(remaining)
      }
    }
    const wheel = (event: WheelEvent) => {
      const list = listAt(event.target)
      if (
        !mobile.matches ||
        !list ||
        event.ctrlKey ||
        event.deltaY <= 0 ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        headerGap() <= 0 ||
        !event.cancelable
      )
        return
      event.preventDefault()
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1)
      scroll(list, delta)
    }

    let touch: { list: HTMLElement; x: number; y: number; captured: boolean } | null = null
    const start = (event: TouchEvent) => {
      const list = listAt(event.target)
      touch =
        mobile.matches && list && event.touches.length === 1
          ? { list, x: event.touches[0].clientX, y: event.touches[0].clientY, captured: false }
          : null
    }
    const move = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1 || !mobile.matches) {
        touch = null
        return
      }
      const point = event.touches[0]
      const delta = touch.y - point.clientY
      if (!touch.captured) {
        if (Math.abs(delta) < 6) return
        if (delta <= 0 || Math.abs(point.clientX - touch.x) > Math.abs(delta) || headerGap() <= 0) {
          touch = null
          return
        }
        touch.captured = true
      }
      if (!event.cancelable) {
        touch = null
        return
      }
      // Once a gesture is captured, finish that gesture ourselves: WebViews do
      // not consistently resume native list scrolling halfway through a swipe.
      event.preventDefault()
      scroll(touch.list, delta)
      touch.x = point.clientX
      touch.y = point.clientY
    }
    const end = () => {
      touch = null
    }
    root.addEventListener('wheel', wheel, { passive: false })
    root.addEventListener('touchstart', start, { passive: true })
    root.addEventListener('touchmove', move, { passive: false })
    root.addEventListener('touchend', end)
    root.addEventListener('touchcancel', end)
    return () => {
      observer.disconnect()
      mobile.removeEventListener('change', measure)
      root.removeEventListener('wheel', wheel)
      root.removeEventListener('touchstart', start)
      root.removeEventListener('touchmove', move)
      root.removeEventListener('touchend', end)
      root.removeEventListener('touchcancel', end)
    }
  }, [rootRef, active])
}
