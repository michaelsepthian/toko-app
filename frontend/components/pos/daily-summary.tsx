'use client'
import { createUUID } from '@/lib/uuid'
import Decimal from 'decimal.js'
import { useEffect, useRef, useState } from 'react'
import { Download, FileText, LoaderCircle, Mail, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { ResponsivePanel } from '@/components/ui/responsive-panel'
import { api, message } from '@/lib/api'
import { useNotice } from '@/lib/use-notice'
import { jakartaDay } from '@/lib/history-date'
import { dateTime, money, validNumber } from '@/lib/pos'
import { reconcileDailyCash, saveDailySummaryAttempt } from '@/lib/daily-summary'
import type { DailySnapshot, DailySummaryEmail, DailySummaryInput, DailySummaryRecord } from '@/lib/types'
import { CashPurchaseNotes } from './cash-purchase-notes'
import { ErrorBox, Field, inputClass, Panel, RupiahField } from './common'

type Form = Pick<DailySummaryInput, 'kas_aktual' | 'belanja_besok' | 'email_tujuan' | 'catatan'>
const emptyForm = (): Form => ({ kas_aktual: '', belanja_besok: '', email_tujuan: '', catatan: '' })
export function DailySummary({ storeName, userID }: { storeName: string; userID: number }) {
  const [date, setDate] = useState(jakartaDay)
  const [live, setLive] = useState<DailySnapshot | null>(null)
  const [rows, setRows] = useState<DailySummaryRecord[]>([])
  const [selected, setSelected] = useState<DailySummaryRecord | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [revision, setRevision] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [pending, setPending] = useState<DailySummaryInput | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useNotice()
  const [email, setEmail] = useState<DailySummaryEmail | null>(null)
  const [emailBusy, setEmailBusy] = useState(false)
  const saveLock = useRef(false)
  const pendingKey = `toko:pending-daily-summary:${userID}`
  const snapshot = selected?.snapshot ?? live
  const controlsLocked = saving || Boolean(pending)
  const readOnly = controlsLocked || Boolean(selected)
  const valid = validNumber(form.kas_aktual, 2, true) && validNumber(form.belanja_besok || '0', 2, true)
  const legacy = Boolean(selected && (selected.snapshot.versi ?? 1) < 2)
  const calculated = snapshot ? reconcileDailyCash(snapshot, form.kas_aktual, form.belanja_besok) : null
  const cash = selected ? { totalExpected: new Decimal(selected.total_dana_seharusnya), totalActual: new Decimal(selected.total_dana_aktual), difference: new Decimal(selected.selisih_kas), remaining: new Decimal(selected.sisa_kas), expectedRemaining: new Decimal(selected.total_dana_seharusnya).minus(selected.belanja_besok) } : calculated
  const overBudget = Boolean(cash?.remaining.isNegative())
  const reportChanged = Boolean(selected && live && selected.snapshot.hash_sumber !== live.hash_sumber)
  // total_selesai sudah mengecualikan BATAL; jangan mengurangi total_batal dua kali.
  const income = snapshot ? new Decimal(snapshot.total_selesai) : new Decimal(0)
  const canceled = snapshot ? new Decimal(snapshot.total_batal) : new Decimal(0)
  const beforeCancellation = income.plus(canceled)

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(pendingKey)
      if (saved) {
        const body: DailySummaryInput = JSON.parse(saved)
        if (!body.idempotency_key || !body.tanggal || !body.hash_sumber) throw new Error('invalid')
        setPending(body); setDate(body.tanggal); setForm(body)
        setNotice('Penyimpanan sebelumnya belum terkonfirmasi. Klik Coba simpan lagi untuk memeriksa laporan yang sama.')
      }
    } catch { setError('Data penyimpanan laporan sebelumnya tidak dapat dibaca. Periksa histori sebelum menyimpan laporan baru.') }
  }, [pendingKey])
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void Promise.all([
      api<DailySnapshot>(`/ringkasan-harian/preview?tanggal=${date}`),
      api<DailySummaryRecord[]>(`/ringkasan-harian?tanggal=${date}&limit=10&offset=${offset}`),
    ]).then(([preview, saved]) => { if (active) { setLive(preview); setRows(saved) } })
      .catch(err => { if (active) setError(message(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date, revision, offset])
  useEffect(() => {
    function refreshWhenVisible() {
      if (!document.hidden && !controlsLocked) setRevision(value => value + 1)
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [controlsLocked])

  function changeDate(value: string) {
    if (!value || controlsLocked) return
    setDate(value); setSelected(null); setLive(null); setRows([]); setForm(emptyForm()); setOffset(0); setNotice('')
  }
  function openSaved(record: DailySummaryRecord) {
    if (controlsLocked) return
    setSelected(record); setError(''); setNotice('')
    setForm({ kas_aktual: record.kas_aktual, belanja_besok: record.belanja_besok, email_tujuan: record.email_tujuan ?? '', catatan: record.catatan })
  }
  async function save() {
    if (saveLock.current || (!pending && (!live || !valid || loading))) return
    saveLock.current = true; setSaving(true); setError(''); setNotice('')
    try {
      const body = pending ?? { ...form, belanja_besok: form.belanja_besok || '0', versi_perhitungan: 2, nama_toko: storeName, tanggal: date, hash_sumber: live!.hash_sumber, idempotency_key: createUUID() }
      const record = await saveDailySummaryAttempt(sessionStorage, pendingKey, body, payload => api<DailySummaryRecord>('/ringkasan-harian', 'POST', payload), setPending)
      setSelected(record); setRows(previous => [record, ...previous.filter(row => row.id !== record.id)].slice(0, 10))
      setForm({ kas_aktual: record.kas_aktual, belanja_besok: record.belanja_besok, email_tujuan: record.email_tujuan ?? '', catatan: record.catatan }); setOffset(0)
      setNotice('Ringkasan harian tersimpan. Data ini menjadi snapshot tetap; perubahan berikutnya disimpan sebagai laporan baru.')
      setEditorOpen(false)
    } catch (err) { setError(message(err)) }
    finally { saveLock.current = false; setSaving(false) }
  }
  async function previewEmail() {
    if (!selected || emailBusy) return
    setEmailBusy(true); setError('')
    try { setEmail(await api<DailySummaryEmail>(`/ringkasan-harian/${selected.id}/email`)) }
    catch (err) { setError(message(err)) }
    finally { setEmailBusy(false) }
  }
  function downloadEmail() {
    if (!email) return
    const url = URL.createObjectURL(new Blob([email.html], { type: 'text/html;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `ringkasan-${date}-${selected?.id}.html`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
      <Field label="Tanggal laporan (WIB)" type="date" value={date} disabled={controlsLocked} onChange={changeDate} />
      <Button variant="outline" disabled={controlsLocked} onClick={() => changeDate(jakartaDay())}>Hari ini</Button>
      <Button variant="outline" disabled={loading || controlsLocked} onClick={() => { setSelected(null); setRevision(value => value + 1); setNotice('Menampilkan data terbaru, termasuk pembatalan. Laporan tersimpan tidak diubah.') }}><RefreshCw className={loading ? 'animate-spin' : ''} />Muat ulang</Button>
      <p className="text-sm text-muted-foreground">{selected ? `Laporan tersimpan #${selected.id} · Angka saat laporan dibuat` : 'Data terbaru berdasarkan tanggal pendapatan (WIB)'}</p>
    </div>
    <ErrorBox>{error}</ErrorBox>
    {notice && <p role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{notice}</p>}
    {reportChanged && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>Transaksi telah berubah sejak laporan ini disimpan. Pendapatan terbaru dapat berbeda, termasuk karena pembatalan atau penjualan tambahan.</p><Button variant="outline" className="mt-2" disabled={controlsLocked} onClick={() => { setSelected(null); setRevision(value => value + 1); setNotice('Data terbaru ditampilkan. Simpan sebagai versi baru bila diperlukan.') }}>Lihat pendapatan terbaru</Button></div>}
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Memuat ringkasan…</p>}
    {snapshot && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[['Pendapatan setelah pembatalan', income.toString(), `${snapshot.jumlah_selesai} transaksi berhasil · sudah dikurangi pembatalan`], ['Dibatalkan', snapshot.total_batal, `${snapshot.jumlah_batal} transaksi · tidak dihitung sebagai pendapatan`], ['Total tunai', snapshot.total_cash, 'Pendapatan CASH setelah pembatalan'], ['Total non-tunai', snapshot.total_non_cash, 'Pendapatan non-tunai setelah pembatalan']].map(([label, amount, note]) => <div key={label} className="rounded-2xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><strong className={`mt-2 block break-words text-2xl font-bold tabular-nums ${label === 'Dibatalkan' ? 'text-destructive' : ''}`}>{money(amount)}</strong><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>)}
      </div>
      <Panel title="Rincian metode pembayaran" subtitle={`Data sampai ${dateTime(snapshot.dihitung_pada)} WIB${selected ? ' · Snapshot tersimpan' : ''}`}>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="pb-3">Metode</th><th className="pb-3 text-right">Berhasil</th><th className="pb-3 text-right">Total berhasil</th><th className="pb-3 text-right">Batal</th><th className="pb-3 text-right">Total batal</th></tr></thead><tbody>{snapshot.metode.map(row => <tr key={row.metode_pembayaran_id} className="border-b"><td className="py-3 font-semibold">{row.nama}<small className="block font-normal text-muted-foreground">{row.jenis}</small></td><td className="text-right">{row.jumlah_selesai}</td><td className="text-right tabular-nums">{money(row.total_selesai)}</td><td className="text-right">{row.jumlah_batal}</td><td className="text-right tabular-nums">{money(row.total_batal)}</td></tr>)}{!snapshot.metode.length && <tr><td colSpan={5} className="py-6 text-muted-foreground">Tidak ada penjualan pada tanggal ini.</td></tr>}</tbody><tfoot><tr className="font-bold"><td className="pt-4">Total semua metode</td><td className="pt-4 text-right">{snapshot.jumlah_selesai}</td><td className="pt-4 text-right tabular-nums">{money(snapshot.total_selesai)}</td><td className="pt-4 text-right">{snapshot.jumlah_batal}</td><td className="pt-4 text-right tabular-nums">{money(snapshot.total_batal)}</td></tr></tfoot></table></div>

        <p className="mt-3 text-xs text-muted-foreground">Penjualan dan pembatalan dikelompokkan menurut tanggal pendapatan, bukan waktu pencatatan atau tanggal refund. Total berhasil sudah dikurangi pembatalan. Laporan tersimpan mempertahankan angka saat dibuat.</p>
      </Panel>
      {!legacy && <Panel title="Belanja toko hari ini" subtitle="Pembelian yang dicatat langsung dan pengeluaran yang belum dirinci masuk otomatis.">
        <div className="grid gap-3 rounded-xl bg-muted p-3 text-sm sm:grid-cols-3"><p>Alokasi dari kemarin<strong className="block text-lg">{money(snapshot.alokasi_sebelumnya || '0')}</strong></p><p>Total belanja<strong className="block text-lg">{money(snapshot.total_pembelian || '0')}</strong></p><p>Sisa / kekurangan anggaran<strong className={`block text-lg ${new Decimal(snapshot.selisih_belanja || 0).isNegative() ? 'text-destructive' : 'text-primary'}`}>{money(snapshot.selisih_belanja || '0')}</strong></p></div>
        <div className="mt-3 divide-y">{snapshot.pembelian?.map((row, index) => <details key={row.catatan_id ? `note:${row.catatan_id}` : `purchase:${row.pembelian_id ?? index}`} className="py-3"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold">{row.nomor || `Pengeluaran #${row.catatan_id}`}<span className="ml-2 font-normal text-muted-foreground">{row.metode}</span></span><strong>{money(row.total)}</strong></summary><div className="mt-2 rounded-xl bg-muted/50 p-3 text-sm">{row.catatan && <p className="mb-2 text-muted-foreground">{row.catatan}</p>}{row.belum_dirinci ? <p>Rincian barang dapat dilengkapi pada menu Pembelian.</p> : row.items.length ? row.items.map((item, i) => <p key={i} className="flex justify-between gap-3 py-1"><span>{item.nama} × {item.jumlah}</span><span>{money(item.subtotal)}</span></p>) : <p>Rincian barang belum tersedia.</p>}</div></details>)}{!snapshot.pembelian?.length && <p className="py-4 text-sm text-muted-foreground">Belum ada belanja tercatat.</p>}</div>
      </Panel>}
      {!selected && <CashPurchaseNotes date={date} userID={userID} disabled={readOnly} onChanged={() => setRevision(value => value + 1)} />}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="Ringkasan dana harian" subtitle="Penjualan dan pembelian dari seluruh metode pembayaran dihitung bersama.">
          {legacy && <p className="mb-3 rounded-xl bg-muted p-3 text-sm">Laporan ini memakai format lama. Angka tersimpan tetap dipertahankan.</p>}
          <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
            <p className="flex justify-between gap-3"><span>Penjualan sebelum pembatalan</span><strong>{money(beforeCancellation)}</strong></p>
            <p className="flex justify-between gap-3 text-destructive"><span>− Transaksi dibatalkan</span><strong>{money(canceled)}</strong></p>
            <p className="flex justify-between gap-3 border-t pt-2"><span>Pendapatan setelah pembatalan</span><strong>{money(income)}</strong></p>
            {!legacy && <p className="flex justify-between gap-3"><span>+ Alokasi belanja dari kemarin</span><strong>{money(snapshot.alokasi_sebelumnya || '0')}</strong></p>}
            <p className="flex justify-between gap-3"><span>− Total belanja hari ini</span><strong>{money(snapshot.total_pembelian ?? snapshot.pembelian_cash)}</strong></p>
            {!legacy && !snapshot.alokasi_sebelumnya_id && <p className="text-xs text-muted-foreground">Belum ada laporan untuk hari sebelumnya; alokasi memakai Rp 0.</p>}
          </div>
          <p className="mt-4 text-sm">Total uang aktual: <strong>{form.kas_aktual === '' ? 'Belum diisi' : money(form.kas_aktual)}</strong></p>
          {!legacy && <p className="mt-2 text-xs text-muted-foreground">Masukkan gabungan uang tunai dan dana non-tunai yang tersedia, termasuk sisa alokasi belanja kemarin.</p>}
          {cash && <dl className="mt-4 space-y-3 border-t pt-4 text-sm"><div className="flex justify-between gap-3 text-base"><dt>Total dana seharusnya</dt><dd className="font-bold tabular-nums">{money(cash.totalExpected)}</dd></div><div className="flex justify-between gap-3"><dt>Total uang aktual</dt><dd className="font-bold tabular-nums">{form.kas_aktual === '' ? '—' : money(cash.totalActual)}</dd></div><div className="flex justify-between gap-3"><dt>Selisih aktual − seharusnya</dt><dd className={`font-bold tabular-nums ${cash.difference.isZero() ? 'text-primary' : 'text-destructive'}`}>{form.kas_aktual === '' ? '—' : money(cash.difference)}</dd></div></dl>}
          <p className="mt-3 text-xs text-muted-foreground">Dana seharusnya = pendapatan setelah pembatalan + alokasi kemarin − belanja hari ini. Transaksi batal tidak dihitung dua kali dan pengeluaran yang dilengkapi rinciannya dihitung satu kali.</p>
        </Panel>
        <Panel title="Alokasi belanja besok" subtitle="Disisihkan dari total dana hari ini. Sisa uang boleh minus.">
          <p className="text-sm">Alokasi besok: <strong>{money(form.belanja_besok || '0')}</strong></p>
          {form.email_tujuan && <p className="mt-2 text-sm">Email tujuan: {form.email_tujuan}</p>}
          {form.catatan && <p className="mt-2 text-sm">{form.catatan}</p>}
          {cash && <p className="mt-4 border-t pt-4 text-sm">Uang diterima sesungguhnya setelah alokasi<strong className={`mt-1 block text-2xl tabular-nums ${overBudget ? 'text-destructive' : 'text-primary'}`}>{form.kas_aktual === '' ? '—' : money(cash.remaining)}</strong></p>}
          {cash && !legacy && <p className="mt-2 text-sm text-muted-foreground">Sisa menurut perhitungan: <strong className={cash.expectedRemaining.isNegative() ? 'text-destructive' : ''}>{money(cash.expectedRemaining)}</strong></p>}
          {overBudget && form.kas_aktual !== '' && <p role="status" className="mt-2 text-sm text-destructive">Dana kurang setelah alokasi. Nilai minus tetap dapat disimpan.</p>}
          <div className="mt-5 flex flex-wrap gap-2">{!selected && <Button disabled={saving || (!pending && loading)} onClick={() => setEditorOpen(true)}>{pending ? 'Coba simpan lagi' : 'Isi Ringkasan'}</Button>}{selected && <><Button type="button" variant="outline" disabled={controlsLocked} onClick={() => { setSelected(null); setRevision(value => value + 1); setEditorOpen(true); setNotice('Membuat versi baru. Periksa kembali total uang dan alokasi sebelum menyimpan.') }}><FileText />Buat versi terbaru</Button><BusyButton type="button" busy={emailBusy} busyLabel="Memuat…" onClick={() => void previewEmail()}><Mail />Pratinjau email</BusyButton></>}</div>
          <p className="mt-3 text-xs text-muted-foreground">Template email disiapkan dari laporan tersimpan. Email belum dikirim otomatis.</p>
        </Panel>
      </div>
      <ResponsivePanel open={editorOpen} title="Isi Ringkasan Harian" busy={saving} dirty={pending ? false : undefined} onClose={() => setEditorOpen(false)}>
        <ErrorBox>{error}</ErrorBox><form onSubmit={event => { event.preventDefault(); void save() }}><fieldset disabled={readOnly || loading} className="space-y-4">
          <RupiahField label="Total uang aktual yang dihitung pemilik" value={form.kas_aktual} onChange={kas_aktual => setForm({ ...form, kas_aktual })} required />
          <RupiahField label="Uang belanja toko untuk besok (opsional)" value={form.belanja_besok} onChange={belanja_besok => setForm({ ...form, belanja_besok })} />
          <Field label="Email tujuan (opsional, untuk persiapan pengiriman)" type="email" value={form.email_tujuan} onChange={email_tujuan => setForm({ ...form, email_tujuan })} />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Catatan<textarea className={`${inputClass} h-24 py-3 font-normal`} maxLength={5000} value={form.catatan} onChange={event => setForm({ ...form, catatan: event.target.value })} placeholder="Selisih kas, kebutuhan belanja besok, atau informasi lain…" /></label>
        </fieldset>{cash && <p className="my-4 text-sm">Sisa setelah alokasi: <strong>{money(cash.remaining)}</strong></p>}<BusyButton type="submit" busy={saving} disabled={!pending && (loading || !valid)}>{pending ? 'Coba simpan lagi' : 'Simpan Ringkasan'}</BusyButton></form>
      </ResponsivePanel>
    </>}
    <Panel title="Histori ringkasan tersimpan" subtitle={`Tanggal ${date} · Setiap versi mempertahankan hasil saat disimpan.`}>
      <div className="divide-y">{rows.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><strong>Laporan #{row.id}</strong><p className="text-sm text-muted-foreground">{dateTime(row.created_at)} · {row.nama_pencatat}</p><p className="text-xs text-muted-foreground">{(row.snapshot.versi ?? 1) < 2 ? 'Uang fisik' : 'Total uang aktual'} {money(row.kas_aktual)} · Belanja besok {money(row.belanja_besok)}</p></div><Button variant={selected?.id === row.id ? 'default' : 'outline'} disabled={controlsLocked} onClick={() => openSaved(row)}>Lihat laporan</Button></div>)}{!rows.length && <p className="py-5 text-sm text-muted-foreground">{loading ? 'Memuat histori…' : 'Belum ada ringkasan tersimpan pada tanggal ini.'}</p>}</div>
      <div className="mt-4 flex items-center justify-between"><Button variant="outline" disabled={loading || controlsLocked || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 10))}>Sebelumnya</Button><span className="text-sm">Halaman {offset / 10 + 1}</span><Button variant="outline" disabled={loading || controlsLocked || rows.length < 10} onClick={() => setOffset(value => value + 10)}>Berikutnya</Button></div>
    </Panel>
    <ResponsivePanel open={Boolean(email)} title="Template email ringkasan" closeLabel="Tutup pratinjau email" className="responsive-panel-wide" dirty={false} onClose={() => setEmail(null)}>
      {email && <><p className="text-sm text-muted-foreground">{email.subject}</p><p className="mb-4 text-xs text-muted-foreground">{email.to ? `Tujuan: ${email.to}` : 'Email tujuan belum diisi'} · Belum dikirim</p><iframe className="h-[60dvh] w-full rounded-xl border bg-white" title="Pratinjau email ringkasan harian" sandbox="" srcDoc={email.html} /><Button className="mt-4" onClick={downloadEmail}><Download />Unduh HTML email</Button></>}
    </ResponsivePanel>
  </div>
}
