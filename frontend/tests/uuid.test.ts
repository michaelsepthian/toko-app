import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { createUUID } from '../lib/uuid'

test('UUID generation works without randomUUID, as on an HTTP origin', (t) => {
  t.mock.getter(
    globalThis,
    'crypto',
    () =>
      ({
        getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      }) as Crypto,
  )
  const ids = Array.from({ length: 1000 }, () => createUUID())
  for (const id of ids)
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(new Set(ids).size, ids.length)
})

test('uses native randomUUID when available', (t) => {
  const id = '12345678-1234-4123-8123-123456789abc'
  t.mock.getter(globalThis, 'crypto', () => ({ randomUUID: () => id }) as Crypto)
  assert.equal(createUUID(), id)
})
