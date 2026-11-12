import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeHTML, totals, validLines } from '../lib/pos'
import { rawText } from '../lib/hardware'
import type { CartLine, Payment } from '../lib/types'

const lines: CartLine[] = [
  { product: {} as CartLine['product'], quantity: '0.333', price: '5', discount: '0' },
]
const method = { tarif_persen: '0.7', tarif_tetap: '0', penanggung_biaya: 'TOKO' } as Payment
test('subtotal detail mengikuti pembulatan PostgreSQL', () => {
  assert.equal(totals(lines, '0').subtotal.toFixed(2), '1.67')
})
test('biaya toko tidak menaikkan tagihan pelanggan', () => {
  const cart = [{ ...lines[0], quantity: '1', price: '10000' }]
  assert.equal(totals(cart, '0', method).total.toString(), '10000')
  assert.equal(totals(cart, '0', method).fee.toString(), '70')
  assert.equal(totals(cart, '0', method, true).total.toString(), '10070')
  assert.equal(
    totals(cart, '0', { ...method, penanggung_biaya: 'PELANGGAN' }).total.toString(),
    '10070',
  )
})
test('diskon dan presisi jumlah harus valid', () => {
  assert.equal(validLines(lines, '2'), false)
  assert.equal(validLines([{ ...lines[0], quantity: '0.3333' }]), false)
  assert.equal(validLines([{ ...lines[0], discount: '100' }]), false)
  assert.equal(validLines(lines), true)
})
test('nama produk tidak bisa menyisipkan HTML atau perintah printer', () => {
  assert.equal(escapeHTML('<script>"&'), '&lt;script&gt;&quot;&amp;')
  assert.equal(rawText('Beras\x1bp\x00\n'), 'Berasp')
})
