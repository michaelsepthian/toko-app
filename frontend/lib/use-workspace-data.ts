'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, masterData, message } from './api'
import { invalidateProducts } from './product-cache'
import type { Data, Stock } from './types'

const initialData: Data = {
  categories: [],
  units: [],
  payments: [],
  sources: [],
  stocks: [],
}

/** Sinkronisasi master dan stok; state navigasi dan perangkat tetap di workspace. */
export function useWorkspaceData(owner: boolean, purchasesActive: boolean) {
  const [data, setData] = useState<Data>(initialData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const masterVersion = useRef<string | null>(null)
  const masterChangePending = useRef(false)

  const refresh = useCallback(async (checkVersion = false, force = false) => {
    if (!checkVersion) {
      setLoading(true)
      setError('')
    }

    try {
      const masters = await masterData(checkVersion, force)
      const catalogChanged =
        force ||
        masterChangePending.current ||
        (masterVersion.current !== null && masterVersion.current !== masters.version)

      // Refresh lokal dan pemeriksaan versi dapat selesai bersamaan.
      // Acknowledge sebelum invalidasi agar halaman katalog hanya direset sekali.
      masterChangePending.current = false
      masterVersion.current = masters.version
      if (catalogChanged) invalidateProducts()

      setData((previous) =>
        previous.categories === masters.categories &&
        previous.units === masters.units &&
        previous.payments === masters.payments &&
        previous.sources === masters.sources
          ? previous
          : { ...previous, ...masters },
      )
    } catch (err) {
      // Mutasi berhasil tetap harus memperbarui katalog meski fetch master gagal.
      if (masterChangePending.current) {
        masterChangePending.current = false
        invalidateProducts()
      }
      setError(`Gagal memuat data: ${message(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshStocks = useCallback(async () => {
    if (!owner) return

    try {
      const stocks = await api<Stock[]>('/stok/ringkasan')
      setData((previous) => ({ ...previous, stocks }))
    } catch (err) {
      setError(`Gagal memuat stok: ${message(err)}`)
    }
  }, [owner])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (purchasesActive) void refreshStocks()
  }, [purchasesActive, refreshStocks])

  useEffect(() => {
    const update = () => {
      masterChangePending.current = true
      void refresh()
    }
    const check = () => {
      if (document.visibilityState === 'visible') void refresh(true)
    }
    const storage = (event: StorageEvent) => {
      if (event.key === 'toko:master-updated') check()
    }

    // Pemeriksaan berkala hanya mengunduh master ketika versinya berubah.
    const interval = window.setInterval(check, 30000)
    window.addEventListener('focus', check)
    window.addEventListener('storage', storage)
    window.addEventListener('toko-master-updated', update)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener('storage', storage)
      window.removeEventListener('toko-master-updated', update)
    }
  }, [refresh])

  return { data, loading, error, setError, refresh, refreshStocks }
}
