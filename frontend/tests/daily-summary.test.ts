import test from 'node:test'
import assert from 'node:assert/strict'
import { APIError } from '../lib/api'
import { reconcileDailyCash, saveDailySummaryAttempt } from '../lib/daily-summary'
import type { DailySummaryInput, DailySummaryRecord } from '../lib/types'

test('cash reconciliation separates actual cash, mismatch and tomorrow allocation', () => {
  const result = reconcileDailyCash(
    { total_selesai: '300000', total_pembelian: '70000', alokasi_sebelumnya: '50000' },
    '279000',
    '350000',
  )
  assert.equal(result.totalExpected.toString(), '280000')
  assert.equal(result.totalActual.toString(), '279000')
  assert.equal(result.expected.toFixed(2), '280000.00')
  assert.equal(result.difference.toFixed(2), '-1000.00')
  assert.equal(result.expectedRemaining.toString(), '-70000')
  assert.equal(result.remaining.toFixed(2), '-71000.00')
  const zero = reconcileDailyCash({ total_selesai: '0', total_pembelian: '0' }, '0', '0')
  assert.equal(zero.remaining.toString(), '0')
})

test('daily report timeout retry retains its original counts and key', async () => {
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
  const input: DailySummaryInput = {
    idempotency_key: 'original',
    tanggal: '2026-01-02',
    hash_sumber: 'hash',
    nama_toko: 'Test',
    email_tujuan: '',
    kas_aktual: '100000',
    belanja_besok: '25000',
    catatan: '',
  }
  await assert.rejects(
    saveDailySummaryAttempt(
      storage,
      'summary',
      input,
      async () => {
        throw new APIError(500, 'timeout')
      },
      () => {},
    ),
  )
  await saveDailySummaryAttempt(
    storage,
    'summary',
    { ...input, kas_aktual: '1', idempotency_key: 'new' },
    async (body) => {
      assert.deepEqual(body, input)
      return { id: 1 } as DailySummaryRecord
    },
    () => {},
  )
  assert.equal(rows.size, 0)
  await assert.rejects(
    saveDailySummaryAttempt(
      storage,
      'summary',
      input,
      async () => {
        throw new APIError(409, 'Data transaksi berubah. Muat ulang ringkasan sebelum menyimpan')
      },
      () => {},
    ),
  )
  assert.equal(rows.size, 0)
  rows.set('summary', JSON.stringify(input))
  await assert.rejects(
    saveDailySummaryAttempt(
      storage,
      'summary',
      input,
      async () => {
        throw new APIError(
          400,
          'Perhitungan ringkasan diperbarui. Muat ulang halaman sebelum menyimpan',
        )
      },
      () => {},
    ),
  )
  assert.equal(rows.size, 0)
})
