'use client'
import { createUUID } from '@/lib/uuid'
import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, APIError, message } from '@/lib/api'
import { money, validNumber } from '@/lib/pos'
import type { CashPurchaseNote, CashPurchaseNoteInput } from '@/lib/types'
import { ErrorBox, Field, Panel, RupiahField } from './common'

export function CashPurchaseNotes({ date, userID, disabled, onChanged }: { date: string; userID: number; disabled: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<CashPurchaseNote[]>([])
  const [total, setTotal] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<CashPurchaseNoteInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const key = `toko:pending-cash-purchase:${userID}`
  useEffect(() => {
    try { const saved = sessionStorage.getItem(key); if (saved) { setPending(JSON.parse(saved)); setNotice('Catatan belanja sebelumnya belum terkonfirmasi. Coba simpan lagi untuk memeriksa catatan yang sama.') } }
    catch { setError('Catatan belanja yang belum terkonfirmasi tidak dapat dibaca.') }
  }, [key])
  useEffect(() => {
    let active = true
    void api<CashPurchaseNote[]>(`/catatan-belanja?tanggal=${date}&status=TERBUKA&limit=100&offset=0`).then(result => { if (active) setRows(result) }).catch(err => { if (active) setError(message(err)) })
    return () => { active = false }
  }, [date, revision])
  async function save() {
    if (lock.current || disabled || (!pending && (!validNumber(total, 2, true) || Number(total) <= 0))) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    const body = pending ?? { idempotency_key: createUUID(), tanggal: date, total, catatan: note }
    try {
      sessionStorage.setItem(key, JSON.stringify(body)); setPending(body)
      await api<CashPurchaseNote>('/catatan-belanja', 'POST', body)
      sessionStorage.removeItem(key); setPending(null); setTotal(''); setNote(''); setRevision(value => value + 1)
      setNotice(`Pengeluaran tanggal ${body.tanggal} tercatat. Lengkapi barangnya di menu Pembelian.`); onChanged()
    } catch (err) {
      if (err instanceof APIError && [400, 403, 404, 409].includes(err.status)) { sessionStorage.removeItem(key); setPending(null) }
      setError(message(err))
    } finally { lock.current = false; setBusy(false) }
  }
  async function cancel(id: number) {
    if (lock.current || disabled || pending) return
    lock.current = true; setBusy(true); setError('')
    try { await api(`/catatan-belanja/${id}/batal`, 'POST', {}); setRevision(value => value + 1); onChanged() }
    catch (err) { setError(message(err)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <Panel title="Pengeluaran uang tak terduga" subtitle="Simpan total uang yang diambil tetapi belum dicatat rinciannya hari ini. Rinciannya bisa dicatat nanti pada menu Pembelian.">
    <ErrorBox>{error}</ErrorBox>
    {notice && <p role="status" className="mb-3 text-sm text-primary">{notice}</p>}
    {pending && <p className="mb-3 text-sm">Belum terkonfirmasi: {pending.tanggal} · {money(pending.total)}</p>}
    <form onSubmit={event => { event.preventDefault(); void save() }} className="flex flex-wrap items-end gap-3">
      <fieldset disabled={disabled || busy || Boolean(pending)} className="flex flex-1 flex-wrap items-end gap-3"><RupiahField label="Total uang yang diambil" value={total} onChange={setTotal} /><Field label="Keterangan (opsional)" value={note} onChange={value => setNote(value.slice(0, 2000))} /></fieldset>
      <Button type="submit" disabled={disabled || busy || (!pending && (!validNumber(total, 2, true) || Number(total) <= 0))}>{busy ? <LoaderCircle className="animate-spin" /> : null}{pending ? 'Coba simpan lagi' : 'Simpan pengeluaran'}</Button>
    </form>
    <div className="mt-4 divide-y">{rows.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><strong>#{row.id} · {money(row.total)}</strong><span className="ml-2 text-muted-foreground">{row.status === 'TERBUKA' ? 'Belum dirinci' : row.status === 'BATAL' ? 'Dibatalkan' : `Dirinci di pembelian #${row.pembelian_id}`}</span>{row.catatan && <p className="text-muted-foreground">{row.catatan}</p>}</div>{row.status === 'TERBUKA' && <Button type="button" variant="ghost" disabled={disabled || busy || Boolean(pending)} onClick={() => void cancel(row.id)}>Batalkan catatan</Button>}</div>)}</div>
    {rows.length === 100 && <p className="text-xs text-muted-foreground">Menampilkan 100 catatan terbaru tanggal ini.</p>}
  </Panel>
}
