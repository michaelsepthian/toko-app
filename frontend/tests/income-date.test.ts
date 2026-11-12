import test from 'node:test'
import assert from 'node:assert/strict'
import { incomeDateLabel, validIncomeDate } from '../lib/income-date'

test('income dates validate real calendar days and format without shifting WIB', () => {
  for (const day of ['2026-11-01', '2024-02-29', '0001-01-01'])
    assert.equal(validIncomeDate(day), true)
  for (const day of [
    '',
    '2026-02-29',
    '2026-02-31',
    '2026-13-01',
    '2026-1-01',
    '0000-01-01',
    '2026-11-01T00:00:00Z',
  ])
    assert.equal(validIncomeDate(day), false)
  assert.equal(incomeDateLabel('2026-10-31'), '31 Oktober 2026')
})
