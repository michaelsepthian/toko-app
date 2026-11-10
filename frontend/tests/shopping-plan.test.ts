import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarDays, shiftShoppingMonth, shoppingDateLabel, shoppingQuantity } from '../lib/shopping-plan'

test('calendar always shows six complete Monday-first weeks including leap day', () => {
  const days = calendarDays('2028-02')
  assert.equal(days.length, 42)
  assert.equal(new Date(`${days[0]}T00:00:00Z`).getUTCDay(), 1)
  assert.equal(new Date(`${days[41]}T00:00:00Z`).getUTCDay(), 0)
  assert.ok(days.includes('2028-02-29'))
  assert.equal(new Set(days).size, 42)
})

test('month navigation crosses years without overflowing the selected day', () => {
  assert.equal(shiftShoppingMonth('2026-12', 1), '2027-01-01')
  assert.equal(shiftShoppingMonth('2026-01', -1), '2025-12-01')
  assert.match(shoppingDateLabel('2026-11-10'), /Selasa.*10 November 2026/)
})

test('quantity and unit are hidden together when quantity is absent or not positive', () => {
  assert.equal(shoppingQuantity({ jumlah: null, satuan: 'kg' }), null)
  assert.equal(shoppingQuantity({ jumlah: '0', satuan: 'kg' }), null)
  assert.equal(shoppingQuantity({ jumlah: '-1', satuan: 'kg' }), null)
  assert.equal(shoppingQuantity({ jumlah: '2.500', satuan: 'kg' }), '2,5 kg')
  assert.equal(shoppingQuantity({ jumlah: '5', satuan: '' }), '5')
})
