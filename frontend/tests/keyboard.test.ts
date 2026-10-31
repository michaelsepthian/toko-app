import test from 'node:test'
import assert from 'node:assert/strict'
import { exactProduct, groupedCash, isBarcodeQuery, isSearchCharacter } from '../lib/keyboard'
import type { Product } from '../lib/types'

test('ketikan biasa memulai pencarian tanpa mengambil shortcut browser', () => {
  const plain = { key:'b',ctrlKey:false,metaKey:false,altKey:false,isComposing:false }
  assert.equal(isSearchCharacter(plain),true)
  assert.equal(isSearchCharacter({ ...plain,key:'1' }),true)
  assert.equal(isSearchCharacter({ ...plain,ctrlKey:true }),false)
  assert.equal(isSearchCharacter({ ...plain,metaKey:true }),false)
  assert.equal(isSearchCharacter({ ...plain,key:' ' }),false)
  assert.equal(isSearchCharacter({ ...plain,isComposing:true }),false)
})
test('barcode tetap teks dan tidak memilih hasil fuzzy yang salah', () => {
  const product = { id:1,aktif:true,barcode:'0012345',sku:'BR-001',nama:'Beras' } as Product
  assert.equal(exactProduct([product],'0012345')?.id,1)
  assert.equal(exactProduct([product],'12345'),undefined)
  assert.equal(exactProduct([product],'br-001')?.id,1)
  assert.equal(exactProduct([{ ...product,aktif:false }],'0012345'),undefined)
  assert.equal(isBarcodeQuery('0012345'),true)
  assert.equal(isBarcodeQuery('beras'),false)
})
test('uang masuk ditampilkan dengan pemisah ribuan', () => {
  assert.equal(groupedCash('100000'),'100.000')
  assert.equal(groupedCash('100.000'),'100.000')
  assert.equal(groupedCash('25500'),'25.500')
})
