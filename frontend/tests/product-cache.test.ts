import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProductPageCache } from '../lib/product-cache'
import type { ProductPage } from '../lib/types'

const page: ProductPage = { items: [], has_next: false, next_cursor: null, version: '1' }
test('page cache coalesces requests, expires, and isolates session/query/cursor keys', async () => {
  let now = 0,
    loads = 0
  const cache = new ProductPageCache(3, 30, () => now)
  const load = async () => {
    loads++
    return page
  }
  await Promise.all(Array.from({ length: 20 }, () => cache.get('session-a:query-a:page-1', load)))
  assert.equal(loads, 1)
  await cache.get('session-b:query-a:page-1', load)
  await cache.get('session-a:query-a:page-2', load)
  assert.equal(loads, 3)
  now = 31
  await cache.get('session-a:query-a:page-1', load)
  assert.equal(loads, 4)
})
test('LRU page cache stays bounded and does not cache failures', async () => {
  const cache = new ProductPageCache(2)
  let loads = 0
  const load = async () => {
    loads++
    return page
  }
  await cache.get('a', load)
  await cache.get('b', load)
  await cache.get('a', load)
  await cache.get('c', load)
  assert.equal(loads, 3)
  await cache.get('b', load)
  assert.equal(loads, 4)
  await assert.rejects(
    cache.get('error', async () => {
      throw new Error('network')
    }),
  )
  assert.equal(await cache.get('error', load), page)
})
test('clearing an in-flight cache cannot restore old data', async () => {
  const cache = new ProductPageCache()
  let release!: (page: ProductPage) => void
  const pending = cache.get(
    'a',
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  await Promise.resolve()
  cache.clear()
  const updated = { ...page, version: '2' }
  await cache.get('a', async () => updated)
  release(page)
  await pending
  assert.equal(await cache.get('a', async () => page), updated)
})

test('default page cache TTL is one hour', async () => {
  let now = 0,
    loads = 0
  const cache = new ProductPageCache(2, undefined, () => now)
  const load = async () => {
    loads++
    return page
  }
  await cache.get('a', load)
  now = 30 * 60 * 1000
  await cache.get('a', load)
  assert.equal(loads, 1)
  now = 60 * 60 * 1000
  await cache.get('a', load)
  assert.equal(loads, 2)
})

test('runtime TTL from backend overrides default without a frontend rebuild', async () => {
  let now = 0,
    loads = 0
  const cache = new ProductPageCache(2, undefined, () => now)
  const load = async () => {
    loads++
    return { ...page, cache_ttl_seconds: 7200 }
  }
  await cache.get('a', load)
  now = 3600000
  await cache.get('a', load)
  assert.equal(loads, 1)
  now = 7200000
  await cache.get('a', load)
  assert.equal(loads, 2)
  cache.clear()
  await cache.get('a', async () => {
    loads++
    return { ...page, cache_ttl_seconds: 60 }
  })
  now += 60000
  await cache.get('a', load)
  assert.equal(loads, 4)
})

test('invalid response TTL falls back to default and cannot cache indefinitely', async () => {
  for (const ttl of [0, -1, 1.5, Infinity, NaN, 31536001]) {
    let now = 0,
      loads = 0
    const cache = new ProductPageCache(2, undefined, () => now)
    const load = async () => {
      loads++
      return { ...page, cache_ttl_seconds: ttl }
    }
    await cache.get('a', load)
    now = 3600000
    await cache.get('a', load)
    assert.equal(loads, 2)
  }
})
