import Decimal from 'decimal.js'
import { APIError } from './api'
import type { DailySnapshot, DailySummaryInput, DailySummaryRecord } from './types'

export function reconcileDailyCash(
  snapshot: Pick<DailySnapshot, 'total_selesai' | 'total_pembelian' | 'alokasi_sebelumnya'>,
  actual: string,
  tomorrow: string,
) {
  const totalExpected = new Decimal(snapshot.total_selesai)
    .plus(snapshot.alokasi_sebelumnya || 0)
    .minus(snapshot.total_pembelian || 0)
  const totalActual = new Decimal(actual || 0)
  return {
    totalExpected,
    totalActual,
    expected: totalExpected,
    difference: totalActual.minus(totalExpected),
    remaining: totalActual.minus(tomorrow || 0),
    expectedRemaining: totalExpected.minus(tomorrow || 0),
  }
}

export async function saveDailySummaryAttempt(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
  input: DailySummaryInput,
  send: (body: DailySummaryInput) => Promise<DailySummaryRecord>,
  onPending: (body: DailySummaryInput | null) => void,
) {
  const saved = storage.getItem(key)
  const body: DailySummaryInput = saved ? JSON.parse(saved) : input
  storage.setItem(key, JSON.stringify(body))
  onPending(body)
  try {
    const result = await send(body)
    storage.removeItem(key)
    onPending(null)
    return result
  } catch (err) {
    // Backend memeriksa key terlebih dahulu: konflik sumber berarti laporan ini belum tersimpan.
    const staleSource =
      err instanceof APIError &&
      err.status === 409 &&
      err.message.startsWith('Data transaksi berubah.')
    const obsoleteVersion =
      err instanceof APIError &&
      err.status === 400 &&
      err.message.startsWith('Perhitungan ringkasan diperbarui.')
    if (
      staleSource ||
      obsoleteVersion ||
      (!saved && err instanceof APIError && [400, 403, 404, 409].includes(err.status))
    ) {
      storage.removeItem(key)
      onPending(null)
    }
    throw err
  }
}
