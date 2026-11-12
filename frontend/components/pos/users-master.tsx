'use client'

import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { ResponsivePanel } from '@/components/ui/responsive-panel'
import { all, api, message } from '@/lib/api'
import { useNotice } from '@/lib/use-notice'
import type { User } from '@/lib/types'
import { ErrorBox, Field, inputClass, Panel } from './common'

type Account = User & { aktif: boolean }
const empty = {
  nama: '',
  username: '',
  password: '',
  confirmation: '',
  peran: 'KASIR' as User['peran'],
}

export function UsersMaster() {
  const [rows, setRows] = useState<Account[]>([])
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [notice, setNotice] = useNotice()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  async function load() {
    setLoading(true)
    setListError('')
    try {
      setRows(await all<Account>('/pengguna'))
    } catch (err) {
      setListError(message(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  function focusEditor() {
    setForm(empty)
    setError('')
    setOpen(true)
  }
  const filtered = rows.filter((row) =>
    `${row.nama} ${row.username} ${row.peran}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <div className="users-layout">
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl border bg-accent p-3 text-sm text-accent-foreground"
        >
          {notice}
        </p>
      )}
      <ResponsivePanel
        open={open}
        busy={busy}
        title="Tambah Pengguna"
        onClose={() => setOpen(false)}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Buat akun untuk tim toko dan tentukan hak aksesnya.
        </p>
        <ErrorBox>{error}</ErrorBox>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setError('')
            setNotice('')
            const size = new TextEncoder().encode(form.password).length
            if (size < 8 || size > 72) {
              setError('Password harus 8–72 byte.')
              return
            }
            if (form.password !== form.confirmation) {
              setError('Konfirmasi password belum sesuai.')
              return
            }
            setBusy(true)
            try {
              const created = await api<Account>('/pengguna', 'POST', {
                nama: form.nama.trim(),
                username: form.username.trim(),
                password: form.password,
                peran: form.peran,
              })
              setRows((previous) => [created, ...previous])
              setQuery('')
              setForm(empty)
              setNotice(
                `Pengguna ${created.nama} berhasil ditambahkan. Akun sudah bisa digunakan untuk masuk.`,
              )
              setOpen(false)
            } catch (err) {
              setError(message(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <Field
              label="Nama pengguna"
              value={form.nama}
              onChange={(nama) => setForm({ ...form, nama })}
              required
            />
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Username
              <input
                aria-label="Username"
                className={inputClass}
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                required
                minLength={3}
                maxLength={50}
                pattern="[a-zA-Z0-9_.\-]{3,50}"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
              />
              <span className="text-xs font-normal text-muted-foreground">
                3–50 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Password
              <input
                aria-label="Password"
                className={inputClass}
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <span className="text-xs font-normal text-muted-foreground">
                Minimal 8 karakter, maksimal 72 byte.
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Konfirmasi password
              <input
                className={inputClass}
                type="password"
                value={form.confirmation}
                onChange={(event) => setForm({ ...form, confirmation: event.target.value })}
                required
                autoComplete="new-password"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Role
              <select
                aria-label="Role"
                className={inputClass}
                value={form.peran}
                onChange={(event) =>
                  setForm({ ...form, peran: event.target.value as User['peran'] })
                }
                aria-describedby="user-role-description"
              >
                <option value="KASIR">Kasir</option>
                <option value="PEMILIK">Pemilik</option>
              </select>
            </label>
            <p
              id="user-role-description"
              className="rounded-xl bg-muted p-3 text-sm text-muted-foreground"
            >
              {form.peran === 'PEMILIK'
                ? 'Pemilik memiliki akses penuh, termasuk mengelola pengguna, data master, dan pembelian.'
                : 'Kasir dapat melayani penjualan dan melihat riwayat, tanpa mengelola pengguna atau data master.'}
            </p>
            <BusyButton type="submit" className="h-12 w-full" busy={busy}>
              <Plus />
              Simpan Pengguna
            </BusyButton>
          </fieldset>
        </form>
      </ResponsivePanel>
      <div className="master-list">
        <div className="master-list-toolbar">
          <Button onClick={focusEditor}>
            <Plus aria-hidden="true" />
            Tambah Pengguna
          </Button>
        </div>
        <Panel title="Daftar Pengguna" subtitle="Akun yang terdaftar di toko.">
          <div className="mb-4 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Cari pengguna" value={query} onChange={setQuery} />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-12"
              aria-label="Muat ulang pengguna"
              disabled={loading || busy}
              onClick={() => void load()}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
          <ErrorBox>{listError}</ErrorBox>
          {loading ? (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">
              Memuat pengguna…
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map((row) => (
                <div key={row.id} className="master-row user-row flex items-center gap-3 py-4">
                  <div className="user-avatar">
                    <Users aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <strong>{row.nama}</strong>
                    <p className="text-sm text-muted-foreground">@{row.username}</p>
                    {!row.aktif && <p className="text-xs text-muted-foreground">Nonaktif</p>}
                  </div>
                  <span className="user-role" data-owner={row.peran === 'PEMILIK'}>
                    {row.peran === 'PEMILIK' ? 'Pemilik' : 'Kasir'}
                  </span>
                </div>
              ))}
              {!filtered.length && !listError && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {query ? 'Pengguna tidak ditemukan.' : 'Belum ada pengguna.'}
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
