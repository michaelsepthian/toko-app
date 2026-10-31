'use client'
import { SearchSelect } from './search-select'
import { useEffect, useMemo, useRef, useState } from 'react'
import Decimal from 'decimal.js'
import { Barcode, Minus, Plus, Search, ShoppingBasket, Trash2, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, message } from '@/lib/api'
import type { CashPurchaseNote, CartLine, Data, Product, Transaction, TransactionInput, User } from '@/lib/types'
import { money, totals, validLines, validNumber } from '@/lib/pos'
import { useCheckout } from '@/lib/use-checkout'
import { ErrorBox, Field, inputClass } from './common'

export function Checkout({ user, data, purchase = false, active, onSaved }: { user: User; data: Data; purchase?: boolean; active: boolean; onSaved: (record: Transaction, purchase: boolean, print: boolean) => Promise<void> }) {
  const [cart, setCart] = useState<CartLine[]>([]); const [query, setQuery] = useState('')
  const [methodID, setMethodID] = useState(''); const [discount, setDiscount] = useState('0'); const [paid, setPaid] = useState('')
  const [sourceID, setSourceID] = useState(''); const [note, setNote] = useState(''); const [reference, setReference] = useState('')
  const [print, setPrint] = useState(true); const [modal, setModal] = useState(false); const [error, setError] = useState('')
  const [purchaseNotes, setPurchaseNotes] = useState<CashPurchaseNote[]>([])
  const [purchaseNoteID, setPurchaseNoteID] = useState('')
  const [noteRevision, setNoteRevision] = useState(0)
  const [notesLoading, setNotesLoading] = useState(false)
  const [notesError, setNotesError] = useState('')
  const [completed, setCompleted] = useState<Transaction | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const { submit, pending, busy } = useCheckout(user.id, purchase ? 'pembelian' : 'penjualan')
  const linkedNote = purchaseNotes.find(row => String(row.id) === purchaseNoteID)
  const methods = data.payments.filter(p => p.aktif && (purchase ? p.untuk_pembelian : p.untuk_penjualan))
  const selected = methods.find(p => String(p.id) === methodID) ?? methods[0]
  const valid = validLines(cart, discount)
  const preview = valid ? totals(cart, discount, selected, purchase) : totals([], '0', undefined, purchase)
  const amountPaid = selected?.jenis === 'CASH' ? paid || '0' : preview.total.toFixed(2)
  const sufficient = validNumber(amountPaid, 2, true) && new Decimal(amountPaid).gte(preview.total)
  const filtered = useMemo(() => data.products.filter(p => p.aktif && `${p.nama} ${p.sku} ${p.barcode ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [data.products, query])
  const stock = (id: number) => new Decimal(data.stocks.find(row => row.id === id)?.stok || 0)
  const locked = busy || Boolean(pending)

  useEffect(() => {
    if (!active || !purchase) return
    let current = true
    setNotesLoading(true); setNotesError('')
    async function load() {
      const rows: CashPurchaseNote[] = []
      for (let offset = 0; ; offset += 100) {
        const page = await api<CashPurchaseNote[]>(`/catatan-belanja?status=TERBUKA&limit=100&offset=${offset}`)
        if (!current) return
        rows.push(...page)
        if (page.length < 100) break
      }
      setPurchaseNotes(rows)
    }
    void load().catch(err => { if (current) setNotesError(message(err)) }).finally(() => { if (current) setNotesLoading(false) })
    return () => { current = false }
  }, [active, purchase, noteRevision])

  function add(product: Product) {
    if (locked) return
    setError('')
    setCart(current => {
      const old = current.find(item => item.product.id === product.id)
      const quantity = new Decimal(old?.quantity || 0).plus(1)
      if (old) return current.map(item => item.product.id === product.id ? { ...item, quantity: quantity.toString() } : item)
      if (current.length >= 200) { setError('Maksimal 200 produk per transaksi.'); return current }
      return [...current, { product, quantity: '1', price: purchase ? '' : product.harga_jual, discount: '0' }]
    })
    setQuery(''); search.current?.focus()
  }
  function update(id: number, patch: Partial<CartLine>) { if (!locked) setCart(current => current.map(item => item.product.id === id ? { ...item, ...patch } : item)) }
  async function scan(code: string) {
    if (locked || !code.trim()) return
    const exact = data.products.find(p => p.aktif && (p.barcode === code.trim() || p.sku === code.trim()))
    if (exact) { add(exact); return }
    setError(`Barcode/SKU ${code} tidak ditemukan. Pilih produk dari daftar atau daftarkan produknya.`)
  }
  useEffect(() => {
    if (!active) return
    let buffer = ''; let last = 0
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'F2') { event.preventDefault(); search.current?.focus(); return }
      if (event.key === 'F8' && valid && selected && !locked) { event.preventDefault(); setCompleted(null); setModal(true); return }
      if (modal || locked || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      const target = event.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return
      const time = performance.now()
      if (event.key === 'Enter' && buffer.length >= 4 && time - last < 150) { event.preventDefault(); void scan(buffer); buffer = ''; return }
      if (event.key.length === 1) { buffer = time - last < 150 ? buffer + event.key : event.key; last = time }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })

  useEffect(() => {
    if (!modal || !active || !dialogRef.current) return
    const dialog = dialogRef.current
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled]),select:not([disabled]),[tabindex="0"]'))
    ;(focusable()[0] ?? dialog).focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) setModal(false) }
      if (event.key !== 'Tab') return
      const nodes = focusable(); const first = nodes[0]; const last = nodes[nodes.length - 1]
      if (!nodes.length) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    dialog.addEventListener('keydown', keydown)
    return () => { dialog.removeEventListener('keydown', keydown); previous?.focus() }
  }, [modal, active, completed, busy])

  async function save(retry = false) {
    setError('')
    if (!retry && (!valid || !selected || (!purchase && !sufficient))) { setError('Periksa jumlah, harga, diskon, metode, dan pembayaran.'); return }
    if (!retry && purchaseNoteID && (!linkedNote || !preview.total.eq(linkedNote.total))) { setError('Total rincian harus sama dengan catatan belanja.'); return }
    const body: TransactionInput = { metode_pembayaran_id: selected?.id ?? 0, diskon_transaksi: discount,
      nomor_referensi: reference || null, items: cart.map(line => ({ produk_id: line.product.id, jumlah: line.quantity, diskon: line.discount, ...(purchase ? { harga_beli: line.price } : {}) })),
      ...(purchase ? { ...(purchaseNoteID ? { catatan_belanja_id: Number(purchaseNoteID) } : {}), sumber_pembelian_id: sourceID ? Number(sourceID) : null, nomor_nota: note || null } : { jumlah_dibayar: amountPaid }) }
    try {
      const record = await submit(retry ? undefined : body)
      if (!record) return
      setCart([]); setPaid(''); setDiscount('0'); setNote(''); setReference(''); setPurchaseNoteID(''); setNoteRevision(value => value + 1)
      setCompleted(record); setModal(true)
      await onSaved(record, purchase, print)
    } catch (err) { setError(message(err)) }
  }
  return <div hidden={!active}>
    <div className="mx-auto grid max-w-[1600px] gap-4 p-4 xl:grid-cols-[minmax(480px,1fr)_minmax(450px,1fr)]">
      <section className="rounded-3xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b p-5"><div><h1 className="text-xl font-bold">{purchase ? 'Catat Pembelian Produk' : 'Daftar Belanja'}</h1><p className="text-sm text-muted-foreground">{purchase ? 'Barang masuk dan harga beli aktual' : `${cart.length} jenis produk · F8 untuk bayar`}</p></div><Button variant="ghost" disabled={locked} onClick={() => setCart([])}><Trash2 />Kosongkan</Button></div>
        <div className="space-y-3 p-4"><ErrorBox>{error}</ErrorBox>{pending && <div role="status" className="rounded-xl border border-amber-400 p-4"><p>Hasil transaksi sebelumnya belum dikonfirmasi. Lanjutkan request yang sama agar tidak tercatat dua kali.</p><Button className="mt-2" disabled={busy} onClick={() => void save(true)}>{busy ? 'Memeriksa…' : 'Periksa / lanjutkan transaksi'}</Button></div>}
          {purchase && <div className="space-y-2 rounded-xl border bg-muted/50 p-3"><label className="text-sm font-semibold">Lengkapi catatan belanja<SearchSelect aria-label="Lengkapi catatan belanja" className={inputClass} disabled={locked || notesLoading} value={purchaseNoteID} onValueChange={setPurchaseNoteID}><option value="">Pembelian baru (tanpa catatan sebelumnya)</option>{purchaseNotes.map(row => <option key={row.id} value={row.id}>#{row.id} · {row.tanggal} · {money(row.total)} {row.catatan}</option>)}</SearchSelect></label>{notesLoading && <p className="text-xs">Memuat catatan belanja…</p>}{notesError && <div className="text-sm text-destructive">{notesError}<Button variant="ghost" onClick={() => setNoteRevision(value => value + 1)}>Muat ulang catatan</Button></div>}{linkedNote && <p className="text-sm text-primary">Uang keluar sudah dicatat pada {linkedNote.tanggal}, sebesar {money(linkedNote.total)}. Isi rincian dengan total yang sama; pengeluaran ini tidak dihitung lagi.</p>}</div>}
          {purchase && <div className="grid gap-3 sm:grid-cols-2"><div className="text-sm font-semibold"><span>Tempat beli / sales</span><SearchSelect className={inputClass} disabled={locked} value={sourceID} onValueChange={value => setSourceID(value)} aria-label="Tempat beli / sales"><option value="">Tidak dicatat</option>{data.sources.filter(s => s.aktif).map(s => <option key={s.id} value={s.id}>{s.nama} ({s.jenis})</option>)}</SearchSelect></div><Field label="Nomor nota (opsional)" value={note} onChange={setNote} disabled={locked} /></div>}
          <fieldset disabled={locked} className="space-y-2">
            {!cart.length && <div className="py-14 text-center text-muted-foreground"><ShoppingBasket className="mx-auto mb-3 size-10" />{purchase ? 'Pilih atau scan barang yang dibeli.' : 'Cari atau scan produk untuk mulai berjualan.'}</div>}
            {cart.map(item => <article key={item.product.id} className="rounded-2xl border bg-background p-3"><div className="flex items-center justify-between gap-2"><div><h2 className="font-bold">{item.product.nama}</h2><p className="text-xs text-muted-foreground">{item.product.sku} · stok {stock(item.product.id).toString()}</p></div><Button variant="ghost" aria-label={`Hapus ${item.product.nama}`} onClick={() => setCart(current => current.filter(line => line.product.id !== item.product.id))}><Trash2 /></Button></div><div className="mt-3 grid grid-cols-2 gap-3"><div><span className="text-xs font-semibold">Jumlah</span><div className="flex gap-1"><Button variant="outline" aria-label={`Kurangi ${item.product.nama}`} onClick={() => { const n = new Decimal(item.quantity || 0).minus(1); if (n.gt(0)) update(item.product.id, { quantity: n.toString() }) }}><Minus /></Button><input aria-label={`Jumlah ${item.product.nama}`} className={`${inputClass} min-w-0 text-center`} inputMode="decimal" value={item.quantity} onChange={e => { if (/^(\d+(?:\.\d*)?)?$/.test(e.target.value)) update(item.product.id, { quantity: e.target.value }) }} /><Button variant="outline" aria-label={`Tambah ${item.product.nama}`} onClick={() => add(item.product)}><Plus /></Button></div></div>{purchase ? <Field label={`Harga beli ${item.product.nama}`} type="decimal" value={item.price} onChange={price => update(item.product.id, { price })} /> : <div className="self-end py-3 text-right font-semibold">{money(item.price)} / {data.units.find(u => u.id === item.product.satuan_id)?.nama ?? 'unit'}</div>}<Field label={`Diskon ${item.product.nama}`} type="decimal" value={item.discount} onChange={discount => update(item.product.id, { discount })} /></div></article>)}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Diskon transaksi" type="decimal" value={discount} onChange={setDiscount} disabled={locked} /><div className="text-sm font-semibold"><span>Metode pembayaran</span><SearchSelect aria-label="Metode pembayaran" className={inputClass} disabled={locked} value={selected?.id ?? ''} onValueChange={value => setMethodID(value)}>{!methods.length && <option value="">Belum ada metode aktif</option>}{methods.map(p => <option key={p.id} value={p.id}>{p.nama}</option>)}</SearchSelect></div></div>
          <dl className="space-y-2 rounded-2xl bg-muted p-4 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(preview.subtotal)}</dd></div><div className="flex justify-between"><dt>Biaya metode {selected?.penanggung_biaya === 'TOKO' && !purchase ? '(ditanggung toko)' : ''}</dt><dd>{money(preview.fee)}</dd></div><div className="flex justify-between text-2xl font-black"><dt>{purchase ? 'Total pembelian' : 'Total bayar'}</dt><dd>{money(preview.total)}</dd></div></dl>
          {!purchase && <label className="flex items-center gap-2 py-2"><input type="checkbox" checked={print} onChange={e => setPrint(e.target.checked)} />Cetak struk setelah pembayaran</label>}
          <Button className="h-14 w-full text-lg" disabled={!valid || !selected || locked} onClick={() => { setCompleted(null); setModal(true) }}><WalletCards />{purchase ? 'Simpan Pembelian' : 'Bayar'} · F8</Button>
        </div>
      </section>
      <section className="h-fit rounded-3xl border bg-card shadow-sm"><div className="border-b p-4"><h2 className="text-xl font-bold">Pilih Produk</h2><form className="mt-3 flex items-center gap-3 rounded-2xl border-2 border-primary/30 px-4" onSubmit={e => { e.preventDefault(); const exact = data.products.find(p => p.aktif && (p.barcode === query || p.sku === query)); if (exact) add(exact); else if (filtered.length === 1 && !/^\d{5,}$/.test(query)) add(filtered[0]); else void scan(query) }}><Search /><input ref={search} aria-label={purchase ? 'Cari atau scan produk pembelian' : 'Cari atau scan produk penjualan'} className="h-14 min-w-0 flex-1 bg-transparent outline-none" value={query} disabled={locked} onChange={e => setQuery(e.target.value)} placeholder="Nama, SKU, atau scan barcode + Enter" /><Barcode /></form><p className="mt-2 text-xs text-muted-foreground">F2 fokus pencarian · Scanner USB mode keyboard + Enter</p></div><div className="grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">{(active ? filtered : []).map(product => <button key={product.id} disabled={locked} onClick={() => add(product)} className="flex min-h-36 flex-col rounded-2xl border bg-background p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-40"><span className="text-xs text-muted-foreground">{data.categories.find(c => c.id === product.kategori_id)?.nama} · {product.sku}</span><span className="mt-2 text-lg font-bold">{product.nama}</span><span className="mt-auto pt-3 text-xl font-bold">{money(product.harga_jual)}</span><span className="text-sm text-muted-foreground">Stok {stock(product.id).toString()}</span></button>)}{!filtered.length && <p className="col-span-full py-10 text-center text-muted-foreground">Belum ada produk yang cocok. Pemilik dapat menambahnya dari menu Produk.</p>}</div></section>
    </div>
    {modal && active && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"><section ref={dialogRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !locked && !completed && (purchase || sufficient)) { e.preventDefault(); void save() } }} role="dialog" aria-modal="true" aria-labelledby={`${purchase ? 'buy' : 'sale'}-title`} className="w-full max-w-lg space-y-4 rounded-3xl bg-card p-6"><h2 id={`${purchase ? 'buy' : 'sale'}-title`} className="text-2xl font-bold">{completed ? 'Transaksi tersimpan' : purchase ? 'Konfirmasi Pembelian' : 'Konfirmasi Pembayaran'}</h2><ErrorBox>{error}</ErrorBox>{completed ? <><p className="break-all font-mono text-sm">{completed.nomor} · {completed.status}</p><p className="text-3xl font-black">{money(completed.total_tagihan ?? completed.total_pembayaran ?? '0')}</p>{!purchase && <p>Kembalian: <strong>{money(completed.kembalian ?? '0')}</strong></p>}<Button className="w-full" onClick={() => { setModal(false); setCompleted(null); search.current?.focus() }}>Selesai</Button></> : <><p className="text-4xl font-black">{money(preview.total)}</p><p>{selected?.nama}</p>{!purchase && selected?.jenis === 'CASH' && <Field label="Uang diterima" value={paid} onChange={setPaid} type="decimal" disabled={locked} />}{!purchase && selected?.jenis !== 'CASH' && <p className="text-sm text-muted-foreground">Pastikan pembayaran pada terminal/QRIS sudah berhasil. Aplikasi hanya mencatat pembayaran.</p>}<Field label="Referensi pembayaran (opsional)" value={reference} onChange={setReference} disabled={locked} /><div className="flex gap-3"><Button variant="outline" disabled={busy} onClick={() => setModal(false)}>Tutup</Button><Button className="flex-1" disabled={locked || (!purchase && !sufficient)} onClick={() => void save()}>{busy ? 'Menyimpan…' : 'Konfirmasi & Simpan'}</Button></div></>}</section></div>}
  </div>
}
