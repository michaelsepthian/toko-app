'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRightLeft, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, ClipboardList, MapPin, MoreHorizontal, Pencil, Plus, RefreshCw, ShoppingBag, Store, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { all, api, message } from '@/lib/api'
import { jakartaDay } from '@/lib/history-date'
import { validNumber } from '@/lib/pos'
import { createUUID } from '@/lib/uuid'
import { calendarDays, shiftShoppingMonth, shoppingDateLabel, shoppingQuantity } from '@/lib/shopping-plan'
import type { Data, ShoppingDay, ShoppingItem, ShoppingSource } from '@/lib/types'
import { ErrorBox, inputClass } from './common'
import { SearchSelect } from './search-select'

type Draft = { key: number; product: string; name: string; quantity: string; unit: string; note: string }
type Dialog = { kind: 'move'; ids: number[] } | { kind: 'edit' | 'delete'; item: ShoppingItem }
const blankDraft = (key: number): Draft => ({ key, product: '', name: '', quantity: '', unit: '', note: '' })
const filters = [['all', 'Semua'], ['open', 'Belum dibeli'], ['done', 'Sudah dibeli']] as const

function itemPayload(draft: Draft) {
  const quantity = draft.quantity.trim().replace(',', '.')
  if (!draft.product || (draft.product === 'other' && !draft.name.trim())) throw new Error('Pilih produk atau isi nama barang lainnya di setiap baris.')
  if (quantity && !validNumber(quantity, 3, false)) throw new Error('Jumlah boleh kosong; jika diisi harus lebih dari 0 dan maksimal 3 desimal.')
  return { produk_id: draft.product === 'other' ? null : Number(draft.product), nama_barang: draft.product === 'other' ? draft.name.trim() : '', jumlah: quantity || null, satuan: draft.unit.trim(), catatan: draft.note.trim() }
}

function ItemFields({ draft, data, onChange }: { draft: Draft; data: Data; onChange: (draft: Draft) => void }) {
  const product = data.products.find(item => String(item.id) === draft.product)
  const unit = product ? data.units.find(item => item.id === product.satuan_id)?.nama ?? '' : draft.unit
  return <>
    <div className="shopping-product-field"><span className="shopping-label">Barang</span><SearchSelect aria-label={`Barang baris ${draft.key}`} value={draft.product} onValueChange={value => onChange({ ...draft, product: value })} required>
      <option value="">Pilih atau cari produk</option><option value="other">Lainnya — tulis barang baru</option>
      {data.products.filter(item => item.aktif || String(item.id) === draft.product).map(item => <option key={item.id} value={item.id}>{item.nama}</option>)}
    </SearchSelect>{draft.product === 'other' && <input aria-label={`Nama barang lainnya baris ${draft.key}`} className={inputClass} placeholder="Contoh: kantong kemasan" maxLength={300} required value={draft.name} onChange={event => onChange({ ...draft, name: event.target.value })} />}</div>
    <label className="shopping-field"><span>Jumlah <small>opsional</small></span><input aria-label={`Jumlah baris ${draft.key}`} className={inputClass} inputMode="decimal" placeholder="Tidak harus diisi" value={draft.quantity} onChange={event => onChange({ ...draft, quantity: event.target.value })} /></label>
    <label className="shopping-field"><span>Satuan <small>opsional</small></span><input aria-label={`Satuan baris ${draft.key}`} className={inputClass} placeholder="kg, dus, pcs…" maxLength={100} value={unit} readOnly={Boolean(product)} onChange={event => onChange({ ...draft, unit: event.target.value })} /></label>
    <label className="shopping-field shopping-note-field"><span>Catatan <small>opsional</small></span><input aria-label={`Catatan baris ${draft.key}`} className={inputClass} placeholder="Merek, ukuran, atau pengingat" maxLength={2000} value={draft.note} onChange={event => onChange({ ...draft, note: event.target.value })} /></label>
  </>
}

