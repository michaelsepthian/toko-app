import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addSaleDraft,
  completeSaleDraft,
  checkoutStorageKey,
  emptySaleDrafts,
  parseSaleDrafts,
  removeSaleDraft,
  updateSaleDraft,
} from '../lib/sale-drafts'
import { sendCheckoutAttempt } from '../lib/checkout-attempt'
import { APIError } from '../lib/api'
import type { CartLine, Transaction, TransactionInput } from '../lib/types'
const line: CartLine = {
  product: {
    id: 1,
    nama: 'Gula',
    sku: '001',
    barcode: '001',
    harga_jual: '15000',
    stok_minimum: '0',
    kategori_id: 1,
    satuan_id: 1,
    aktif: true,
    is_favorit: false,
  },
  quantity: '2',
  price: '15000',
  discount: '0',
}

test('switching and refreshing preserve both independent carts and payment fields', () => {
  let state = addSaleDraft(emptySaleDrafts())
  state = updateSaleDraft(state, 0, {
    cart: [line],
    methodID: 1,
    paid: '50000',
    reference: 'pertama',
    print: true,
  })
  state = { ...state, active: 1 }
  state = updateSaleDraft(state, 1, {
    cart: [{ ...line, quantity: '3' }],
    methodID: 2,
    paid: '60000',
    reference: 'kedua',
  })
  const restored = parseSaleDrafts(JSON.stringify(state))
  assert.equal(restored.active, 1)
  assert.equal(restored.drafts[0].cart[0].quantity, '2')
  assert.equal(restored.drafts[0].paid, '50000')
  assert.equal(restored.drafts[0].methodID, 1)
  assert.equal(restored.drafts[0].print, true)
  assert.equal(restored.drafts[1].cart[0].quantity, '3')
  assert.equal(restored.drafts[1].reference, 'kedua')
  const cleared = updateSaleDraft(restored, 1, {
    cart: [],
    paid: '',
    reference: '',
    methodID: null,
  })
  assert.deepEqual(cleared.drafts[0], restored.drafts[0])
  assert.equal(cleared.drafts[1].cart.length, 0)
  assert.equal(restored.drafts[1].cart.length, 1)
})

test('corrupt saved cart data cannot crash amount rendering', () => {
  for (const text of [
    'null',
    '{}',
    '{bad',
    JSON.stringify({ ...emptySaleDrafts(), active: 3 }),
    JSON.stringify({ ...emptySaleDrafts(), drafts: [{ cart: [] }] }),
  ])
    assert.throws(() => parseSaleDrafts(text))
  const invalid = updateSaleDraft(emptySaleDrafts(), 0, { cart: [{ ...line, price: '' }] })
  assert.throws(() => parseSaleDrafts(JSON.stringify(invalid)))
  const duplicate = updateSaleDraft(emptySaleDrafts(), 0, { cart: [line, line] })
  assert.throws(() => parseSaleDrafts(JSON.stringify(duplicate)))
})

test('draft payment retries retain separate identities and preserve the legacy first-cart key', async () => {
  const rows = new Map<string, string>()
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value)
    },
    removeItem: (key: string) => {
      rows.delete(key)
    },
  }
  const firstKey = checkoutStorageKey(1, 'penjualan')
  const secondKey = checkoutStorageKey(1, 'penjualan', 1)
  assert.equal(firstKey, 'toko:pending:1:penjualan')
  assert.notEqual(firstKey, secondKey)
  assert.notEqual(firstKey, checkoutStorageKey(2, 'penjualan'))
  const first: TransactionInput = {
    metode_pembayaran_id: 1,
    diskon_transaksi: '0',
    jumlah_dibayar: '50000',
    items: [{ produk_id: 1, jumlah: '2', diskon: '0' }],
  }
  const second = {
    ...first,
    jumlah_dibayar: '100000',
    items: [{ produk_id: 2, jumlah: '1', diskon: '0' }],
  }
  await assert.rejects(
    sendCheckoutAttempt(
      storage,
      firstKey,
      first,
      async () => {
        throw new APIError(500, 'timeout')
      },
      () => {},
      () => 'first-id',
    ),
  )
  await sendCheckoutAttempt(
    storage,
    secondKey,
    second,
    async (body) => {
      assert.equal(body.items[0].produk_id, 2)
      assert.equal(body.idempotency_key, 'second-id')
      return { id: 2 } as Transaction
    },
    () => {},
    () => 'second-id',
  )
  assert.equal(rows.has(firstKey), true)
  assert.equal(rows.has(secondKey), false)
  await sendCheckoutAttempt(
    storage,
    firstKey,
    undefined,
    async (body) => {
      assert.equal(body.idempotency_key, 'first-id')
      assert.equal(body.items[0].produk_id, 1)
      return { id: 1 } as Transaction
    },
    () => {},
  )
  assert.equal(rows.size, 0)
})

