'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { sendCheckoutAttempt } from './checkout-attempt'
import { checkoutStorageKey, type SaleSlot } from './sale-drafts'
import type { Transaction, TransactionInput } from './types'

type AttemptState = { pending: TransactionInput | null; busy: boolean; ready: boolean }
const emptyAttempt: AttemptState = { pending: null, busy: false, ready: false }

// Setiap tab memiliki state dan payload pending sendiri, termasuk saat jumlah tab berubah.
export function useCheckout(userID: number, kind: 'penjualan' | 'pembelian', slot: SaleSlot = 0) {
  const key = checkoutStorageKey(userID, kind, slot)
  const prefix = checkoutStorageKey(userID, kind)
  const [attempts, setAttempts] = useState<Record<string, AttemptState>>({})
  const locks = useRef(new Set<string>())
  const current = attempts[key] ?? emptyAttempt
  useEffect(() => {
    const loaded: Record<string, AttemptState> = {}
    try {
      for (let index = 0; index < sessionStorage.length; index++) {
        const storedKey = sessionStorage.key(index)
        if (
          !storedKey ||
          !(
            storedKey === prefix ||
            (storedKey.startsWith(`${prefix}:`) && /^\d+$/.test(storedKey.slice(prefix.length + 1)))
          )
        )
          continue
        try {
          loaded[storedKey] = {
            pending: JSON.parse(sessionStorage.getItem(storedKey) || 'null'),
            busy: false,
            ready: true,
          }
        } catch {
          /* Submit menampilkan error jika payload tersimpan rusak. */
        }
      }
    } catch {
      /* Error storage ditampilkan jika submit tidak dapat disimpan. */
    }
    setAttempts((previous) => ({
      ...loaded,
      ...previous,
      [key]: previous[key]?.busy
        ? previous[key]
        : (loaded[key] ?? { ...emptyAttempt, ready: true }),
    }))
  }, [key, prefix])

  function update(patch: Partial<AttemptState>) {
    setAttempts((previous) => ({
      ...previous,
      [key]: { ...(previous[key] ?? emptyAttempt), ...patch },
    }))
  }
  async function submit(input?: TransactionInput): Promise<Transaction | undefined> {
    if (locks.current.has(key)) return
    locks.current.add(key)
    update({ busy: true })
    try {
      return await sendCheckoutAttempt(
        sessionStorage,
        key,
        input,
        (body) => api<Transaction>(`/${kind}`, 'POST', body),
        (pending) => update({ pending }),
      )
    } finally {
      locks.current.delete(key)
      update({ busy: false })
    }
  }
  function canDiscard(other: SaleSlot) {
    const otherKey = checkoutStorageKey(userID, kind, other)
    if (locks.current.has(otherKey) || attempts[otherKey]?.busy || attempts[otherKey]?.pending)
      return false
    try {
      return sessionStorage.getItem(otherKey) === null
    } catch {
      return false
    }
  }
  function discard(other: SaleSlot) {
    if (!canDiscard(other)) return false
    const otherKey = checkoutStorageKey(userID, kind, other)
    setAttempts((previous) => {
      const next = { ...previous }
      delete next[otherKey]
      return next
    })
    return true
  }
  return {
    submit,
    canDiscard,
    discard,
    ...current,
    anyBusy: Object.values(attempts).some((attempt) => attempt.busy),
    pendingAt: (other: SaleSlot) =>
      attempts[checkoutStorageKey(userID, kind, other)]?.pending ?? null,
  }
}
