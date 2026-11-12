import { createUUID } from './uuid'
import { APIError } from './api'
import type { Transaction, TransactionInput } from './types'

type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// Persist before sending, so a timeout or refresh retries the exact same request.
export async function sendCheckoutAttempt(
  storage: AttemptStorage,
  key: string,
  input: TransactionInput | undefined,
  send: (body: TransactionInput) => Promise<Transaction>,
  onPending: (body: TransactionInput | null) => void,
  makeID: () => string = createUUID,
) {
  const saved = storage.getItem(key)
  const body: TransactionInput = saved
    ? JSON.parse(saved)
    : { ...input!, idempotency_key: makeID() }
  if (!body.items?.length) throw new Error('Tidak ada item transaksi.')
  storage.setItem(key, JSON.stringify(body))
  onPending(body)
  try {
    const result = await send(body)
    storage.removeItem(key)
    onPending(null)
    return result
  } catch (err) {
    // Only a fresh request with a definitive rejection may be edited/replaced.
    // A retry of an ambiguous request keeps its identity until confirmed.
    if (!saved && err instanceof APIError && [400, 403, 404, 409].includes(err.status)) {
      storage.removeItem(key)
      onPending(null)
    }
    throw err
  }
}
