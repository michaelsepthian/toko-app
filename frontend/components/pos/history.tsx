'use client'
import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronRight, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { ResponsivePanel } from '@/components/ui/responsive-panel'
import { useContentMotion } from '@/lib/ui-interactions'
import { api, message } from '@/lib/api'
import type { Data, Transaction } from '@/lib/types'
import { jakartaDay } from '@/lib/history-date'
import { incomeDateLabel } from '@/lib/income-date'
import { dateTime, money } from '@/lib/pos'
import { ErrorBox, Field, Panel } from './common'
import { DailySummary } from './daily-summary'

export function History({ data, owner, refresh, print, storeName, userID }: { storeName: string; userID: number; data: Data; owner: boolean; refresh: () => Promise<void>; print: (sale: Transaction) => Promise<void> }) {
  const [purchase, setPurchase] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [rows, setRows] = useState<Transaction[]>([])
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(() => jakartaDay())
  const [target, setTarget] = useState<{ id: number; nomor: string } | null>(null)
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailAttempt, setDetailAttempt] = useState(0)
  const [actionBusy, setActionBusy] = useState(false)
  const [reason, setReason] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  useContentMotion(contentRef, `${purchase}:${summaryOpen}`)
  const path = purchase ? 'pembelian' : 'penjualan'
  const query = `/${path}?limit=20&offset=${offset}${purchase ? '' : `&tanggal=${encodeURIComponent(date)}`}`

  async function load() {
    setBusy(true); setError('')
    try { setRows(await api<Transaction[]>(query)) }
    catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (summaryOpen) { setBusy(false); return }
    let active = true
    setBusy(true); setError(''); setTarget(null); setRows([])
    void api<Transaction[]>(query).then(rows => { if (active) setRows(rows) })
      .catch(err => { if (active) setError(message(err)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [query, summaryOpen])
  useEffect(() => {
    if (!target) return
    let active = true
    setDetailBusy(true); setDetailError(''); setSelected(null)
    void api<Transaction>(`/${path}/${target.id}`).then(row => { if (active) setSelected(row) })
      .catch(err => { if (active) setDetailError(message(err)) })
      .finally(() => { if (active) setDetailBusy(false) })
    return () => { active = false }
  }, [path, target, detailAttempt])
  function closeDetail() { if (!actionBusy) setTarget(null) }
  function openDetail(row: Transaction) {
    setSelected(null); setDetailBusy(true); setDetailError(''); setReason('')
    setTarget({ id: row.id, nomor: row.nomor })
  }

  return <div className="history-page mx-auto max-w-6xl space-y-5 p-5">
    <div className="history-tabs flex flex-wrap gap-2"><Button disabled={busy} variant={!purchase && !summaryOpen ? 'default' : 'outline'} onClick={() => { setSummaryOpen(false); setPurchase(false); setOffset(0) }}>Riwayat Penjualan</Button>{owner && <Button disabled={busy} variant={purchase && !summaryOpen ? 'default' : 'outline'} onClick={() => { setSummaryOpen(false); setPurchase(true); setOffset(0) }}>Riwayat Pembelian</Button>}{owner && <Button disabled={busy} variant={summaryOpen ? 'default' : 'outline'} onClick={() => { setSummaryOpen(true); setTarget(null) }}>Ringkasan Harian</Button>}{!summaryOpen && <Button variant="outline" disabled={busy} onClick={() => void load()}>Muat ulang</Button>}</div>
    <div ref={contentRef}>
    {summaryOpen && owner ? <DailySummary storeName={storeName} userID={userID} /> : <>
    <ErrorBox>{error}</ErrorBox>
    {!purchase && <div className="history-filter flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
      <label className="pos-operating-date history-date-control" title="Pilih tanggal penjualan yang ingin ditampilkan.">
        <span className="pos-operating-caption">Tanggal penjualan <small>WIB</small></span>
        <span className="pos-operating-value" aria-hidden="true">{incomeDateLabel(date)}</span><CalendarDays className="pos-operating-icon" aria-hidden="true" />
        <input aria-label="Tanggal penjualan (WIB)" type="date" value={date} disabled={busy} onClick={event => {
          try { event.currentTarget.showPicker?.() } catch { /* Preserve the native date input when showPicker is unavailable. */ }
        }} onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          if (typeof event.currentTarget.showPicker !== 'function') return
          try { event.currentTarget.showPicker(); event.preventDefault() } catch { /* Preserve native keyboard behavior. */ }
        }} onChange={event => { if (event.target.value) { setDate(event.target.value); setOffset(0) } }} />
      </label>
      <Button variant="outline" disabled={busy} onClick={() => { setDate(jakartaDay()); setOffset(0) }}>Hari ini</Button>
    </div>}
    <Panel title={`Riwayat ${purchase ? 'Pembelian' : 'Penjualan'}`} subtitle={purchase ? undefined : `Tanggal ${incomeDateLabel(date)} · WIB`}>
      <div className="history-list">{rows.map(row => <button type="button" key={row.id} className="history-row" disabled={busy} aria-haspopup="dialog" aria-label={`Detail ${row.nomor}`} onClick={() => openDetail(row)}><span className="history-row-info"><strong>{row.nomor}</strong><span className="history-row-meta">{dateTime(row.tanggal)} · {data.payments.find(p => p.id === row.metode_pembayaran_id)?.nama}</span><span className="transaction-status" data-cancelled={row.status === 'BATAL'}>{row.status}</span></span><strong className="history-row-total">{money(row.total_tagihan ?? row.total_pembayaran ?? '0')}</strong><ChevronRight className="history-row-chevron" aria-hidden="true" /></button>)}{!rows.length && <p className="py-8 text-muted-foreground">{busy ? 'Memuat…' : purchase ? 'Belum ada transaksi.' : 'Tidak ada penjualan pada tanggal ini.'}</p>}</div>
      <div className="history-pagination mt-5 flex items-center justify-between"><Button variant="outline" disabled={busy || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 20))}>Sebelumnya</Button><span className="text-sm">Halaman {offset / 20 + 1}</span><Button variant="outline" disabled={busy || rows.length < 20} onClick={() => setOffset(n => n + 20)}>Berikutnya</Button></div>
    </Panel>
    <ResponsivePanel open={Boolean(target)} title={`Detail ${purchase ? 'Pembelian' : 'Penjualan'}`} closeLabel="Tutup detail transaksi" busy={actionBusy} onClose={closeDetail}>
      <h2 className="mb-3 break-all text-xl font-bold">{target?.nomor ?? selected?.nomor}</h2>
      <div className="history-detail-body">
        <ErrorBox>{detailError}</ErrorBox>
        {detailBusy && <p role="status" className="flex items-center justify-center gap-3 py-12"><LoaderCircle className="size-6 animate-spin" />Memuat detail transaksi…</p>}
        {!detailBusy && !selected && detailError && <Button className="mt-4" variant="outline" onClick={() => setDetailAttempt(value => value + 1)}>Coba lagi</Button>}
        {selected && <>
          <p className="mb-3 text-sm">{dateTime(selected.tanggal)} · Status: {selected.status} · {data.payments.find(payment => payment.id === selected.metode_pembayaran_id)?.nama}{purchase && selected.sumber_pembelian_id ? ` · ${data.sources.find(source => source.id === selected.sumber_pembelian_id)?.nama ?? ''}` : ''}</p>
          {!purchase && <p className="mb-3 break-words text-sm">Kasir: <span className="font-semibold">{selected.nama_kasir || 'Tidak diketahui'}</span></p>}
          {selected.detail?.map(line => <div key={line.id} className="flex justify-between gap-3 border-b py-3"><span className="min-w-0 break-words">{line.nama_produk}<small className="block text-muted-foreground">{line.jumlah} × {money(line.harga_jual ?? line.harga_beli ?? '0')} · diskon {money(line.diskon)}</small></span><strong className="shrink-0">{money(line.subtotal)}</strong></div>)}
          <dl className="my-4 space-y-2"><div className="flex justify-between"><dt>Diskon transaksi</dt><dd>{money(selected.diskon_transaksi)}</dd></div><div className="flex justify-between"><dt>Biaya pembayaran</dt><dd>{money(selected.biaya_pembayaran)}</dd></div><div className="flex justify-between gap-3 text-xl font-bold"><dt>Total</dt><dd>{money(selected.total_tagihan ?? selected.total_pembayaran ?? '0')}</dd></div>{!purchase && <><div className="flex justify-between"><dt>Uang diterima</dt><dd>{money(selected.jumlah_dibayar ?? '0')}</dd></div><div className="flex justify-between"><dt>Kembalian</dt><dd>{money(selected.kembalian ?? '0')}</dd></div></>}</dl>
          {!purchase && selected.status === 'SELESAI' && <BusyButton busy={actionBusy} busyLabel="Memproses…" onClick={async () => { setActionBusy(true); setDetailError(''); try { await print(selected) } catch (err) { setDetailError(message(err)) } finally { setActionBusy(false) } }}>Cetak Ulang Struk</BusyButton>}
          {owner && selected.status === 'SELESAI' && <form className="mt-5 flex flex-col gap-3 rounded-xl border p-4" onSubmit={async event => {
            event.preventDefault(); if (actionBusy) return
            if (!window.confirm(`Batalkan ${selected.nomor}? Stok akan dibalik. Proses refund dilakukan terpisah.`)) return
            setActionBusy(true); setDetailError('')
            try { await api(`/${path}/${selected.id}/batal`, 'POST', { alasan: reason }); await refresh(); await load(); setTarget(null); setReason('') }
            catch (err) { setDetailError(message(err)) }
            finally { setActionBusy(false) }
          }}><Field label="Alasan pembatalan" value={reason} onChange={setReason} required disabled={actionBusy} /><BusyButton type="submit" variant="outline" busy={actionBusy} busyLabel="Memproses…">Batalkan Transaksi</BusyButton></form>}
        </>}
      </div>
      <div className="history-detail-footer"><Button variant="outline" disabled={actionBusy} onClick={closeDetail}>Tutup <kbd>Esc</kbd></Button></div>
    </ResponsivePanel>
    </>}
    </div>
  </div>
}
