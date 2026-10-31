import test from 'node:test'
import assert from 'node:assert/strict'
import { jakartaDay } from '../lib/history-date'

test('tanggal riwayat mengikuti tengah malam WIB', () => {
  assert.equal(jakartaDay(new Date('2026-10-28T16:59:59Z')), '2026-10-28')
  assert.equal(jakartaDay(new Date('2026-10-28T17:00:00Z')), '2026-10-29')
})
test('tanggal WIB benar saat pergantian tahun dan hari kabisat', () => {
  assert.equal(jakartaDay(new Date('2026-12-31T18:00:00Z')), '2027-01-01')
  assert.equal(jakartaDay(new Date('2024-02-28T17:00:00Z')), '2024-02-29')
})
