import test from 'node:test'
import assert from 'node:assert/strict'
import { formatRupiahInput, parseRupiahInput } from '../lib/rupiah-input'

test('rupiah formatting preserves price precision and groups thousands', () => {
  for (const raw of ['', '0', '15000', '1000000', '15000.50', '15000.00', '15000.']) {
    assert.equal(parseRupiahInput(formatRupiahInput(raw)), raw)
  }
  assert.equal(formatRupiahInput('15000'), '15.000')
  assert.equal(formatRupiahInput('15000.50'), '15.000,50')
})

test('rupiah paste and digit deletion keep the correct amount', () => {
  assert.equal(parseRupiahInput('Rp 15.000'), '15000')
  assert.equal(parseRupiahInput('Rp 15.000,50'), '15000.50')
  assert.equal(parseRupiahInput('15.00'), '1500')
  assert.equal(parseRupiahInput(',5'), '0.5')
  for (const value of ['-15.000', '1e5', '15.000,123', 'abc'])
    assert.equal(parseRupiahInput(value), null)
})

test('leading zeroes do not change an amount or remove decimal fractions', () => {
  assert.equal(parseRupiahInput('00015.000'), '15000')
  assert.equal(parseRupiahInput('000,50'), '0.50')
  assert.equal(parseRupiahInput('000'), '0')
  assert.equal(parseRupiahInput('0'), '0')
  assert.equal(parseRupiahInput(''), '')
})