test('dynamic transactions retain every cart and the selected tab after refresh', () => {
  let state = emptySaleDrafts()
  for (let slot = 0; slot < 12; slot++) {
    if (slot) state = addSaleDraft(state)
    state = updateSaleDraft(state, slot, {
      cart: [{ ...line, quantity: String(slot + 1) }],
      paid: String(50000 * (slot + 1)),
      reference: `customer-${slot}`,
    })
  }
  const restored = parseSaleDrafts(JSON.stringify(state))
  assert.equal(restored.active, 11)
  assert.equal(restored.drafts.length, 12)
  restored.drafts.forEach((draft, index) => {
    assert.equal(draft.cart[0].quantity, String(index + 1))
    assert.equal(draft.reference, `customer-${index}`)
  })
  assert.equal(
    new Set(restored.drafts.map((_, index) => checkoutStorageKey(1, 'penjualan', index))).size,
    12,
  )
  assert.equal(checkoutStorageKey(1, 'penjualan', 2), 'toko:pending:1:penjualan:3')
  const cleared = updateSaleDraft(restored, 7, { cart: [], paid: '', reference: '' })
  restored.drafts.forEach((draft, index) => {
    if (index !== 7) assert.deepEqual(cleared.drafts[index], draft)
  })
})

test('existing two-tab snapshots remain readable and new tabs do not overwrite them', () => {
  const first = updateSaleDraft(emptySaleDrafts(), 0, { cart: [line], paid: '50000' })
  const old = {
    version: 1,
    active: 1,
    drafts: [first.drafts[0], { ...first.drafts[0], reference: 'second' }],
  }
  const restored = parseSaleDrafts(JSON.stringify(old))
  const added = addSaleDraft(restored)
  assert.equal(added.active, 2)
  assert.equal(added.drafts[0].paid, old.drafts[0].paid)
  assert.equal(added.drafts[1].reference, 'second')
  assert.deepEqual(
    added.drafts.map((draft) => draft.id),
    [0, 1, 2],
  )
  assert.equal(added.drafts[2].cart.length, 0)
  assert.equal(restored.drafts.length, 2)
  assert.throws(() => updateSaleDraft(restored, 99, {}))
})

test('closing a middle tab keeps the selected cart and its payment identity', () => {
  let state = emptySaleDrafts()
  for (let index = 0; index < 3; index++) {
    if (index) state = addSaleDraft(state)
    state = updateSaleDraft(state, index, {
      cart: [{ ...line, quantity: String(index + 1) }],
      paid: String((index + 1) * 50000),
    })
  }
  const originalKey = checkoutStorageKey(1, 'penjualan', state.drafts[2].id)
  const removed = removeSaleDraft(state, 1)
  assert.equal(removed.active, 1)
  assert.equal(removed.drafts[removed.active].cart[0].quantity, '3')
  assert.equal(checkoutStorageKey(1, 'penjualan', removed.drafts[removed.active].id), originalKey)
  assert.deepEqual(
    removed.drafts.map((draft) => draft.id),
    [0, 2],
  )
  assert.equal(state.drafts.length, 3)
  const restored = parseSaleDrafts(JSON.stringify(removed))
  const added = addSaleDraft(restored)
  assert.deepEqual(
    added.drafts.map((draft) => draft.id),
    [0, 2, 3],
  )
  assert.equal(
    new Set(added.drafts.map((draft) => checkoutStorageKey(1, 'penjualan', draft.id))).size,
    3,
  )
})

test('closing tabs preserves selection and the sole remaining transaction cannot be removed', () => {
  const state = addSaleDraft(addSaleDraft(emptySaleDrafts()))
  assert.equal(removeSaleDraft(state, 2).active, 1)
  const selectedFirst = { ...state, active: 0 }
  assert.equal(removeSaleDraft(selectedFirst, 2).active, 0)
  const selectedMiddle = { ...state, active: 1 }
  assert.equal(removeSaleDraft(selectedMiddle, 1).drafts[1].id, 2)
  const filled = updateSaleDraft(emptySaleDrafts(), 0, {
    cart: [line],
    paid: '100000',
    print: true,
  })
  const lastClosed = removeSaleDraft(filled, 0)
  assert.strictEqual(lastClosed, filled)
  assert.equal(lastClosed.drafts.length, 1)
  assert.equal(lastClosed.drafts[0].cart.length, 1)
  assert.equal(lastClosed.drafts[0].paid, '100000')
  assert.equal(lastClosed.drafts[0].print, true)
  assert.equal(lastClosed.nextId, filled.nextId)
  assert.throws(() => removeSaleDraft(state, -1))
})

