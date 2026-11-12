import type { LoginResult, MasterData } from './types'
import { VersionedCache } from './versioned-cache'
import { invalidateProducts } from './product-cache'

const baseURL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
const sessionKey = 'toko:login'
type StoredSession = Pick<LoginResult, 'access_token' | 'expires_at' | 'session_expires_at'> & {
  user_id: number
}
let generation = 0
let signedOut = false
let refreshing: Promise<StoredSession> | null = null
let channel: BroadcastChannel | undefined
function authChannel() {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' && !channel) {
    channel = new BroadcastChannel('toko:auth')
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'logout') clearSession(false, false)
      if (event.data === 'login') {
        clearSession(false, false)
        signedOut = false
        window.dispatchEvent(new Event('toko-auth-login'))
      }
    }
  }
  return channel
}
async function authLock<T>(work: () => Promise<T>): Promise<T> {
  authChannel()
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('toko:auth', work)
  }
  // Non-browser consumers and browsers without Web Locks still use single-flight per tab.
  return work()
}
export function configured() {
  return Boolean(baseURL)
}
export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}
export function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null
  authChannel()
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null')
    if (
      typeof session?.access_token !== 'string' ||
      session.access_token.split('.').length !== 3 ||
      !Number.isFinite(Date.parse(session.expires_at)) ||
      !Number.isFinite(Date.parse(session.session_expires_at)) ||
      !Number.isSafeInteger(session.user_id) ||
      session.user_id <= 0
    )
      return null
    // Keep an expired access token so API calls can recover through the refresh cookie.
    return session
  } catch {
    return null
  }
}
function storeSession(session: LoginResult): StoredSession {
  const stored: StoredSession = {
    access_token: session.access_token,
    expires_at: session.expires_at,
    session_expires_at: session.session_expires_at,
    user_id: session.user.id,
  }
  sessionStorage.setItem(sessionKey, JSON.stringify(stored))
  signedOut = false
  return stored
}
export function saveSession(session: LoginResult) {
  generation++
  masterCaches.clear()
  invalidateProducts()
  storeSession(session)
  authChannel()?.postMessage('login')
}
function clearSession(expired = false, broadcast = true) {
  generation++
  signedOut = true
  refreshing = null
  masterCaches.clear()
  invalidateProducts()
  sessionStorage.removeItem(sessionKey)
  window.dispatchEvent(new CustomEvent('toko-auth-logout', { detail: { expired } }))
  if (broadcast) authChannel()?.postMessage('logout')
}
async function request<T>(path: string, method: string, body: unknown, token?: string): Promise<T> {
  if (!baseURL) throw new Error('URL API belum dikonfigurasi.')
  const response = await fetch(`${baseURL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  })
  const result = await response.json().catch(() => null)
  if (!response.ok)
    throw new APIError(
      response.status,
      result?.error?.message ?? `Request gagal (${response.status}).`,
      result?.error?.code,
    )
  if (!result || !('data' in result)) throw new Error('Respons API tidak valid.')
  return result.data as T
}
export function publicAPI<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (method === 'POST' && (path === '/auth/login' || path === '/auth/register')) {
    return authLock(async () => {
      const result = await request<LoginResult>(path, method, body)
      saveSession(result)
      return result as T
    })
  }
  return request<T>(path, method, body)
}
async function refreshSession(notifyInvalid = true): Promise<StoredSession> {
  if (refreshing) return refreshing
  const started = generation
  const work = authLock(async () => {
    if (signedOut || started !== generation)
      throw new APIError(401, 'Sesi telah ditutup.', 'SESSION_INVALID')
    try {
      const result = await request<LoginResult>('/auth/refresh', 'POST', undefined)
      if (signedOut || started !== generation)
        throw new APIError(401, 'Sesi telah ditutup.', 'SESSION_INVALID')
      const previous = readSession()
      if (previous && previous.user_id !== result.user.id) {
        // Never replay a pending mutation under another account's cookie session.
        clearSession(false, false)
        storeSession(result)
        window.dispatchEvent(new Event('toko-auth-login'))
        throw new APIError(401, 'Akun telah berubah. Silakan ulangi tindakan.', 'SESSION_CHANGED')
      }
      return storeSession(result)
    } catch (err) {
      if (notifyInvalid && started === generation && err instanceof APIError && err.status === 401)
        clearSession(true)
      throw err
    }
  })
  refreshing = work
  try {
    return await work
  } finally {
    if (refreshing === work) refreshing = null
  }
}
async function ensureSession(): Promise<StoredSession> {
  const session = readSession()
  if (signedOut) throw new APIError(401, 'Sesi telah ditutup.', 'SESSION_INVALID')
  if (
    !session ||
    Date.parse(session.expires_at) <= Date.now() ||
    (Date.parse(session.expires_at) < Date.parse(session.session_expires_at) &&
      Date.parse(session.expires_at) <= Date.now() + 60000)
  )
    return refreshSession()
  return session
}
export async function restoreSession(): Promise<LoginResult['user']> {
  if (!readSession()) await refreshSession(false)
  else await ensureSession()
  return api<LoginResult['user']>('/me')
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let session = await ensureSession()
  const started = generation
  let result: T
  try {
    result = await request<T>(path, method, body, session.access_token)
  } catch (err) {
    if (started !== generation) throw err
    if (err instanceof APIError && err.status === 401 && err.code === 'ACCESS_TOKEN_EXPIRED') {
      // Another request may already have refreshed while this response was in flight.
      const current = readSession()
      session =
        current &&
        current.access_token !== session.access_token &&
        Date.parse(current.expires_at) > Date.now() + 60000
          ? current
          : await refreshSession()
      try {
        result = await request<T>(path, method, body, session.access_token)
      } catch (retryError) {
        if (retryError instanceof APIError && retryError.status === 401 && started === generation)
          clearSession(true)
        throw retryError
      }
    } else {
      if (err instanceof APIError && err.status === 401) clearSession(true)
      throw err
    }
  }
  if (
    ['POST', 'PUT', 'DELETE'].includes(method) &&
    (/^\/(produk|kategori|satuan|metode-pembayaran|sumber-pembelian)(\/\d+)?$/.test(path) ||
      /^\/produk\/\d+\/favorit$/.test(path))
  ) {
    for (const cache of masterCaches.values()) cache.clear()
    window.dispatchEvent(new Event('toko-master-updated'))
    try {
      localStorage.setItem('toko:master-updated', String(Date.now()))
    } catch {
      /* Optional tab sync. */
    }
  }
  return result
}
export async function logout() {
  // Invalidate pending refresh before waiting for the browser-wide auth lock.
  clearSession()
  await authLock(() => request('/auth/logout', 'POST', undefined))
}

export async function all<T>(path: string): Promise<T[]> {
  const result: T[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await api<T[]>(
      `${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`,
    )
    result.push(...page)
    if (page.length < 100) return result
    if (offset >= 999900)
      throw new Error('Data terlalu banyak; gunakan filter yang lebih spesifik.')
  }
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : 'Terjadi kesalahan. Silakan coba kembali.'
}

const masterCaches = new Map<string, VersionedCache<MasterData>>()
export async function masterData(checkVersion = false, force = false): Promise<MasterData> {
  const session = await ensureSession()
  if (!session) {
    clearSession(true)
    return Promise.reject(new APIError(401, 'Sesi berakhir. Silakan masuk kembali.'))
  }
  let cache = masterCaches.get(String(session.user_id))
  if (!cache) {
    cache = new VersionedCache(
      () => api<MasterData>('/master-data'),
      async () => (await api<{ version: string }>('/master-data/version')).version,
    )
    masterCaches.set(String(session.user_id), cache)
  }
  if (force) {
    // Muat ulang manual dapat membaca perubahan yang dilakukan langsung melalui SQL.
    for (const item of masterCaches.values()) item.clear()
    let firstLoad = true
    const forced = new VersionedCache(
      () => {
        const path = firstLoad ? '/master-data?refresh=true' : '/master-data'
        firstLoad = false
        return api<MasterData>(path)
      },
      async () => (await api<{ version: string }>('/master-data/version')).version,
    )
    masterCaches.set(String(session.user_id), forced)
    return forced.get()
  }
  return checkVersion ? cache.check() : cache.get()
}
