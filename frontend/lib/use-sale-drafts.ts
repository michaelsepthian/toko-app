'use client'
import { useEffect, useRef, useState } from 'react'
import { addSaleDraft, completeSaleDraft, emptySaleDrafts, parseSaleDrafts, removeSaleDraft, updateSaleDraft, type SaleDraft, type SaleDrafts, type SaleSlot } from './sale-drafts'

export function useSaleDrafts(userID: number) {
  const key = `toko:sale-drafts:${userID}`
  const legacyKey = `toko:legacy-sale-draft:${userID}`
  const [state, setState] = useState<SaleDrafts>(emptySaleDrafts)
  const current = useRef(state)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [storageError, setStorageError] = useState('')
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key)
      const legacy = sessionStorage.getItem(legacyKey)
      const restored = saved ? parseSaleDrafts(saved) : legacy ? parseSaleDrafts(JSON.stringify({ version: 1, active: 0, drafts: [JSON.parse(legacy)] })) : emptySaleDrafts()
      current.current = restored; setState(restored)
      sessionStorage.setItem(key, JSON.stringify(restored))
      sessionStorage.removeItem(legacyKey)
    } catch {
      setStorageError('Keranjang tersimpan tidak bisa dipulihkan. Periksa isinya sebelum melanjutkan; penyimpanan otomatis berikutnya akan memakai keranjang yang tampil.')
    }
    readyRef.current = true; setReady(true)
  }, [key, legacyKey])

  function commit(next: SaleDrafts) {
    if (!readyRef.current) return
    current.current = next; setState(next)
    try { sessionStorage.setItem(key, JSON.stringify(next)); setStorageError('') }
    catch { setStorageError('Penyimpanan browser tidak tersedia. Biarkan halaman terbuka agar keranjang tetap tersimpan.') }
  }
  function update(patch: Partial<Omit<SaleDraft, 'id'>>) { commit(updateSaleDraft(current.current, state.active, patch)) }
  function select(slot: SaleSlot) {
    if (Number.isSafeInteger(slot) && slot >= 0 && slot < current.current.drafts.length) commit({ ...current.current, active: slot })
  }
  function add() { commit(addSaleDraft(current.current)) }
  function close(slot: SaleSlot) { const next = removeSaleDraft(current.current, slot); commit(next); return next }
  function complete(id: number) { const next = completeSaleDraft(current.current, id); commit(next); return next }

  return { ...state, draft: state.drafts[state.active], ready, storageError, update, select, add, close, complete }
}