test('saved stable IDs must be unique and cannot be reused after closing a tab', () => {
  const state = addSaleDraft(emptySaleDrafts())
  assert.throws(() => parseSaleDrafts(JSON.stringify({ ...state, nextId: 0 })))
  assert.throws(() =>
    parseSaleDrafts(JSON.stringify({ ...state, drafts: [state.drafts[0], state.drafts[0]] })),
  )
})

test('main transaction cannot be closed even when other transactions exist', () => {
  const state = updateSaleDraft(addSaleDraft(emptySaleDrafts()), 0, {
    cart: [line],
    methodID: 2,
    paid: '50000',
  })
  assert.strictEqual(removeSaleDraft(state, 0), state)
  assert.equal(state.drafts.length, 2)
})

test('confirmed additional payment closes only the paid tab and returns to intact main', () => {
  let state = updateSaleDraft(emptySaleDrafts(), 0, {
    cart: [line],
    methodID: 2,
    paid: '50000',
    reference: 'main-reference',
    print: true,
  })
  state = addSaleDraft(state)
  state = updateSaleDraft(state, 1, { cart: [{ ...line, quantity: '3' }] })
  const paidID = state.drafts[1].id
  state = addSaleDraft(state)
  state = updateSaleDraft(state, 2, { cart: [{ ...line, quantity: '4' }] })
  const completed = completeSaleDraft(state, paidID)
  assert.equal(completed.active, 0)
  assert.equal(completed.drafts.length, 2)
  assert.deepEqual(completed.drafts[0], state.drafts[0])
  assert.deepEqual(completed.drafts[1], state.drafts[2])
  assert.equal(
    completed.drafts.some((draft) => draft.id === paidID),
    false,
  )
  assert.deepEqual(parseSaleDrafts(JSON.stringify(completed)), completed)
  assert.strictEqual(completeSaleDraft(completed, paidID), completed)
})

test('confirmed main payment clears its cart while retaining the main tab and parked carts', () => {
  let state = updateSaleDraft(emptySaleDrafts(), 0, {
    cart: [line],
    methodID: 2,
    paid: '50000',
    reference: 'paid-main',
  })
  state = addSaleDraft(state)
  state = updateSaleDraft(state, 1, { cart: [{ ...line, quantity: '7' }] })
  const completed = completeSaleDraft(state, state.drafts[0].id)
  assert.equal(completed.drafts.length, 2)
  assert.equal(completed.active, 0)
  assert.equal(completed.drafts[0].id, state.drafts[0].id)
  assert.equal(completed.drafts[0].cart.length, 0)
  assert.equal(completed.drafts[0].paid, '')
  assert.equal(completed.drafts[0].methodID, null)
  assert.deepEqual(completed.drafts[1], state.drafts[1])
})

test('income dates remain independent per cart, survive reload, and reset after confirmed payment', () => {
  let state = updateSaleDraft(emptySaleDrafts(), 0, { cart: [line], incomeDate: '2026-10-29' })
  state = addSaleDraft(state)
  state = updateSaleDraft(state, 1, { cart: [line], incomeDate: '2026-10-30' })
  const restored = parseSaleDrafts(JSON.stringify(state))
  assert.equal(restored.drafts[0].incomeDate, '2026-10-29')
  assert.equal(restored.drafts[1].incomeDate, '2026-10-30')
  const completed = completeSaleDraft(restored, restored.drafts[0].id)
  assert.equal(completed.drafts[0].incomeDate, '')
  assert.equal(completed.drafts[1].incomeDate, '2026-10-30')
  assert.throws(() =>
    parseSaleDrafts(JSON.stringify(updateSaleDraft(state, 0, { incomeDate: '2026-02-31' }))),
  )
  const legacy = emptySaleDrafts()
  delete legacy.drafts[0].incomeDate
  assert.equal(parseSaleDrafts(JSON.stringify(legacy)).drafts[0].cart.length, 0)
})

test('ambiguous checkout retry cannot silently change its income date', async () => {
  const rows = new Map<string, string>()
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value)
    },
    removeItem: (key: string) => {
      rows.delete(key)
    },
  }
  const input: TransactionInput = {
    tanggal_pendapatan: '2026-10-30',
    metode_pembayaran_id: 1,
    diskon_transaksi: '0',
    jumlah_dibayar: '50000',
    items: [{ produk_id: 1, jumlah: '1', diskon: '0' }],
  }
  await assert.rejects(
    sendCheckoutAttempt(
      storage,
      'income',
      input,
      async () => {
        throw new APIError(500, 'timeout')
      },
      () => {},
      () => 'income-id',
    ),
  )
  await sendCheckoutAttempt(
    storage,
    'income',
    { ...input, tanggal_pendapatan: '2026-11-01' },
    async (body) => {
      assert.equal(body.tanggal_pendapatan, '2026-10-30')
      assert.equal(body.idempotency_key, 'income-id')
      return { id: 1 } as Transaction
    },
    () => {},
  )
})
