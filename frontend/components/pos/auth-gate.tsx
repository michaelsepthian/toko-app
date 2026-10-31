'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { api, configured, message, publicAPI, readSession, saveSession } from '@/lib/api'
import type { LoginResult, SetupStatus, User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { ErrorBox, Field } from './common'

export function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [setup, setSetup] = useState<SetupStatus | null>(null)
  const [register, setRegister] = useState(false)
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!configured()) { setLoading(false); return }
    let active = true
    void publicAPI<SetupStatus>('/setup').then(status => { if (active) { setSetup(status); setRegister(status.registration_open) } }).catch(err => { if (active) setError(message(err)) })
    if (readSession()) {
      void api<User>('/me').then(value => { if (active) setUser(value) }).catch(err => { if (active) setError(message(err)) }).finally(() => { if (active) setLoading(false) })
    } else setLoading(false)
    const signedOut = (event: Event) => {
      setUser(null); setLoading(false); setRegister(false)
      if ((event as CustomEvent).detail?.expired) setError('Sesi berakhir. Silakan masuk kembali.')
    }
    window.addEventListener('toko-auth-logout', signedOut)
    return () => { active = false; window.removeEventListener('toko-auth-logout', signedOut) }
  }, [])

  if (!configured()) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-bold">Konfigurasi koneksi diperlukan</h1><p className="mt-4">Isi NEXT_PUBLIC_API_BASE_URL pada .env.local, lalu mulai ulang frontend.</p></main>
  if (loading) return <main className="p-12 text-center" role="status">Menghubungkan akun kasir…</main>
  if (user) return <>{children(user)}</>
  return <main className="flex min-h-screen items-center justify-center bg-background p-4"><section className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-sm">
    <h1 className="text-3xl font-black">Kasir Toko Suhartini</h1>
    <h2 className="mt-4 text-xl font-bold">{register ? 'Registrasi' : 'Masuk'}</h2>
    <p className="my-3 text-sm text-muted-foreground">{register ? 'Buat username dan password untuk pemilik toko.' : 'Gunakan username dan password akun kasir.'}</p>
    <ErrorBox>{error}</ErrorBox>
    <form className="mt-5 space-y-4" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('')
      try {
        const result = await publicAPI<LoginResult>(register ? '/auth/register' : '/auth/login', 'POST', { username, password })
        saveSession(result); setUser(result.user); setPassword(''); setRegister(false); setSetup({ initialized: true, registration_open: false })
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}><fieldset className="space-y-4" disabled={busy}>
      <Field label="Username" value={username} onChange={setUsername} required />
      <Field label="Password" value={password} onChange={setPassword} type="password" required />
      {register && <p className="text-xs text-muted-foreground">Username minimal 3 karakter. Password minimal 8 karakter.</p>}
      <Button type="submit" className="h-12 w-full" disabled={busy}>{busy ? 'Memproses…' : register ? 'Daftar & Masuk' : 'Masuk'}</Button>
    </fieldset></form>
    {setup?.registration_open && <Button className="mt-4 w-full" variant="outline" disabled={busy} onClick={() => { setRegister(!register); setPassword(''); setError('') }}>{register ? 'Sudah punya akun? Masuk' : 'Registrasi'}</Button>}
  </section></main>
}