export function ShoppingPlan({ active, owner, data, masterLoading }: { active: boolean; owner: boolean; data: Data; masterLoading: boolean }) {
  const [today, setToday] = useState(jakartaDay)
  const [selected, setSelected] = useState(today)
  const month = selected.slice(0, 7)
  const [revision, setRevision] = useState(0)
  const [calendar, setCalendar] = useState<{ month: string; days: ShoppingDay[] }>({ month: '', days: [] })
  const [day, setDay] = useState<{ date: string; items: ShoppingItem[] }>({ date: '', items: [] })
  const [sources, setSources] = useState<ShoppingSource[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [dayLoading, setDayLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [calendarError, setCalendarError] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [formOpen, setFormOpen] = useState(false)
  const [source, setSource] = useState('')
  const counter = useRef(1)
  const [drafts, setDrafts] = useState<Draft[]>([blankDraft(1)])
  const pending = useRef<{ signature: string; key: string } | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all')
  const [selecting, setSelecting] = useState(false)
  const [chosen, setChosen] = useState<number[]>([])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [dialogError, setDialogError] = useState('')
  const [targetSource, setTargetSource] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft(1))
  const formRef = useRef<HTMLDivElement>(null)
  const dirty = drafts.some(row => row.product || row.name || row.quantity || row.unit || row.note) || Boolean(source)
  const dialogOpen = dialog !== null

  useEffect(() => {
    if (!active) return
    const update = () => setToday(jakartaDay())
    update()
    const timer = window.setInterval(update, 60000)
    return () => window.clearInterval(timer)
  }, [active])
  useEffect(() => {
    if (!active) return
    let ignore = false
    setCalendarLoading(true); setCalendarError('')
    api<ShoppingDay[]>(`/rencana-belanja/kalender?bulan=${month}`).then(days => { if (!ignore) setCalendar({ month, days }) }).catch(err => { if (!ignore) setCalendarError(message(err)) }).finally(() => { if (!ignore) setCalendarLoading(false) })
    return () => { ignore = true }
  }, [active, month, revision])
  useEffect(() => {
    if (!active) return
    let ignore = false
    setDayLoading(true); setLoadError('')
    all<ShoppingItem>(`/rencana-belanja?tanggal=${selected}`).then(items => { if (!ignore) setDay({ date: selected, items }) }).catch(err => { if (!ignore) setLoadError(message(err)) }).finally(() => { if (!ignore) setDayLoading(false) })
    return () => { ignore = true }
  }, [active, selected, revision])
  useEffect(() => {
    if (!active) return
    let ignore = false
    setSourceError('')
    api<ShoppingSource[]>('/rencana-belanja/sumber').then(rows => { if (!ignore) setSources(rows) }).catch(err => { if (!ignore) setSourceError(message(err)) })
    return () => { ignore = true }
  }, [active, revision])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    if (!dialogOpen || !dialogRef.current) return
    const node = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; node.showModal()
    return () => { node.close(); document.body.style.overflow = overflow; previousFocus?.focus({ preventScroll: true }) }
  }, [dialogOpen])

  const items = day.date === selected ? day.items : []
  const stats = useMemo(() => new Map((calendar.month === month ? calendar.days : []).map(item => [item.tanggal, item])), [calendar, month])
  const sourceNames = new Map(sources.map(item => [item.id, item.nama]))
  const completed = items.filter(item => item.dibeli_at).length
  const visible = items.filter(item => filter === 'all' || (filter === 'done' ? Boolean(item.dibeli_at) : !item.dibeli_at))
  const groups = [...new Set(visible.map(item => item.sumber_pembelian_id))].sort((a, b) => a === null ? 1 : b === null ? -1 : (sourceNames.get(a) ?? '').localeCompare(sourceNames.get(b) ?? '', 'id'))

  function resetDrafts() { setDrafts([blankDraft(++counter.current)]); setSource(''); pending.current = null }
  function chooseDate(date: string) {
    if (date === selected || busyRef.current) return
    if (dirty && !window.confirm('Isian belanjaan belum disimpan. Buang isian dan ganti tanggal?')) return
    resetDrafts(); setSelected(date); setChosen([]); setSelecting(false); setError(''); setNotice(''); setFilter('all')
  }
  async function mutate(action: () => Promise<unknown>, success: string, modal = false) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setNotice(''); setError(''); setDialogError('')
    try {
      await action(); setRevision(value => value + 1); setNotice(success)
      if (modal) { setDialog(null); setChosen([]); setSelecting(false) }
    } catch (err) { if (modal) setDialogError(message(err)); else setError(message(err)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    try {
      const body = { tanggal: selected, sumber_pembelian_id: source ? Number(source) : null, items: drafts.map(itemPayload) }
      const signature = JSON.stringify(body)
      if (pending.current?.signature !== signature) pending.current = { signature, key: createUUID() }
      const key = pending.current.key
      void mutate(async () => { await api('/rencana-belanja', 'POST', { ...body, idempotency_key: key }); resetDrafts(); setFormOpen(false) }, `${drafts.length} barang ditambahkan ke rencana belanja.`)
    } catch (err) { setError(message(err)) }
  }
  function toggleItem(item: ShoppingItem, checked: boolean) {
    if (busyRef.current) return
    void mutate(async () => {
      setDay(previous => ({ ...previous, items: previous.items.map(row => row.id === item.id ? { ...row, dibeli_at: checked ? new Date().toISOString() : null } : row) }))
      try {
        const updated = await api<ShoppingItem>(`/rencana-belanja/${item.id}/checklist`, 'PUT', { dibeli: checked })
        setDay(previous => ({ ...previous, items: previous.items.map(row => row.id === item.id ? updated : row) }))
      } catch (err) {
        setDay(previous => ({ ...previous, items: previous.items.map(row => row.id === item.id ? item : row) }))
        throw err
      }
    }, checked ? `${item.nama_barang} ditandai sudah dibeli.` : `${item.nama_barang} ditandai belum dibeli.`)
  }
  function openMove(ids: number[]) {
    const first = items.find(item => item.id === ids[0])
    setTargetSource(first?.sumber_pembelian_id ? String(first.sumber_pembelian_id) : ''); setTargetDate(selected); setDialogError(''); setDialog({ kind: 'move', ids })
  }
  function openEdit(item: ShoppingItem) {
    setEditDraft({ key: 1, product: item.produk_id ? String(item.produk_id) : 'other', name: item.nama_barang, quantity: item.jumlah ?? '', unit: item.satuan, note: item.catatan })
    setDialogError(''); setDialog({ kind: 'edit', item })
  }
  function submitDialog(event: FormEvent) {
    event.preventDefault()
    if (!dialog || busyRef.current) return
    if (dialog.kind === 'move') {
      void mutate(() => api('/rencana-belanja/pindah', 'POST', { ids: dialog.ids, sumber_pembelian_id: targetSource ? Number(targetSource) : null, tanggal: targetDate }), `${dialog.ids.length} barang dipindahkan.`, true)
    } else if (dialog.kind === 'edit') {
      try { const body = itemPayload(editDraft); void mutate(() => api(`/rencana-belanja/${dialog.item.id}`, 'PUT', body), 'Barang diperbarui.', true) } catch (err) { setDialogError(message(err)) }
    } else {
      void mutate(() => api(`/rencana-belanja/${dialog.item.id}/hapus`, 'POST'), 'Barang dihapus dari rencana belanja.', true)
    }
  }

  return <div hidden={!active} className="shopping-plan-page">
    <div className="shopping-page-heading"><div className="shopping-heading-icon"><CalendarDays /></div><div><p className="shopping-eyebrow">KEBUTUHAN TOKO, LEBIH TERATUR</p><h1>Rencana Belanja</h1><p>Rencanakan harinya, kelompokkan tempat belinya.</p></div><Button variant="outline" aria-label="Muat ulang rencana belanja" disabled={busy || dayLoading || calendarLoading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={dayLoading || calendarLoading ? 'animate-spin' : ''} /><span className="shopping-refresh-label">Muat ulang</span></Button></div>

    <section className="shopping-calendar shopping-panel" aria-label="Kalender belanja" aria-busy={calendarLoading}>
      <div className="shopping-calendar-heading"><div><span className="shopping-eyebrow">KALENDER BELANJA</span><h2>{shoppingDateLabel(`${month}-01`, true)}</h2></div><div className="shopping-calendar-controls"><Button variant="outline" disabled={busy} onClick={() => chooseDate(today)}>Hari ini</Button><Button variant="ghost" size="icon" aria-label="Bulan sebelumnya" disabled={busy || month <= '0001-01'} onClick={() => chooseDate(shiftShoppingMonth(month, -1))}><ChevronLeft /></Button><Button variant="ghost" size="icon" aria-label="Bulan berikutnya" disabled={busy || month >= '9999-12'} onClick={() => chooseDate(shiftShoppingMonth(month, 1))}><ChevronRight /></Button></div></div>
      <ErrorBox>{calendarError}</ErrorBox>
      <div className="shopping-calendar-weekdays" aria-hidden="true">{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="shopping-calendar-grid">{calendarDays(month).map(date => {
        const summary = stats.get(date), outside = date.slice(0, 7) !== month, done = Boolean(summary && summary.sudah_dibeli === summary.total_item)
        return <button key={date} type="button" className="shopping-calendar-day" data-selected={date === selected} data-today={date === today} data-outside={outside} data-done={done} aria-pressed={date === selected} aria-current={date === today ? 'date' : undefined} aria-label={`${shoppingDateLabel(date)}${summary ? `, ${summary.sudah_dibeli} dari ${summary.total_item} barang dibeli` : ''}`} disabled={busy || date < '0001-01-01' || date > '9999-12-31'} onClick={() => chooseDate(date)}><span className="shopping-day-number">{Number(date.slice(8, 10))}</span>{summary && <><span className="shopping-day-count">{done && <Check className="size-3" />}{summary.sudah_dibeli}/{summary.total_item}<span className="shopping-day-count-label"> dibeli</span></span><span className="shopping-day-progress"><span style={{ width: `${summary.sudah_dibeli / summary.total_item * 100}%` }} /></span></>}</button>
      })}</div>
      <div className="shopping-calendar-legend"><span><i />Ada rencana belanja</span><span><CheckCheck className="size-3.5" />Semua sudah dibeli</span><span className="shopping-calendar-hint">Pilih tanggal untuk mengatur belanjaan</span></div>
    </section>

    <section className="shopping-selected-day" aria-labelledby="shopping-selected-title"><div><p className="shopping-eyebrow">BELANJAAN PADA TANGGAL</p><h2 id="shopping-selected-title">{shoppingDateLabel(selected)}</h2><p>{dayLoading ? 'Memuat daftar belanja…' : `${items.length} barang · ${completed} sudah dibeli · ${items.length - completed} belum dibeli`}</p></div><div className="shopping-date-badge"><ShoppingBag /><strong>{items.length - completed}</strong><span>belum dibeli</span></div></section>

    {notice && <p className="shopping-notice" role="status"><Check className="size-4" />{notice}</p>}
    <ErrorBox>{error || sourceError}</ErrorBox>

    <div ref={formRef} className="shopping-panel shopping-add-panel"><button type="button" className="shopping-add-toggle" aria-label="Tambah belanjaan" aria-expanded={formOpen} aria-controls="shopping-add-form" disabled={busy} onClick={() => setFormOpen(value => !value)}><span className="shopping-add-icon"><Plus /></span><span><strong>Tambah belanjaan</strong><small>Satu tempat beli, banyak barang sekaligus</small></span><Plus className={formOpen ? 'rotate-45' : ''} /></button>
      <form id="shopping-add-form" hidden={!formOpen} onSubmit={save}><fieldset disabled={busy || masterLoading}>
        <div className="shopping-form-top"><div><span className="shopping-label">Tempat beli</span><SearchSelect aria-label="Tempat beli rencana" value={source} onValueChange={setSource}><option value="">Belum ditentukan</option>{sources.filter(item => item.aktif).map(item => <option key={item.id} value={item.id}>{item.nama}</option>)}</SearchSelect></div><p><CalendarDays className="size-4" /><span>Untuk <strong>{shoppingDateLabel(selected)}</strong><br />Jumlah boleh dikosongkan.</span></p></div>
        <div className="shopping-draft-list">{drafts.map((draft, index) => <div key={draft.key} className="shopping-draft-row"><span className="shopping-row-number">{index + 1}</span><ItemFields draft={draft} data={data} onChange={next => setDrafts(rows => rows.map(row => row.key === next.key ? next : row))} /><Button type="button" size="icon" variant="ghost" aria-label={`Hapus baris ${draft.key}`} disabled={drafts.length === 1} onClick={() => setDrafts(rows => rows.filter(row => row.key !== draft.key))}><X /></Button></div>)}</div>
        <div className="shopping-form-footer"><Button type="button" variant="outline" disabled={drafts.length >= 100} onClick={() => { const next = blankDraft(++counter.current); setDrafts(rows => [...rows, next]) }}><Plus />Tambah baris</Button><span>{drafts.length}/100 barang</span><Button type="submit">{busy ? 'Menyimpan…' : `Simpan ${drafts.length} barang`}</Button></div>
      </fieldset></form>
    </div>

    <section className="shopping-list-section" aria-labelledby="shopping-list-title" aria-busy={dayLoading}>
      <div className="shopping-list-heading"><h2 id="shopping-list-title">Daftar belanja</h2>{owner && items.length > 0 && <Button variant={selecting ? 'secondary' : 'outline'} disabled={busy || dayLoading} aria-pressed={selecting} onClick={() => { setSelecting(value => !value); setChosen([]) }}><CheckCheck />{selecting ? 'Selesai memilih' : 'Pilih barang'}</Button>}</div>
      <div className="shopping-filter-tabs" role="group" aria-label="Filter daftar belanja">{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{value === 'all' ? items.length : value === 'done' ? completed : items.length - completed}</span></button>)}</div>
      {owner && selecting && <div className="shopping-selection-bar"><span>{chosen.length} barang dipilih <small>(maks. 100)</small></span><Button disabled={!chosen.length || busy} onClick={() => openMove(chosen)}><ArrowRightLeft />Pindahkan</Button></div>}
      <ErrorBox>{loadError}</ErrorBox>
      {dayLoading ? <div className="shopping-empty"><RefreshCw className="animate-spin" /><p>Menyiapkan daftar belanja…</p></div> : !loadError && !visible.length ? <div className="shopping-empty shopping-panel"><ClipboardList /><h3>{!items.length ? 'Belum ada rencana belanja' : 'Tidak ada barang pada filter ini'}</h3><p>{!items.length ? 'Mulai catat kebutuhan toko untuk tanggal ini.' : 'Coba pilih filter lainnya untuk melihat barang.'}</p>{!items.length && <Button variant="outline" onClick={() => { setFormOpen(true); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}><Plus />Tambah belanjaan pertama</Button>}</div> : groups.map(sourceID => {
        const group = visible.filter(item => item.sumber_pembelian_id === sourceID)
        const allGroup = items.filter(item => item.sumber_pembelian_id === sourceID)
        const groupDone = allGroup.filter(item => item.dibeli_at).length
        return <section className="shopping-store-group shopping-panel" key={sourceID ?? 'unknown'}><div className="shopping-store-heading"><div className="shopping-store-icon" data-unknown={sourceID === null}>{sourceID === null ? <MapPin /> : <Store />}</div><div><h3>{sourceID === null ? 'Belum ditentukan' : sourceNames.get(sourceID) ?? 'Tempat beli'}</h3><p>{sourceID === null ? 'Tempat beli bisa ditentukan nanti' : `${allGroup.length} barang dalam daftar`}</p></div><span className="shopping-store-progress" data-complete={groupDone === allGroup.length}>{groupDone}/{allGroup.length}<span> dibeli</span></span></div>
          <ul className="shopping-items">{group.map(item => <li key={item.id} className="shopping-item" data-done={Boolean(item.dibeli_at)}>
            {owner && selecting && <input type="checkbox" className="shopping-select-box" aria-label={`Pilih ${item.nama_barang} untuk dipindahkan`} checked={chosen.includes(item.id)} disabled={busy || (!chosen.includes(item.id) && chosen.length >= 100)} onChange={event => setChosen(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />}
            <input type="checkbox" className="shopping-check" aria-label={`Sudah dibeli: ${item.nama_barang}`} checked={Boolean(item.dibeli_at)} disabled={busy || dayLoading} onChange={event => toggleItem(item, event.target.checked)} />
            <div className="shopping-item-body"><div className="shopping-item-name"><strong>{item.nama_barang}</strong>{item.produk_id === null && <span className="shopping-other-badge">Lainnya</span>}</div>{shoppingQuantity(item) && <span className="shopping-item-quantity">{shoppingQuantity(item)}</span>}{item.catatan && <p className="shopping-item-note">{item.catatan}</p>}</div>
            {owner && <details className="shopping-item-menu"><summary aria-label={`Aksi ${item.nama_barang}`}><MoreHorizontal className="size-5" /></summary><div><button type="button" disabled={busy} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); openMove([item.id]) }}><ArrowRightLeft />Pindahkan</button><button type="button" disabled={busy} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); openEdit(item) }}><Pencil />Edit barang</button><button type="button" className="text-destructive" disabled={busy} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); setDialogError(''); setDialog({ kind: 'delete', item }) }}><Trash2 />Hapus</button></div></details>}
          </li>)}</ul>
        </section>
      })}
      <p className="shopping-footnote">Checklist hanya untuk menandai belanjaan. Stok dan pengeluaran tetap dicatat melalui transaksi pembelian.</p>
    </section>

    {dialog && <dialog ref={dialogRef} className="shopping-dialog" aria-labelledby="shopping-dialog-title" onCancel={event => { event.preventDefault(); if (!busyRef.current) setDialog(null) }}><div className="shopping-dialog-header"><h2 id="shopping-dialog-title">{dialog.kind === 'move' ? 'Pindahkan belanjaan' : dialog.kind === 'edit' ? 'Edit barang belanja' : 'Hapus barang?'}</h2><Button variant="ghost" size="icon" aria-label="Tutup dialog belanja" disabled={busy} onClick={() => setDialog(null)}><X /></Button></div><form onSubmit={submitDialog}><fieldset disabled={busy} className="shopping-dialog-body"><ErrorBox>{dialogError}</ErrorBox>
      {dialog.kind === 'move' ? <><p>{dialog.ids.length} barang akan dipindahkan. Jumlah, catatan, dan checklist tetap tersimpan.</p><div><span className="shopping-label">Tempat beli tujuan</span><SearchSelect aria-label="Tempat beli tujuan" value={targetSource} onValueChange={setTargetSource}><option value="">Belum ditentukan</option>{sources.filter(item => item.aktif).map(item => <option key={item.id} value={item.id}>{item.nama}</option>)}</SearchSelect></div><label className="shopping-field"><span>Tanggal belanja tujuan</span><input className={inputClass} type="date" required value={targetDate} onChange={event => setTargetDate(event.target.value)} /></label></> : dialog.kind === 'edit' ? <div className="shopping-edit-fields"><ItemFields draft={editDraft} data={data} onChange={setEditDraft} /></div> : <p>Hapus <strong>{dialog.item.nama_barang}</strong> dari rencana belanja? Tindakan ini tidak mengubah stok atau transaksi pembelian.</p>}
      <div className="shopping-dialog-footer"><Button type="button" variant="outline" onClick={() => setDialog(null)}>Batal</Button><Button type="submit" variant={dialog.kind === 'delete' ? 'destructive' : 'default'}>{busy ? 'Menyimpan…' : dialog.kind === 'move' ? 'Pindahkan barang' : dialog.kind === 'edit' ? 'Simpan perubahan' : 'Hapus barang'}</Button></div>
    </fieldset></form></dialog>}
  </div>
}
