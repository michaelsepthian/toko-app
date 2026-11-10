import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogColumns } from '../lib/catalog-layout'
import { catalogOffsets, catalogWindow } from '../lib/catalog-window'

test('catalog columns follow the available panel width, not a fixed desktop maximum', () => {
  for (const width of [0, -1, NaN, Infinity, 290, 390, 600]) assert.equal(catalogColumns(width), 2)
  assert.equal(catalogColumns(700), 3)
  assert.equal(catalogColumns(1000), 4)
  assert.equal(catalogColumns(1400), 6)
  assert.equal(catalogColumns(2100), 9)
  for (const width of [700, 1000, 1400, 2100, 3000]) {
    const columns = catalogColumns(width)
    const cardWidth = (width - 28 - (columns - 1) * 11) / columns
    assert.ok(cardWidth >= 216)
  }
})

test('wide catalog geometry still virtualizes all rows and reaches the final product', () => {
  for (const width of [1000, 1400, 2100, 3000]) {
    const columns = catalogColumns(width)
    const offsets = catalogOffsets(Math.ceil(4275 / columns), new Map())
    const first = catalogWindow(offsets, 0, 1900)
    assert.ok(first.end < offsets.length - 1)
    const last = catalogWindow(offsets, offsets.at(-1)! - 1900, 1900)
    assert.equal(last.end, Math.ceil(4275 / columns))
  }
})
