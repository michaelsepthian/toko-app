import test from 'node:test'
import assert from 'node:assert/strict'
import { sendCheckoutAttempt } from '../lib/checkout-attempt'
import { APIError } from '../lib/api'
import type { Transaction, TransactionInput } from '../lib/types'
const input: TransactionInput = {
  metode_pembayaran_id: 1,
  diskon_transaksi: '0',
  jumlah_dibayar: '10000',
  items: [{ produk_id: 2, jumlah: '1', diskon: '0' }],
}
const receipt = { id: 9, status: 'SELESAI' } as Transaction
function storage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

test('timeout keeps the request; retry after reload sends the same key and payload', async () => {
  const saved = storage()
  let pending: TransactionInput | null = null
  const requests: TransactionInput[] = []
  await assert.rejects(
    sendCheckoutAttempt(
      saved,
      'sale',
      input,
      async (body) => {
        assert.ok(saved.getItem('sale'), 'must persist before sending')
        requests.push(body)
        throw new DOMException('Timeout', 'TimeoutError')
      },
      (value) => {
        pending = value
      },
      () => 'same-transaction',
    ),
    /Timeout/,
  )
  assert.ok(pending)
  const result = await sendCheckoutAttempt(
    saved,
    'sale',
    undefined,
    async (body) => {
      requests.push(body)
      return receipt
    },
    (value) => {
      pending = value
    },
    () => {
      throw Error('retry must not generate a new ID')
    },
  )
  assert.equal(result, receipt)
  assert.deepEqual(requests[0], requests[1])
  assert.equal(saved.getItem('sale'), null)
  assert.equal(pending, null)
})

test('server failure retains the original body even if new input is passed on retry', async () => {
  const saved = storage()
  await assert.rejects(
    sendCheckoutAttempt(
      saved,
      'sale',
      input,
      async () => {
        throw new APIError(500, 'Server error')
      },
      () => {},
      () => 'original',
    ),
  )
  await sendCheckoutAttempt(
    saved,
    'sale',
    { ...input, jumlah_dibayar: '99999' },
    async (body) => {
      assert.equal(body.idempotency_key, 'original')
      assert.equal(body.jumlah_dibayar, '10000')
      return receipt
    },
    () => {},
  )
})

test('definitive initial rejection releases pending state so cashier can correct payment', async () => {
  const saved = storage()
  let pending: TransactionInput | null = null
  await assert.rejects(
    sendCheckoutAttempt(
      saved,
      'sale',
      input,
      async () => {
        throw new APIError(400, 'Invalid payment')
      },
      (value) => {
        pending = value
      },
      () => 'rejected',
    ),
  )
  assert.equal(saved.getItem('sale'), null)
  assert.equal(pending, null)
})

test('a rejection during an ambiguous retry never discards its pending identity', async () => {
  const saved = storage()
  saved.setItem('sale', JSON.stringify({ ...input, idempotency_key: 'unknown-result' }))
  await assert.rejects(
    sendCheckoutAttempt(
      saved,
      'sale',
      undefined,
      async () => {
        throw new APIError(409, 'Conflict')
      },
      () => {},
    ),
  )
  assert.equal(JSON.parse(saved.getItem('sale')!).idempotency_key, 'unknown-result')
})
