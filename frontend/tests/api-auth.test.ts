import test from 'node:test'
import assert from 'node:assert/strict'
import type { LoginResult } from '../lib/types'
class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  clear() {
    this.values.clear()
  }
}
const login = (name = 'initial', expires = Date.now() + 1800000): LoginResult => ({
  user: { id: 1, nama: 'Kasir', peran: 'KASIR' },
  access_token: `header.${name}.signature`,
  expires_at: new Date(expires).toISOString(),
  session_expires_at: new Date(Date.now() + 17 * 3600000).toISOString(),
})
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { data } : { error: data }), { status })
test('automatic JWT refresh and request recovery', async (t) => {
  const descriptors = new Map(
    ['window', 'sessionStorage', 'localStorage', 'BroadcastChannel', 'fetch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  )
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined })
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://api.test/api/v1'
  const { api, saveSession, readSession, restoreSession, logout } = await import('../lib/api')
  let refreshes = 0
  let calls: { path: string; init: RequestInit }[] = []
  let respond: (path: string, init: RequestInit) => Response | Promise<Response> = () =>
    json({ ok: true })
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.credentials, 'include')
    const path = String(url).replace('http://api.test/api/v1', '')
    calls.push({ path, init })
    if (path === '/auth/refresh') refreshes++
    return respond(path, init)
  }
  await t.test('concurrent expired requests share a refresh and retain POST body', async () => {
    saveSession(login('old', Date.now() - 1000))
    refreshes = 0
    calls = []
    respond = async (path) => {
      if (path === '/auth/refresh') {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return json(login('new'))
      }
      return json({ saved: true })
    }
    const body = { idempotency_key: 'same-key', items: [{ produk_id: 1, jumlah: '2' }] }
    await Promise.all([api('/penjualan', 'POST', body), api('/penjualan', 'POST', body)])
    assert.equal(refreshes, 1)
    for (const call of calls.filter((call) => call.path === '/penjualan')) {
      assert.equal(call.init.body, JSON.stringify(body))
      assert.equal(
        (call.init.headers as Record<string, string>).Authorization,
        'Bearer header.new.signature',
      )
    }
    assert.equal(readSession()?.access_token, 'header.new.signature')
  })
  await t.test('server expiry triggers one refresh and exactly one retry', async () => {
    saveSession(login())
    calls = []
    refreshes = 0
    let business = 0
    respond = (path) =>
      path === '/auth/refresh'
        ? json(login('renewed'))
        : ++business === 1
          ? json({ code: 'ACCESS_TOKEN_EXPIRED', message: 'expired' }, 401)
          : json({ saved: true })
    await api('/penjualan', 'POST', { idempotency_key: 'unchanged' })
    assert.equal(refreshes, 1)
    assert.equal(business, 2)
    assert.equal(calls[0].init.body, calls[2].init.body)
  })
  await t.test('second 401 stops instead of looping', async () => {
    saveSession(login())
    refreshes = 0
    let business = 0
    respond = (path) =>
      path === '/auth/refresh'
        ? json(login('renewed'))
        : (business++, json({ code: 'ACCESS_TOKEN_EXPIRED', message: 'expired' }, 401))
    await assert.rejects(api('/me'))
    assert.equal(refreshes, 1)
    assert.equal(business, 2)
    assert.equal(readSession(), null)
  })
  await t.test(
    'network and server failures preserve session; invalid refresh clears it',
    async () => {
      for (const status of [503, 0, 401]) {
        saveSession(login('old', Date.now() - 1000))
        respond = () => {
          if (!status) throw new TypeError('network unavailable')
          return json({ code: 'SESSION_INVALID', message: 'unavailable' }, status)
        }
        await assert.rejects(api('/me'))
        assert.equal(readSession() === null, status === 401)
      }
    },
  )
  await t.test('403 does not refresh; startup restores from cookie', async () => {
    saveSession(login())
    refreshes = 0
    respond = () => json({ message: 'forbidden' }, 403)
    await assert.rejects(api('/pengguna'))
    assert.equal(refreshes, 0)
    sessionStorage.clear()
    respond = (path) => (path === '/auth/refresh' ? json(login('restored')) : json(login().user))
    assert.equal((await restoreSession()).id, 1)
    assert.equal(refreshes, 1)
  })
  await t.test('pending mutations are not retried as a different cookie account', async () => {
    saveSession(login('old', Date.now() - 1000))
    calls = []
    const other = login('other')
    other.user.id = 2
    respond = () => json(other)
    await assert.rejects(api('/penjualan', 'POST', { idempotency_key: 'old-account' }))
    assert.equal(calls.filter((call) => call.path === '/penjualan').length, 0)
    assert.equal(readSession()?.user_id, 2)
  })
  await t.test('final minute of absolute session does not rotate on every request', async () => {
    const ending = login('ending', Date.now() + 30000)
    ending.session_expires_at = ending.expires_at
    saveSession(ending)
    refreshes = 0
    respond = () => json({ ok: true })
    await Promise.all([api('/me'), api('/me')])
    assert.equal(refreshes, 0)
  })
  await t.test('late refresh cannot restore session after logout', async () => {
    saveSession(login('old', Date.now() - 1000))
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    respond = (path) => (path === '/auth/refresh' ? pending : json({ logged_out: true }))
    const request = api('/me')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const rejected = assert.rejects(request)
    const signout = logout()
    release(json(login('late')))
    await Promise.all([rejected, signout])
    assert.equal(readSession(), null)
  })
})
