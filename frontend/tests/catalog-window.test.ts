import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogOffsets, catalogWindow } from '../lib/catalog-window'

test('empty catalog has no mounted rows', () => {
  assert.deepEqual(catalogWindow(catalogOffsets(0, new Map()), 0, 600), { start: 0, end: 0 })
})

test('4275 products only mount rows around the viewport, including the last product', () => {
  const offsets = catalogOffsets(Math.ceil(4275 / 3), new Map())
  const first = catalogWindow(offsets, 0, 600)
  assert.equal(first.start, 0)
  assert.ok((first.end - first.start) * 3 <= 24)
  const middle = catalogWindow(offsets, 120000, 600)
  assert.ok(middle.start > 0)
  assert.ok((middle.end - middle.start) * 3 <= 30)
  const last = catalogWindow(offsets, offsets.at(-1)! - 600, 600)
  assert.equal(last.end, Math.ceil(4275 / 3))
})

test('long product names expand their row without overlapping the next row', () => {
  const offsets = catalogOffsets(4, new Map([[0, 320], [2, 450]]))
  assert.deepEqual(offsets, [0, 331, 532, 993, 1194])
  assert.deepEqual(catalogWindow(offsets, 600, 150, 0), { start: 2, end: 3 })
  assert.deepEqual(catalogWindow(offsets, 993, 1, 0), { start: 3, end: 4 })
})
