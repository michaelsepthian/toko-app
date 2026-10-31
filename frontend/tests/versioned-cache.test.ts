import test from 'node:test'
import assert from 'node:assert/strict'
import { VersionedCache } from '../lib/versioned-cache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('cache menggabungkan request serentak dan hanya mengambil master saat versi berubah', async () => {
  let loads = 0, checks = 0, version = '1'
  const cache = new VersionedCache(async () => { loads++; return { version, products: [] } }, async () => { checks++; return version })
  await Promise.all([cache.get(), cache.get(), cache.get()])
  await cache.get()
  assert.equal(loads, 1)
  await Promise.all([cache.check(), cache.check()])
  assert.equal(checks, 1)
  assert.equal(loads, 1)
  version = '2'
  assert.equal((await cache.check()).version, '2')
  assert.equal(loads, 2)
})

test('hasil request lama tidak menimpa data setelah invalidasi', async () => {
  const old = deferred<{ version: string }>()
  let calls = 0
  const cache = new VersionedCache(() => ++calls === 1 ? old.promise : Promise.resolve({ version: 'new' }), async () => 'new')
  const pending = cache.get()
  cache.clear()
  assert.equal((await cache.get()).version, 'new')
  old.resolve({ version: 'old' })
  assert.equal((await pending).version, 'new')
  assert.equal((await cache.get()).version, 'new')
  assert.equal(calls, 2)
})

test('kegagalan pemuatan tidak tersimpan di cache', async () => {
  let calls = 0
  const cache = new VersionedCache(async () => { if (++calls === 1) throw new Error('offline'); return { version: '1' } }, async () => '1')
  await assert.rejects(cache.get(), /offline/)
  assert.equal((await cache.get()).version, '1')
  assert.equal(calls, 2)
})

test('pemeriksaan versi lama tidak membuang snapshot baru', async () => {
  const oldCheck = deferred<string>()
  let version = '1', calls = 0
  const cache = new VersionedCache(async () => { calls++; return { version } }, () => oldCheck.promise)
  await cache.get()
  const pending = cache.check()
  cache.clear(); version = '2'
  await cache.get()
  oldCheck.resolve('1')
  assert.equal((await pending).version, '2')
  assert.equal(calls, 2)
})
