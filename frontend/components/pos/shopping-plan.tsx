'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShoppingBag,
  Store,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { ResponsivePanel } from '@/components/ui/responsive-panel'
import { useContentMotion } from '@/lib/ui-interactions'
import { useNotice } from '@/lib/use-notice'
import { all, api, message } from '@/lib/api'
import { jakartaDay } from '@/lib/history-date'
import { validNumber } from '@/lib/pos'
import { createUUID } from '@/lib/uuid'
import {
  calendarDays,
  shiftShoppingMonth,
  shoppingDateLabel,
  shoppingQuantity,
} from '@/lib/shopping-plan'
import type { Data, ShoppingDay, ShoppingItem, ShoppingSource } from '@/lib/types'
import { ErrorBox, inputClass } from './common'
import { SearchSelect } from './search-select'
import { ProductSelect } from './product-select'

type Draft = {
  key: number
  product: string
  name: string
  quantity: string
  unit: string
  note: string
}
type Dialog = { kind: 'move'; ids: number[] } | { kind: 'edit' | 'delete'; item: ShoppingItem }
const blankDraft = (key: number): Draft => ({
  key,
  product: '',
  name: '',
  quantity: '',
  unit: '',
  note: '',
})
const filters = [
  ['all', 'Semua'],
  ['open', 'Belum dibeli'],
  ['done', 'Sudah dibeli'],
] as const

function itemPayload(draft: Draft) {
  const quantity = draft.quantity.trim().replace(',', '.')
  if (!draft.product || (draft.product === 'other' && !draft.name.trim()))
    throw new Error('Pilih produk atau isi nama barang lainnya di setiap baris.')
  if (quantity && !validNumber(quantity, 3, false))
    throw new Error('Jumlah boleh kosong; jika diisi harus lebih dari 0 dan maksimal 3 desimal.')
  return {
    produk_id: draft.product === 'other' ? null : Number(draft.product),
    nama_barang: draft.product === 'other' ? draft.name.trim() : '',
    jumlah: quantity || null,
    satuan: draft.product === 'other' ? draft.unit.trim() : '',
    catatan: draft.note.trim(),
  }
}

function ItemFields({
  draft,
  data,
  onChange,
}: {
  draft: Draft
  data: Data
  onChange: (draft: Draft) => void
}) {
  const productSelected = Boolean(draft.product && draft.product !== 'other')
  return (
    <>
      <div className="shopping-product-field">
        <span className="shopping-label">Barang</span>
        <ProductSelect
          label={`Barang baris ${draft.key}`}
          value={draft.product}
          onValueChange={(value, product) =>
            onChange({
              ...draft,
              product: value,
              unit: product
                ? (data.units.find((unit) => unit.id === product.satuan_id)?.nama ?? '')
                : draft.unit,
            })
          }
          required
          allowOther
        />
        {draft.product === 'other' && (
          <input
            aria-label={`Nama barang lainnya baris ${draft.key}`}
            className={inputClass}
            placeholder="Contoh: kantong kemasan"
            maxLength={300}
            required
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        )}
      </div>
      <label className="shopping-field">
        <span>
          Jumlah <small>opsional</small>
        </span>
        <input
          aria-label={`Jumlah baris ${draft.key}`}
          className={inputClass}
          inputMode="decimal"
          placeholder="Tidak harus diisi"
          value={draft.quantity}
          onChange={(event) => onChange({ ...draft, quantity: event.target.value })}
        />
      </label>
      <label className="shopping-field">
        <span>
          Satuan <small>opsional</small>
        </span>
        <input
          aria-label={`Satuan baris ${draft.key}`}
          className={inputClass}
          placeholder="kg, dus, pcs…"
          maxLength={100}
          value={draft.unit}
          readOnly={productSelected}
          onChange={(event) => onChange({ ...draft, unit: event.target.value })}
        />
      </label>
      <label className="shopping-field shopping-note-field">
        <span>
          Catatan <small>opsional</small>
        </span>
        <input
          aria-label={`Catatan baris ${draft.key}`}
          className={inputClass}
          placeholder="Merek, ukuran, atau pengingat"
          maxLength={2000}
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </label>
    </>
  )
}

