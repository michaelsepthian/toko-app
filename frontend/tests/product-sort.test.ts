import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProductOrder, sortProducts } from '../lib/product-sort'
import type { Product } from '../lib/types'
const product = (id: number, nama: string, harga_jual = '1000'): Product => ({
  id,
  nama,
  harga_jual,
  barcode: null,
  sku: String(id),
  aktif: true,
  kategori_id: 1,
  satuan_id: 1,
  stok_minimum: '0',
  is_favorit: false,
})
const products = [
  product(3, 'Gula 10', '10000.50'),
  product(2, 'Beras', '900.05'),
  product(1, 'Gula 2', '10000.49'),
]
const ids = (items: Product[]) => items.map((item) => item.id)

test('transaction frequency determines ordering independently of favorite flags', () => {
  const counts = new Map([
    [3, 20],
    [2, 8],
    [1, 1],
  ])
  assert.deepEqual(
    ids(
      sortProducts(
        products.map((p) => ({ ...p, is_favorit: p.id === 1 })),
        'recommended',
        counts,
      ),
    ),
    [3, 2, 1],
  )
  assert.deepEqual(ids(products), [3, 2, 1])
  assert.deepEqual(ids(sortProducts(products, 'recommended', counts)), [3, 2, 1])
})

test('no history and equal frequency use deterministic natural alphabetical ordering', () => {
  assert.deepEqual(ids(sortProducts(products, 'recommended', new Map())), [2, 1, 3])
  assert.deepEqual(ids(sortProducts(products, 'name-desc', new Map())), [3, 1, 2])
  assert.deepEqual(
    ids(sortProducts([product(2, 'Sama'), product(1, 'sama')], 'name-asc', new Map())),
    [1, 2],
  )
})

test('price sorting respects decimals and newest sorts by product ID', () => {
  assert.deepEqual(ids(sortProducts(products, 'price-asc', new Map())), [2, 1, 3])
  assert.deepEqual(ids(sortProducts(products, 'price-desc', new Map())), [3, 1, 2])
  assert.deepEqual(ids(sortProducts(products, 'newest', new Map())), [3, 2, 1])
})

test('stored preferences validate sorting and ignore legacy browser favorite IDs', () => {
  assert.deepEqual(parseProductOrder('{invalid'), { sort: 'recommended', favoritesFirst: false })
  assert.deepEqual(parseProductOrder('null'), { sort: 'recommended', favoritesFirst: false })
  assert.deepEqual(parseProductOrder('{"sort":"unknown","favorites":[1,1,"2",0,-1,2.1,null,3]}'), {
    sort: 'recommended',
    favoritesFirst: false,
  })
  assert.deepEqual(parseProductOrder('{"sort":"price-asc","favorites":[2]}'), {
    sort: 'price-asc',
    favoritesFirst: false,
  })
})

test('favorite priority keeps all products and composes with every sort without mutating the source', () => {
  const catalog = products.map((p) => ({ ...p, is_favorit: p.id !== 2 }))
  const counts = new Map([
    [3, 20],
    [2, 8],
    [1, 1],
  ])
  for (const [sort, expected] of [
    ['recommended', [3, 1, 2]],
    ['name-asc', [1, 3, 2]],
    ['name-desc', [3, 1, 2]],
    ['newest', [3, 1, 2]],
    ['price-asc', [1, 3, 2]],
    ['price-desc', [3, 1, 2]],
  ] as const) {
    assert.deepEqual(ids(sortProducts(catalog, sort, counts, true)), expected)
  }
  assert.deepEqual(ids(catalog), [3, 2, 1])
  assert.deepEqual(ids(sortProducts(products, 'recommended', counts, true)), [3, 2, 1])
  assert.deepEqual(ids(sortProducts(catalog, 'name-asc', counts, false)), [2, 1, 3])
})

test('favorite priority preference only accepts a boolean and preserves the chosen sort', () => {
  assert.deepEqual(parseProductOrder('{"sort":"price-desc","favoritesFirst":true}'), {
    sort: 'price-desc',
    favoritesFirst: true,
  })
  assert.deepEqual(parseProductOrder('{"sort":"newest","favoritesFirst":"false"}'), {
    sort: 'newest',
    favoritesFirst: false,
  })
})

test('secondary sorting applies within both favorite and regular product groups', () => {
  const catalog = [
    product(4, 'Z', '40'),
    product(2, 'B', '20'),
    product(3, 'C', '30'),
    product(1, 'A', '10'),
  ].map((p) => ({ ...p, is_favorit: p.id % 2 === 0 }))
  assert.deepEqual(ids(sortProducts(catalog, 'price-asc', new Map(), true)), [2, 4, 1, 3])
  assert.deepEqual(ids(sortProducts(catalog, 'name-desc', new Map(), true)), [4, 2, 3, 1])
})
