import type { LoginResult, MasterData } from './types'
import { VersionedCache } from './versioned-cache'

const baseURL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
const sessionKey = 'toko:login'
export function configured() { return Boolean(baseURL) }
export class APIError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export function readSession(): Pick<LoginResult, 'access_token' | 'expires_at'> | null {
  if (typeof window === 'undefined') return null
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null')
    if (typeof session?.access_token !== 'string' || !session.access_token.startsWith('toko_') || Date.parse(session.expires_at) <= Date.now() || !Number.isFinite(Date.parse(session.expires_at))) return null
    return session
  } catch { return null }
}
export function saveSession(session: LoginResult) {
  sessionStorage.setItem(sessionKey, JSON.stringify({ access_token: session.access_token, expires_at: session.expires_at }))
}
function clearSession(expired = false) {
  masterCaches.clear()
  sessionStorage.removeItem(sessionKey)
  window.dispatchEvent(new CustomEvent('toko-auth-logout', { detail: { expired } }))
}
async function request<T>(path: string, method: string, body: unknown, token?: string): Promise<T> {
  if (!baseURL) throw new Error('URL API belum dikonfigurasi.')
  const response = await fetch(`${baseURL}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000), cache: 'no-store',
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && token) clearSession(true)
    throw new APIError(response.status, result?.error?.message ?? `Request gagal (${response.status}).`)
  }
  if (!result || !('data' in result)) throw new Error('Respons API tidak valid.')
  return result.data as T
}
export function publicAPI<T>(path: string, method = 'GET', body?: unknown) { return request<T>(path, method, body) }
export function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const session = readSession()
  if (!session) { clearSession(true); return Promise.reject(new APIError(401, 'Sesi berakhir. Silakan masuk kembali.')) }
  return request<T>(path, method, body, session.access_token).then(result => {
    if (['POST', 'PUT', 'DELETE'].includes(method) && (/^\/(produk|kategori|satuan|metode-pembayaran|sumber-pembelian)(\/\d+)?$/.test(path) || /^\/produk\/\d+\/favorit$/.test(path))) {
      for (const cache of masterCaches.values()) cache.clear()
      window.dispatchEvent(new Event('toko-master-updated'))
      try { localStorage.setItem('toko:master-updated', String(Date.now())) } catch { /* Sinkronisasi tab opsional. */ }
    }
    return result
  })
}
export async function logout() { try { if (readSession()) await api('/auth/logout', 'POST') } finally { clearSession() } }
export async function all<T>(path: string): Promise<T[]> {
  const result: T[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await api<T[]>(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`)
    result.push(...page)
    if (page.length < 100) return result
    if (offset >= 999900) throw new Error('Data terlalu banyak; gunakan filter yang lebih spesifik.')
  }
}
export function message(error: unknown) { return error instanceof Error ? error.message : 'Terjadi kesalahan. Silakan coba kembali.' }


const masterCaches = new Map<string, VersionedCache<MasterData>>()
export function masterData(checkVersion = false, force = false): Promise<MasterData> {
  const session = readSession()
  if (!session) { clearSession(true); return Promise.reject(new APIError(401, 'Sesi berakhir. Silakan masuk kembali.')) }
  let cache = masterCaches.get(session.access_token)
  if (!cache) {
    cache = new VersionedCache(() => api<MasterData>('/master-data'), async () => (await api<{ version: string }>('/master-data/version')).version)
    masterCaches.set(session.access_token, cache)
  }
  if (force) {
    // Muat ulang manual dapat membaca perubahan yang dilakukan langsung melalui SQL.
    for (const item of masterCaches.values()) item.clear()
    let firstLoad = true
    const forced = new VersionedCache(() => { const path = firstLoad ? '/master-data?refresh=true' : '/master-data'; firstLoad = false; return api<MasterData>(path) }, async () => (await api<{ version: string }>('/master-data/version')).version)
    masterCaches.set(session.access_token, forced)
    return forced.get()
  }
  return checkVersion ? cache.check() : cache.get()
}