export function ShoppingPlan({
  active,
  owner,
  data,
  masterLoading,
}: {
  active: boolean
  owner: boolean
  data: Data
  masterLoading: boolean
}) {
  const [today, setToday] = useState(jakartaDay)
  const [selected, setSelected] = useState(today)
  const month = selected.slice(0, 7)
  const [revision, setRevision] = useState(0)
  const [calendar, setCalendar] = useState<{ month: string; days: ShoppingDay[] }>({
    month: '',
    days: [],
  })
  const [day, setDay] = useState<{ date: string; items: ShoppingItem[] }>({ date: '', items: [] })
  const [sources, setSources] = useState<ShoppingSource[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [dayLoading, setDayLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [calendarError, setCalendarError] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useNotice()
  const [busy, setBusy] = useState(false)
  const pendingChecks = useRef(new Set<number>())
  const [pendingItemIDs, setPendingItemIDs] = useState(new Set<number>())
  const mutationLocked = busy || pendingItemIDs.size > 0
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
  const lastDialog = useRef<Dialog | null>(null)
  useEffect(() => {
    if (dialog) lastDialog.current = dialog
  }, [dialog])
  const displayedDialog = dialog ?? lastDialog.current
  const [dialogError, setDialogError] = useState('')
  const [targetSource, setTargetSource] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft(1))
  const listRef = useRef<HTMLDivElement>(null)
  useContentMotion(listRef, `${selected}:${filter}`)
  const dirty =
    drafts.some((row) => row.product || row.name || row.quantity || row.unit || row.note) ||
    Boolean(source)

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
    setCalendarLoading(true)
    setCalendarError('')
    api<ShoppingDay[]>(`/rencana-belanja/kalender?bulan=${month}`)
      .then((days) => {
        if (!ignore) setCalendar({ month, days })
      })
      .catch((err) => {
        if (!ignore) setCalendarError(message(err))
      })
      .finally(() => {
        if (!ignore) setCalendarLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [active, month, revision])
  useEffect(() => {
    if (!active) return
    let ignore = false
    setDayLoading(true)
    setLoadError('')
    all<ShoppingItem>(`/rencana-belanja?tanggal=${selected}`)
      .then((items) => {
        if (!ignore) setDay({ date: selected, items })
      })
      .catch((err) => {
        if (!ignore) setLoadError(message(err))
      })
      .finally(() => {
        if (!ignore) setDayLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [active, selected, revision])
  useEffect(() => {
    if (!active) return
    let ignore = false
    setSourceError('')
    api<ShoppingSource[]>('/rencana-belanja/sumber')
      .then((rows) => {
        if (!ignore) setSources(rows)
      })
      .catch((err) => {
        if (!ignore) setSourceError(message(err))
      })
    return () => {
      ignore = true
    }
  }, [active, revision])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const items = day.date === selected ? day.items : []
  const stats = useMemo(
    () =>
      new Map((calendar.month === month ? calendar.days : []).map((item) => [item.tanggal, item])),
    [calendar, month],
  )
  const sourceNames = new Map(sources.map((item) => [item.id, item.nama]))
  const completed = items.filter((item) => item.dibeli_at).length
  const visible = items.filter(
    (item) => filter === 'all' || (filter === 'done' ? Boolean(item.dibeli_at) : !item.dibeli_at),
  )
  const groups = [...new Set(visible.map((item) => item.sumber_pembelian_id))].sort((a, b) =>
    a === null
      ? 1
      : b === null
        ? -1
        : (sourceNames.get(a) ?? '').localeCompare(sourceNames.get(b) ?? '', 'id'),
  )

  function resetDrafts() {
    setDrafts([blankDraft(++counter.current)])
    setSource('')
    pending.current = null
  }
  function chooseDate(date: string) {
    if (date === selected || busyRef.current || pendingChecks.current.size > 0) return
    if (dirty && !window.confirm('Isian belanjaan belum disimpan. Buang isian dan ganti tanggal?'))
      return
    resetDrafts()
    setSelected(date)
    setChosen([])
    setSelecting(false)
    setError('')
    setNotice('')
    setFilter('all')
  }
  async function mutate(action: () => Promise<unknown>, success: string, modal = false) {
    if (busyRef.current || pendingChecks.current.size > 0) return
    busyRef.current = true
    setBusy(true)
    setNotice('')
    setError('')
    setDialogError('')
    try {
      await action()
      setRevision((value) => value + 1)
      setNotice(success)
      if (modal) {
        setDialog(null)
        setChosen([])
        setSelecting(false)
      }
    } catch (err) {
      if (modal) setDialogError(message(err))
      else setError(message(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    try {
      const body = {
        tanggal: selected,
        sumber_pembelian_id: source ? Number(source) : null,
        items: drafts.map(itemPayload),
      }
      const signature = JSON.stringify(body)
      if (pending.current?.signature !== signature)
        pending.current = { signature, key: createUUID() }
      const key = pending.current.key
      void mutate(async () => {
        await api('/rencana-belanja', 'POST', { ...body, idempotency_key: key })
        resetDrafts()
        setFormOpen(false)
      }, `${drafts.length} barang ditambahkan ke rencana belanja.`)
    } catch (err) {
      setError(message(err))
    }
  }
  async function toggleItem(item: ShoppingItem, checked: boolean) {
    if (busyRef.current || dayLoading || pendingChecks.current.has(item.id)) return
    pendingChecks.current.add(item.id)
    setPendingItemIDs(new Set(pendingChecks.current))
    setNotice('')
    setError('')
    try {
      const updated = await api<ShoppingItem>(`/rencana-belanja/${item.id}/checklist`, 'PUT', {
        dibeli: checked,
      })
      // Commit only the returned row. No full-list reload, optimistic filter jump or rollback.
      setDay((previous) =>
        previous.date !== item.tanggal
          ? previous
          : {
              ...previous,
              items: previous.items.map((row) => (row.id === item.id ? updated : row)),
            },
      )
      const difference = Number(Boolean(updated.dibeli_at)) - Number(Boolean(item.dibeli_at))
      setCalendar((previous) => ({
        ...previous,
        days: previous.days.map((summary) =>
          summary.tanggal === item.tanggal
            ? {
                ...summary,
                sudah_dibeli: Math.max(
                  0,
                  Math.min(summary.total_item, summary.sudah_dibeli + difference),
                ),
              }
            : summary,
        ),
      }))
      setNotice(
        updated.dibeli_at
          ? `${item.nama_barang} ditandai sudah dibeli.`
          : `${item.nama_barang} ditandai belum dibeli.`,
      )
    } catch (err) {
      setError(message(err))
    } finally {
      pendingChecks.current.delete(item.id)
      setPendingItemIDs(new Set(pendingChecks.current))
    }
  }
  function openMove(ids: number[]) {
    const first = items.find((item) => item.id === ids[0])
    setTargetSource(first?.sumber_pembelian_id ? String(first.sumber_pembelian_id) : '')
    setTargetDate(selected)
    setDialogError('')
    setDialog({ kind: 'move', ids })
  }
  function openEdit(item: ShoppingItem) {
    setEditDraft({
      key: 1,
      product: item.produk_id ? String(item.produk_id) : 'other',
      name: item.nama_barang,
      quantity: item.jumlah ?? '',
      unit: item.satuan,
      note: item.catatan,
    })
    setDialogError('')
    setDialog({ kind: 'edit', item })
  }
  function selectItem(item: ShoppingItem) {
    if (busyRef.current || dayLoading || pendingChecks.current.has(item.id)) return
    if (owner && selecting)
      setChosen((ids) =>
        ids.includes(item.id)
          ? ids.filter((id) => id !== item.id)
          : ids.length < 100
            ? [...ids, item.id]
            : ids,
      )
    else void toggleItem(item, !item.dibeli_at)
  }
  function submitDialog(event: FormEvent) {
    event.preventDefault()
    if (!dialog || busyRef.current) return
    if (dialog.kind === 'move') {
      void mutate(
        () =>
          api('/rencana-belanja/pindah', 'POST', {
            ids: dialog.ids,
            sumber_pembelian_id: targetSource ? Number(targetSource) : null,
            tanggal: targetDate,
          }),
        `${dialog.ids.length} barang dipindahkan.`,
        true,
      )
    } else if (dialog.kind === 'edit') {
      try {
        const body = itemPayload(editDraft)
        void mutate(
          () => api(`/rencana-belanja/${dialog.item.id}`, 'PUT', body),
          'Barang diperbarui.',
          true,
        )
      } catch (err) {
        setDialogError(message(err))
      }
    } else {
      void mutate(
        () => api(`/rencana-belanja/${dialog.item.id}/hapus`, 'POST'),
        'Barang dihapus dari rencana belanja.',
        true,
      )
    }
  }

  return (
    <div hidden={!active} className="shopping-plan-page">
      <div className="shopping-page-heading">
        <div className="shopping-heading-icon">
          <CalendarDays />
        </div>
        <div>
          <p className="shopping-eyebrow">KEBUTUHAN TOKO, LEBIH TERATUR</p>
          <h1>Rencana Belanja</h1>
          <p>Rencanakan harinya, kelompokkan tempat belinya.</p>
        </div>
        <Button
          variant="outline"
          aria-label="Muat ulang rencana belanja"
          disabled={mutationLocked || dayLoading || calendarLoading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className={dayLoading || calendarLoading ? 'animate-spin' : ''} />
          <span className="shopping-refresh-label">Muat ulang</span>
        </Button>
      </div>

      <section
        className="shopping-calendar shopping-panel"
        aria-label="Kalender belanja"
        aria-busy={calendarLoading}
      >
        <div className="shopping-calendar-heading">
          <div>
            <span className="shopping-eyebrow">KALENDER BELANJA</span>
            <h2>{shoppingDateLabel(`${month}-01`, true)}</h2>
          </div>
          <div className="shopping-calendar-controls">
            <Button variant="outline" disabled={mutationLocked} onClick={() => chooseDate(today)}>
              Hari ini
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Bulan sebelumnya"
              disabled={mutationLocked || month <= '0001-01'}
              onClick={() => chooseDate(shiftShoppingMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Bulan berikutnya"
              disabled={mutationLocked || month >= '9999-12'}
              onClick={() => chooseDate(shiftShoppingMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <ErrorBox>{calendarError}</ErrorBox>
        <div className="shopping-calendar-weekdays" aria-hidden="true">
          {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="shopping-calendar-grid">
          {calendarDays(month).map((date) => {
            const summary = stats.get(date),
              outside = date.slice(0, 7) !== month,
              done = Boolean(summary && summary.sudah_dibeli === summary.total_item)
            return (
              <button
                key={date}
                type="button"
                className="shopping-calendar-day"
                data-selected={date === selected}
                data-today={date === today}
                data-outside={outside}
                data-done={done}
                aria-pressed={date === selected}
                aria-current={date === today ? 'date' : undefined}
                aria-label={`${shoppingDateLabel(date)}${summary ? `, ${summary.sudah_dibeli} dari ${summary.total_item} barang dibeli` : ''}`}
                disabled={mutationLocked || date < '0001-01-01' || date > '9999-12-31'}
                onClick={() => chooseDate(date)}
              >
                <span className="shopping-day-number">{Number(date.slice(8, 10))}</span>
                {summary && (
                  <>
                    <span className="shopping-day-count">
                      {done && <Check className="size-3" />}
                      {summary.sudah_dibeli}/{summary.total_item}
                      <span className="shopping-day-count-label"> dibeli</span>
                    </span>
                    <span className="shopping-day-progress">
                      <span
                        style={{ width: `${(summary.sudah_dibeli / summary.total_item) * 100}%` }}
                      />
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>
        <div className="shopping-calendar-legend">
          <span>
            <i />
            Ada rencana belanja
          </span>
          <span>
            <CheckCheck className="size-3.5" />
            Semua sudah dibeli
          </span>
          <span className="shopping-calendar-hint">Pilih tanggal untuk mengatur belanjaan</span>
        </div>
      </section>

      <section className="shopping-selected-day" aria-labelledby="shopping-selected-title">
        <div>
          <p className="shopping-eyebrow">BELANJAAN PADA TANGGAL</p>
          <h2 id="shopping-selected-title">{shoppingDateLabel(selected)}</h2>
          <p>
            {dayLoading
              ? 'Memuat daftar belanja…'
              : `${items.length} barang · ${completed} sudah dibeli · ${items.length - completed} belum dibeli`}
          </p>
        </div>
        <div className="shopping-date-badge">
          <ShoppingBag />
          <strong>{items.length - completed}</strong>
          <span>belum dibeli</span>
        </div>
      </section>

      {notice && (
        <div className="pos-toast shopping-toast" role="status">
          <Check className="size-4 shrink-0" />
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Tutup pemberitahuan belanja"
            onClick={() => setNotice('')}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <ErrorBox>{formOpen ? sourceError : error || sourceError}</ErrorBox>

      <div className="shopping-panel shopping-add-panel">
        <button
          type="button"
          className="shopping-add-toggle"
          aria-label="Tambah belanjaan"
          aria-haspopup="dialog"
          disabled={mutationLocked}
          onClick={() => setFormOpen(true)}
        >
          <span className="shopping-add-icon">
            <Plus />
          </span>
          <span>
            <strong>Tambah belanjaan</strong>
            <small>Satu tempat beli, banyak barang sekaligus</small>
          </span>
          <Plus />
        </button>
      </div>
      <ResponsivePanel
        open={active && formOpen}
        busy={busy}
        dirty={dirty}
        title="Tambah belanjaan"
        className="responsive-panel-wide"
        onClose={() => {
          setFormOpen(false)
          resetDrafts()
        }}
      >
        <ErrorBox>{error}</ErrorBox>
        <form id="shopping-add-form" onSubmit={save}>
          <fieldset disabled={busy || masterLoading}>
            <div className="shopping-form-top">
              <div>
                <span className="shopping-label">Tempat beli</span>
                <SearchSelect
                  aria-label="Tempat beli rencana"
                  value={source}
                  onValueChange={setSource}
                >
                  <option value="">Belum ditentukan</option>
                  {sources
                    .filter((item) => item.aktif)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nama}
                      </option>
                    ))}
                </SearchSelect>
              </div>
              <p>
                <CalendarDays className="size-4" />
                <span>
                  Untuk <strong>{shoppingDateLabel(selected)}</strong>
                  <br />
                  Jumlah boleh dikosongkan.
                </span>
              </p>
            </div>
            <div className="shopping-draft-list">
              {drafts.map((draft, index) => (
                <div key={draft.key} className="shopping-draft-row">
                  <span className="shopping-row-number">{index + 1}</span>
                  <ItemFields
                    draft={draft}
                    data={data}
                    onChange={(next) =>
                      setDrafts((rows) => rows.map((row) => (row.key === next.key ? next : row)))
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Hapus baris ${draft.key}`}
                    disabled={drafts.length === 1}
                    onClick={() => setDrafts((rows) => rows.filter((row) => row.key !== draft.key))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
            <div className="shopping-form-footer">
              <Button
                type="button"
                variant="outline"
                disabled={drafts.length >= 100}
                onClick={() => {
                  const next = blankDraft(++counter.current)
                  setDrafts((rows) => [...rows, next])
                }}
              >
                <Plus />
                Tambah baris
              </Button>
              <span>{drafts.length}/100 barang</span>
              <BusyButton type="submit" busy={busy}>{`Simpan ${drafts.length} barang`}</BusyButton>
            </div>
          </fieldset>
        </form>
      </ResponsivePanel>

      <section
        className="shopping-list-section"
        aria-labelledby="shopping-list-title"
        aria-busy={dayLoading}
      >
        <div className="shopping-list-heading">
          <h2 id="shopping-list-title">Daftar belanja</h2>
          {owner && items.length > 0 && (
            <Button
              variant={selecting ? 'secondary' : 'outline'}
              disabled={mutationLocked || dayLoading}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((value) => !value)
                setChosen([])
              }}
            >
              <CheckCheck />
              {selecting ? 'Selesai memilih' : 'Pilih barang'}
            </Button>
          )}
        </div>
        <div className="shopping-filter-tabs" role="group" aria-label="Filter daftar belanja">
          {filters.map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>
                {value === 'all'
                  ? items.length
                  : value === 'done'
                    ? completed
                    : items.length - completed}
              </span>
            </button>
          ))}
        </div>
        {owner && selecting && (
          <div className="shopping-selection-bar">
            <span>
              {chosen.length} barang dipilih <small>(maks. 100)</small>
            </span>
            <Button disabled={!chosen.length || mutationLocked} onClick={() => openMove(chosen)}>
              <ArrowRightLeft />
              Pindahkan
            </Button>
          </div>
        )}
        <ErrorBox>{loadError}</ErrorBox>
        <div ref={listRef}>
          {dayLoading ? (
            <div className="shopping-empty">
              <RefreshCw className="animate-spin" />
              <p>Menyiapkan daftar belanja…</p>
            </div>
          ) : !loadError && !visible.length ? (
            <div className="shopping-empty shopping-panel">
              <ClipboardList />
              <h3>
                {!items.length ? 'Belum ada rencana belanja' : 'Tidak ada barang pada filter ini'}
              </h3>
              <p>
                {!items.length
                  ? 'Mulai catat kebutuhan toko untuk tanggal ini.'
                  : 'Coba pilih filter lainnya untuk melihat barang.'}
              </p>
              {!items.length && (
                <Button variant="outline" onClick={() => setFormOpen(true)}>
                  <Plus />
                  Tambah belanjaan pertama
                </Button>
              )}
            </div>
          ) : (
            groups.map((sourceID) => {
              const group = visible.filter((item) => item.sumber_pembelian_id === sourceID)
              const allGroup = items.filter((item) => item.sumber_pembelian_id === sourceID)
              const groupDone = allGroup.filter((item) => item.dibeli_at).length
              return (
                <section
                  className="shopping-store-group shopping-panel"
                  key={sourceID ?? 'unknown'}
                >
                  <div className="shopping-store-heading">
                    <div className="shopping-store-icon" data-unknown={sourceID === null}>
                      {sourceID === null ? <MapPin /> : <Store />}
                    </div>
                    <div>
                      <h3>
                        {sourceID === null
                          ? 'Belum ditentukan'
                          : (sourceNames.get(sourceID) ?? 'Tempat beli')}
                      </h3>
                      <p>
                        {sourceID === null
                          ? 'Tempat beli bisa ditentukan nanti'
                          : `${allGroup.length} barang dalam daftar`}
                      </p>
                    </div>
                    <span
                      className="shopping-store-progress"
                      data-complete={groupDone === allGroup.length}
                    >
                      {groupDone}/{allGroup.length}
                      <span> dibeli</span>
                    </span>
                  </div>
                  <ul className="shopping-items">
                    {group.map((item) => (
                      <li
                        key={item.id}
                        className="shopping-item"
                        data-done={Boolean(item.dibeli_at)}
                        data-selected={chosen.includes(item.id)}
                        aria-busy={pendingItemIDs.has(item.id)}
                        onClick={(event) => {
                          if (!(event.target as HTMLElement).closest('button,input,details'))
                            selectItem(item)
                        }}
                      >
                        {owner && selecting && (
                          <input
                            type="checkbox"
                            className="shopping-select-box"
                            aria-label={`Pilih ${item.nama_barang} untuk dipindahkan`}
                            checked={chosen.includes(item.id)}
                            disabled={busy || (!chosen.includes(item.id) && chosen.length >= 100)}
                            onChange={(event) =>
                              setChosen((ids) =>
                                event.target.checked
                                  ? [...ids, item.id]
                                  : ids.filter((id) => id !== item.id),
                              )
                            }
                          />
                        )}
                        <span
                          className="shopping-check-control"
                          data-pending={pendingItemIDs.has(item.id)}
                        >
                          <input
                            type="checkbox"
                            className="shopping-check"
                            aria-label={`Sudah dibeli: ${item.nama_barang}`}
                            checked={Boolean(item.dibeli_at)}
                            disabled={busy || dayLoading || pendingItemIDs.has(item.id)}
                            onChange={(event) => void toggleItem(item, event.target.checked)}
                          />
                          {pendingItemIDs.has(item.id) && (
                            <span
                              className="shopping-check-progress"
                              role="status"
                              aria-label={`Menyimpan ${item.nama_barang}`}
                            >
                              <RefreshCw className="ui-spinner size-5" aria-hidden="true" />
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="shopping-item-body shopping-item-body-button"
                          aria-label={`${owner && selecting ? 'Pilih' : 'Checklist'} ${item.nama_barang}`}
                          aria-pressed={
                            owner && selecting ? chosen.includes(item.id) : Boolean(item.dibeli_at)
                          }
                          disabled={
                            busy ||
                            dayLoading ||
                            pendingItemIDs.has(item.id) ||
                            (owner &&
                              selecting &&
                              !chosen.includes(item.id) &&
                              chosen.length >= 100)
                          }
                          onClick={() => selectItem(item)}
                        >
                          <span className="shopping-item-name">
                            <strong>{item.nama_barang}</strong>
                            {item.produk_id === null && (
                              <span className="shopping-other-badge">Lainnya</span>
                            )}
                          </span>
                          {shoppingQuantity(item) && (
                            <span className="shopping-item-quantity">{shoppingQuantity(item)}</span>
                          )}
                          {item.catatan && (
                            <span className="shopping-item-note block">{item.catatan}</span>
                          )}
                        </button>
                        {owner && (
                          <details className="shopping-item-menu">
                            <summary aria-label={`Aksi ${item.nama_barang}`}>
                              <MoreHorizontal className="size-5" />
                            </summary>
                            <div>
                              <button
                                type="button"
                                disabled={mutationLocked}
                                onClick={(event) => {
                                  event.currentTarget.closest('details')?.removeAttribute('open')
                                  openMove([item.id])
                                }}
                              >
                                <ArrowRightLeft />
                                Pindahkan
                              </button>
                              <button
                                type="button"
                                disabled={mutationLocked}
                                onClick={(event) => {
                                  event.currentTarget.closest('details')?.removeAttribute('open')
                                  openEdit(item)
                                }}
                              >
                                <Pencil />
                                Edit barang
                              </button>
                              <button
                                type="button"
                                className="text-destructive"
                                disabled={mutationLocked}
                                onClick={(event) => {
                                  event.currentTarget.closest('details')?.removeAttribute('open')
                                  setDialogError('')
                                  setDialog({ kind: 'delete', item })
                                }}
                              >
                                <Trash2 />
                                Hapus
                              </button>
                            </div>
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })
          )}
        </div>
        <p className="shopping-footnote">
          Checklist hanya untuk menandai belanjaan. Stok dan pengeluaran tetap dicatat melalui
          transaksi pembelian.
        </p>
      </section>

      <ResponsivePanel
        open={active && Boolean(dialog)}
        busy={busy}
        title={
          displayedDialog?.kind === 'move'
            ? 'Pindahkan belanjaan'
            : displayedDialog?.kind === 'edit'
              ? 'Edit barang belanja'
              : 'Hapus barang?'
        }
        onClose={() => setDialog(null)}
      >
        {displayedDialog && (
          <form onSubmit={submitDialog}>
            <fieldset disabled={busy} className="space-y-4">
              <ErrorBox>{dialogError}</ErrorBox>
              {displayedDialog.kind === 'move' ? (
                <>
                  <p>
                    {displayedDialog.ids.length} barang akan dipindahkan. Jumlah, catatan, dan
                    checklist tetap tersimpan.
                  </p>
                  <div>
                    <span className="shopping-label">Tempat beli tujuan</span>
                    <SearchSelect
                      aria-label="Tempat beli tujuan"
                      value={targetSource}
                      onValueChange={setTargetSource}
                    >
                      <option value="">Belum ditentukan</option>
                      {sources
                        .filter((item) => item.aktif)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.nama}
                          </option>
                        ))}
                    </SearchSelect>
                  </div>
                  <label className="shopping-field">
                    <span>Tanggal belanja tujuan</span>
                    <input
                      className={inputClass}
                      type="date"
                      required
                      value={targetDate}
                      onChange={(event) => setTargetDate(event.target.value)}
                    />
                  </label>
                </>
              ) : displayedDialog.kind === 'edit' ? (
                <div className="shopping-edit-fields">
                  <ItemFields draft={editDraft} data={data} onChange={setEditDraft} />
                </div>
              ) : (
                <p>
                  Hapus <strong>{displayedDialog.item.nama_barang}</strong> dari rencana belanja?
                  Tindakan ini tidak mengubah stok atau transaksi pembelian.
                </p>
              )}
              <div className="shopping-dialog-footer">
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Batal
                </Button>
                <BusyButton
                  type="submit"
                  busy={busy}
                  variant={displayedDialog.kind === 'delete' ? 'destructive' : 'default'}
                >
                  {displayedDialog.kind === 'move'
                    ? 'Pindahkan barang'
                    : displayedDialog.kind === 'edit'
                      ? 'Simpan perubahan'
                      : 'Hapus barang'}
                </BusyButton>
              </div>
            </fieldset>
          </form>
        )}
      </ResponsivePanel>
    </div>
  )
}
