'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Decimal from 'decimal.js'
import { Banknote, Barcode, Check, CircleAlert, CreditCard, LoaderCircle, Minus, Plus, Printer, QrCode, RotateCcw, Search, ShoppingBasket, Trash2, WalletCards, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, message } from '@/lib/api'
import { exactProduct, groupedCash, isBarcodeQuery, isSearchCharacter } from '@/lib/keyboard'
import { money, totals, validLines, validNumber } from '@/lib/pos'
import type { CartLine, Data, Product, Transaction, TransactionInput, User } from '@/lib/types'
import { useCheckout } from '@/lib/use-checkout'
import { useSaleDrafts } from '@/lib/use-sale-drafts'
import type { SaleSlot } from '@/lib/sale-drafts'
import { ErrorBox, Field } from './common'
import { SaleLayout } from './sale-layout'
import { SaleCatalog } from './sale-catalog'
import { SearchSelect } from './search-select'
import { parseProductOrder, productSortOptions, sortProducts, type ProductOrderSettings, type ProductPopularity, type ProductSort } from '@/lib/product-sort'

type Props = { user: User; data: Data; active: boolean; onSaved: (sale: Transaction, purchase: boolean, print: boolean) => Promise<void>; onReprint: (sale: Transaction) => Promise<void>; onProductUpdated: (product: Product) => void }

export function SaleCheckout({ user, data, active, onSaved, onReprint, onProductUpdated }: Props) {
  const drafts = useSaleDrafts(user.id)
  const { cart, methodID, paid, reference, print } = drafts.draft
  const setCart = (cart: CartLine[]) => drafts.update({ cart })
  const setMethodID = (methodID: number | null) => drafts.update({ methodID })
  const setPaid = (paid: string) => drafts.update({ paid })
  const setReference = (reference: string) => drafts.update({ reference })
  const setPrint = (print: boolean) => drafts.update({ print })
  const cartRef = useRef<CartLine[]>([])
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [order, setOrder] = useState<ProductOrderSettings>({ sort: 'recommended', favoritesFirst: false })
  const [orderReady, setOrderReady] = useState(false)
  const [popularity, setPopularity] = useState<ProductPopularity[]>([])
  const [popularityRevision, setPopularityRevision] = useState(0)
  const [popularityLoading, setPopularityLoading] = useState(false)
  const [popularityError, setPopularityError] = useState(false)
  const orderKey = `toko:sale-product-order:${user.id}`
  const favorites = useMemo(() => new Set(data.products.filter(product => product.is_favorit).map(product => product.id)), [data.products])
  const frequency = useMemo(() => new Map(popularity.map(row => [row.produk_id, row.transaksi])), [popularity])
  useEffect(() => {
    try { setOrder(parseProductOrder(localStorage.getItem(orderKey))) } catch { /* Storage is optional. */ }
    setOrderReady(true)
  }, [orderKey])
  useEffect(() => {
    if (!orderReady) return
    try { localStorage.setItem(orderKey, JSON.stringify(order)) } catch { /* Keep sorting available without storage. */ }
  }, [order, orderKey, orderReady])
  useEffect(() => {
    let current = true
    setPopularityLoading(true); setPopularityError(false)
    void api<ProductPopularity[]>('/produk/popularitas').then(rows => { if (current) setPopularity(rows) })
      .catch(() => { if (current) setPopularityError(true) })
      .finally(() => { if (current) setPopularityLoading(false) })
    return () => { current = false }
  }, [popularityRevision])
  const [favoriteBusyID, setFavoriteBusyID] = useState<number | null>(null)
  const favoriteLock = useRef(false)
  async function toggleFavorite(id: number) {
    if (user.peran !== 'PEMILIK' || favoriteLock.current || locked) return
    const product = data.products.find(product => product.id === id)
    if (!product) return
    favoriteLock.current = true; setFavoriteBusyID(id); setError('')
    try {
      const updated = await api<Product>(`/produk/${id}/favorit`, 'PUT', { is_favorit: !product.is_favorit })
      onProductUpdated(updated)
      focusSearch()
    } catch (err) { setError(`Gagal menyimpan favorit: ${message(err)}`) }
    finally { favoriteLock.current = false; setFavoriteBusyID(null) }
  }
  const [selectedCart, setSelectedCart] = useState<number | null>(null)
  const discount = '0'
  const [modal, setModal] = useState(false)
  const [completed, setCompleted] = useState<Transaction | null>(null)
  const [paymentStage, setPaymentStage] = useState<'confirm' | 'saving' | 'failed'>('confirm')
  const [paymentError, setPaymentError] = useState('')
  const [changePreview, setChangePreview] = useState<{ total: string; received: string; change: string } | null>(null)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const cartBodyRef = useRef<HTMLDivElement>(null)
  const [addition, setAddition] = useState(0)
  const draftTabsRef = useRef<HTMLDivElement>(null)
  const quantityRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const checkout = useCheckout(user.id, 'penjualan', drafts.draft.id)
  const { submit, pending } = checkout
  const busy = checkout.anyBusy
  const locked = !drafts.ready || !checkout.ready || busy || Boolean(pending)
  const switchingLocked = locked || modal
  const methods = data.payments.filter(method => method.aktif && method.untuk_penjualan)
  const method = methods.find(method => method.id === methodID) ?? methods.find(method => method.jenis === 'CASH') ?? methods[0]
  const valid = validLines(cart, discount)
  const preview = valid ? totals(cart, discount, method) : totals([], '0')
  const amountPaid = method?.jenis === 'CASH' ? paid || '0' : preview.total.toFixed(2)
  const sufficient = validNumber(amountPaid, 2, true) && new Decimal(amountPaid).gte(preview.total)
  const categories = useMemo(() => new Map(data.categories.map(row => [row.id, row.nama])), [data.categories])
  const sortedProducts = useMemo(() => sortProducts(data.products.filter(product => product.aktif), order.sort, frequency, order.favoritesFirst), [data.products, order.sort, order.favoritesFirst, frequency])
  const searchIndex = useMemo(() => sortedProducts.map(product => ({ product, text: `${product.nama} ${product.sku} ${product.barcode ?? ''} ${categories.get(product.kategori_id) ?? ''}`.toLowerCase() })), [sortedProducts, categories])
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/)
    return searchIndex.filter(row => words.every(word => row.text.includes(word))).map(row => row.product)
  }, [searchIndex, query])
  useLayoutEffect(() => {
    if (addition && cartBodyRef.current) cartBodyRef.current.scrollTop = cartBodyRef.current.scrollHeight
  }, [addition])

  useLayoutEffect(() => { cartRef.current = cart }, [cart])
  function switchDraft(slot: SaleSlot, focusInput = true) {
    if (savingRef.current || switchingLocked || drafts.active === slot || !drafts.drafts[slot]) return
    cartRef.current = drafts.drafts[slot].cart
    drafts.select(slot)
    setQuery(''); setHighlight(0); setSelectedCart(null); setError('')
    setPaymentStage('confirm'); setPaymentError(''); setChangePreview(null); setCompleted(null)
    setAddition(value => value + 1)
    if (focusInput) focusSearch()
  }
  function addDraft() {
    if (savingRef.current || switchingLocked) return
    drafts.add(); cartRef.current = []
    setQuery(''); setHighlight(0); setSelectedCart(null); setError('')
    setPaymentStage('confirm'); setPaymentError(''); setChangePreview(null); setCompleted(null)
    focusSearch()
  }
  function closeDraft(slot: SaleSlot) {
    if (slot === 0 || savingRef.current || switchingLocked) return
    const target = drafts.drafts[slot]
    if (!target) return
    if (!checkout.canDiscard(target.id)) { setError('Pembayaran transaksi ini belum terkonfirmasi. Periksa hasilnya sebelum menutup tab.'); return }
    if (target.cart.length && !window.confirm(`Tutup Transaksi ${slot + 1}? Daftar belanjanya akan dihapus.`)) return
    if (!checkout.discard(target.id)) return
    const next = drafts.close(slot)
    cartRef.current = next.drafts[next.active].cart
    if (drafts.active === slot) {
      setQuery(''); setHighlight(0); setSelectedCart(null); setError('')
      setPaymentStage('confirm'); setPaymentError(''); setChangePreview(null); setCompleted(null)
      setAddition(value => value + 1)
    }
    focusSearch()
  }
  useLayoutEffect(() => {
    if (!active) return
    const list = draftTabsRef.current
    const tab = document.getElementById(`sale-draft-tab-${drafts.active}`)?.closest<HTMLElement>('.sale-draft-tab')
    if (!list || !tab) return
    if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft
    else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth
  }, [active, drafts.active, drafts.drafts.length])
  useEffect(() => {
    if (!active) return
    function shortcuts(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const digit = event.code.match(/^(?:Digit|Numpad)([1-9])$/)?.[1] ?? event.key
      if (!/^[1-9]$/.test(digit)) return
      event.preventDefault()
      if (!event.repeat) switchDraft(Number(digit) - 1)
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  function focusSearch() { requestAnimationFrame(() => { if (!dialogRef.current) searchRef.current?.focus({ preventScroll: true }) }) }
  function commitCart(next: CartLine[]) { cartRef.current = next; setCart(next) }
  function add(product: Product) {
    if (locked) return
    const current = cartRef.current
    const old = current.find(line => line.product.id === product.id)
    const quantity = new Decimal(old?.quantity || 0).plus(1)
    if (!old && current.length >= 200) { setError('Maksimal 200 produk per transaksi.'); return }
    commitCart([...current.filter(line => line.product.id !== product.id), old ? { ...old, quantity: quantity.toString() } : { product, quantity: '1', price: product.harga_jual, discount: '0' }])
    setAddition(value => value + 1)
    setSelectedCart(product.id); setQuery(''); setHighlight(0); setError(''); focusSearch()
  }
  function update(id: number, patch: Partial<CartLine>) {
    if (locked) return
    commitCart(cartRef.current.map(line => line.product.id === id ? { ...line, ...patch } : line))
    setSelectedCart(id); setError('')
  }
  function remove(id: number) { if (locked) return; commitCart(cartRef.current.filter(line => line.product.id !== id)); focusSearch() }
  function changeQuantity(id: number, amount: number) {
    const line = cartRef.current.find(line => line.product.id === id)
    if (!line) return
    const quantity = new Decimal(line.quantity || 0).plus(amount)
    if (quantity.lte(0)) remove(id)
    else update(id, { quantity: quantity.toString() })
  }
  function clearCart() {
    if (locked || modal) return
    if (cartRef.current.length && !window.confirm(`Kosongkan daftar belanja Transaksi ${drafts.active + 1}?`)) return
    commitCart([]); setPaid(''); setReference(''); setQuery(''); setHighlight(0); setSelectedCart(null); setMethodID(null); setError(''); focusSearch()
  }
  function openPayment() {
    if (!valid || !method || locked) return
    setError(''); setPaymentError(''); setChangePreview(null); setPaymentStage('confirm'); setCompleted(null); setModal(true)
  }
  function finish() { if (savingRef.current || busy || paymentStage === 'saving' || (pending && !completed)) return; setPaymentStage('confirm'); setPaymentError(''); setChangePreview(null); setModal(false); setCompleted(null); setError(''); focusSearch() }

  async function chooseSearchResult() {
    if (locked) return
    const exact = exactProduct(data.products, query)
    if (exact) { add(exact); return }
    // Barcode yang tidak cocok tidak pernah memilih barang lain secara fuzzy.
    if (query.trim() && isBarcodeQuery(query)) {
      setError(`Barcode ${query.trim()} tidak ditemukan.`)
      return
    }
    const candidate = filtered[highlight]
    if (candidate) add(candidate)
    else setError('Produk tidak ditemukan. Periksa nama, SKU, atau barcode.')
  }

  useEffect(() => { setHighlight(0) }, [query, order.sort, order.favoritesFirst, favorites, frequency])
  useEffect(() => { if (active && !modal && !pending && drafts.ready) focusSearch() }, [active, drafts.ready])
  useEffect(() => {
    if (!active || !drafts.ready || !pending || busy || completed || paymentStage !== 'confirm') return
    setPaymentStage('failed'); setPaymentError('Transaksi sebelumnya belum terkonfirmasi. Coba lagi untuk memeriksa hasil penyimpanannya.'); setModal(true)
  }, [active, drafts.ready, pending, busy, completed, paymentStage])
  useEffect(() => {
    if (!active || !modal || paymentStage !== 'saving') return
    function blockDuringSave(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault(); event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', blockDuringSave, true)
    return () => window.removeEventListener('keydown', blockDuringSave, true)
  }, [active, modal, paymentStage])
  useEffect(() => {
    if (!active || !modal || !completed) return
    function completeWithEnter(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) finish()
    }
    window.addEventListener('keydown', completeWithEnter, true)
    return () => window.removeEventListener('keydown', completeWithEnter, true)
  }, [active, modal, completed])
  useEffect(() => {
    if (!active) return
    function keyboard(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'Enter' && event.repeat) { event.preventDefault(); return }
      if (event.repeat && ['F2', 'F3', 'F4', 'F5', 'F6', 'F8', 'F9'].includes(event.key)) { event.preventDefault(); return }
      if (event.key === 'F8') {
        event.preventDefault()
        if (modal && !completed && !busy && (pending || sufficient)) void save(Boolean(pending))
        else if (!modal) openPayment()
        return
      }
      if (['F4', 'F5', 'F6'].includes(event.key) && !busy && !pending && !completed && paymentStage === 'confirm') {
        event.preventDefault()
        const kind = { F4: 'CASH', F5: 'QRIS', F6: 'DEBIT' }[event.key as 'F4' | 'F5' | 'F6']
        const chosen = methods.find(method => method.jenis === kind)
        if (!chosen) { setError(`Metode ${kind} belum tersedia.`); return }
        setMethodID(chosen.id)
        if (valid && paymentStage === 'confirm') { setCompleted(null); setModal(true) }
        return
      }
      if (modal || locked) return
      if (event.key === 'F9') { event.preventDefault(); clearCart(); return }
      if (event.key === 'F2') { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return }
      if (event.key === 'F3') {
        event.preventDefault()
        const id = selectedCart ?? cartRef.current.at(-1)?.product.id
        const input = id ? quantityRefs.current.get(id) : undefined
        input?.focus(); input?.select(); return
      }
      const target = event.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return
      if (target.closest('.pos-more')) return
      if (isSearchCharacter(event)) {
        event.preventDefault()
        setQuery(current => current + event.key)
        searchRef.current?.focus()
        requestAnimationFrame(() => { const input = searchRef.current; if (input) input.setSelectionRange(input.value.length, input.value.length) })
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })

  useEffect(() => {
    if (!modal || !active || !dialogRef.current) return
    const dialog = dialogRef.current
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled]),summary,[tabindex="0"]')).filter(node => node.getClientRects().length > 0)
    const autofocus = dialog.querySelector<HTMLElement>('[data-autofocus]:not([disabled])')
    ;(autofocus ?? focusable()[0] ?? dialog).focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && paymentStage === 'failed' && (event.target === dialog || (event.target as HTMLElement).closest('[data-payment-retry]')) && !event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); void save(Boolean(pending)); return }
      if (event.key === 'Enter' && event.repeat) { event.preventDefault(); return }
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) finish(); return }
      if (event.key !== 'Tab') return
      const nodes = focusable(); const first = nodes[0]; const last = nodes[nodes.length - 1]
      if (!nodes.length) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    dialog.addEventListener('keydown', keydown)
    return () => dialog.removeEventListener('keydown', keydown)
  }, [modal, active, completed, busy, method?.jenis, paymentStage])

  async function save(retry = false) {
    if (busy || savingRef.current) return
    setError('')
    if (!retry && (!valid || !method || !sufficient)) { setError('Periksa jumlah barang dan uang yang diterima.'); return }
    const body: TransactionInput = {
      metode_pembayaran_id: method?.id ?? 0, diskon_transaksi: discount,
      jumlah_dibayar: amountPaid, nomor_referensi: reference || null,
      items: cartRef.current.map(line => ({ produk_id: line.product.id, jumlah: line.quantity, diskon: line.discount })),
    }
    if (!retry) setChangePreview({ total: preview.total.toFixed(2), received: new Decimal(amountPaid).toFixed(2), change: new Decimal(amountPaid).minus(preview.total).toFixed(2) })
    savingRef.current = true
    setModal(true); setPaymentStage('saving'); setPaymentError('')
    let result: Transaction | undefined
    try {
      result = await submit(retry ? undefined : body)
      if (!result) { setPaymentStage('confirm'); return }
      if (result.status === 'SELESAI') {
        const next = drafts.complete(drafts.draft.id)
        cartRef.current = next.drafts[next.active].cart
        setQuery(''); setSelectedCart(null); setHighlight(0)
        setAddition(value => value + 1)
        setPopularityRevision(value => value + 1)
      }
      setCompleted(result); setPaymentStage('confirm')
    } catch (err) {
      setPaymentError(message(err)); setPaymentStage('failed')
    } finally { savingRef.current = false }
    // Receipt/drawer failures must never turn a saved payment into a retry.
    if (result) {
      try { await onSaved(result, false, print) }
      catch (err) { setError(`Transaksi tersimpan. ${message(err)}`) }
    }
  }

  const itemCount = cart.reduce((sum, line) => sum.plus(line.quantity || 0), new Decimal(0)).toString()
  return <div hidden={!active}>
    <SaleLayout>
      <section className="sale-panel sale-cart" aria-labelledby="cart-heading">
        <div className="sale-draft-strip"><div ref={draftTabsRef} className="sale-draft-tabs" role="tablist" aria-label="Transaksi berjalan">
          {drafts.drafts.map((draft, slot) => <div className="sale-draft-tab" data-selected={drafts.active === slot} role="presentation" key={draft.id}><button type="button" id={`sale-draft-tab-${slot}`} role="tab" aria-selected={drafts.active === slot} aria-controls="sale-active-cart" aria-keyshortcuts={slot < 9 ? `Alt+${slot + 1}` : undefined} tabIndex={drafts.active === slot ? 0 : -1} disabled={switchingLocked} title={`Transaksi ${slot + 1}${slot < 9 ? ` · Alt + ${slot + 1}` : ''}`} onClick={() => switchDraft(slot)} onKeyDown={event => {
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? drafts.drafts.length - 1 : event.key === 'ArrowLeft' ? (slot + drafts.drafts.length - 1) % drafts.drafts.length : event.key === 'ArrowRight' ? (slot + 1) % drafts.drafts.length : null
            if (next === null) return
            event.preventDefault(); switchDraft(next, false)
            document.getElementById(`sale-draft-tab-${next}`)?.focus()
          }}><span>Transaksi {slot + 1}</span>{slot === 0 && <span className="sale-draft-main">Utama</span>}{(checkout.pendingAt(draft.id) || draft.cart.length > 0) && <span className="sale-draft-count">{checkout.pendingAt(draft.id) ? 'Periksa' : draft.cart.length}</span>}</button>{slot > 0 && <button type="button" className="sale-draft-close" aria-label={`Tutup Transaksi ${slot + 1}`} title={checkout.pendingAt(draft.id) ? 'Periksa pembayaran sebelum menutup transaksi' : 'Tutup transaksi'} disabled={switchingLocked || Boolean(checkout.pendingAt(draft.id))} onClick={() => closeDraft(slot)}><X /></button>}{slot === drafts.drafts.length - 1 && <button type="button" className="sale-draft-add" aria-label="Tambah transaksi" title="Tambah transaksi" disabled={switchingLocked} onClick={addDraft}><Plus /></button>}</div>)}
        </div></div>
        <div className="sale-panel-heading"><div><h1 id="cart-heading">Daftar Belanja</h1><p>{itemCount} barang dipilih</p></div><Button className="sale-clear" variant="ghost" disabled={locked || !cart.length} onClick={clearCart}><Trash2 />Kosongkan <kbd>F9</kbd></Button></div>
        <div className="sale-cart-body" ref={cartBodyRef} id="sale-active-cart" role="tabpanel" aria-labelledby={`sale-draft-tab-${drafts.active}`}>
          <ErrorBox>{!modal && (error || drafts.storageError)}</ErrorBox>
          {pending && !modal && <div className="sale-pending" role="status"><p>Hasil transaksi sebelumnya belum terkonfirmasi.</p><Button disabled={busy} onClick={() => void save(true)}>Periksa / lanjutkan transaksi</Button></div>}
          {!cart.length ? <div className="sale-empty"><ShoppingBasket /><strong>Belum ada barang</strong><p>Cari atau scan produk untuk mulai berjualan.</p></div> : cart.map(line => <article className="sale-cart-line" key={line.product.id} data-active={selectedCart === line.product.id}>
            <div className="sale-line-name"><h2 title={line.product.nama}>{line.product.nama}</h2><p>{money(line.price)}</p></div>
            <div className="sale-quantity"><Button variant="outline" className="quantity-minus" disabled={locked} aria-label={`Kurangi ${line.product.nama}`} onClick={() => changeQuantity(line.product.id, -1)}><Minus /></Button>
              <input ref={node => { if (node) quantityRefs.current.set(line.product.id, node); else quantityRefs.current.delete(line.product.id) }} aria-label={`Jumlah ${line.product.nama}`} inputMode="decimal" disabled={locked} value={line.quantity} onFocus={event => { setSelectedCart(line.product.id); event.target.select() }} onChange={event => { if (/^(\d+(?:\.\d*)?)?$/.test(event.target.value)) update(line.product.id, { quantity: event.target.value }) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); focusSearch() } if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); changeQuantity(line.product.id, event.key === 'ArrowUp' ? 1 : -1) } }} />
              <Button variant="outline" className="quantity-plus" disabled={locked} aria-label={`Tambah ${line.product.nama}`} onClick={() => changeQuantity(line.product.id, 1)}><Plus /></Button></div>
            <strong className="sale-line-total">{money(new Decimal(line.quantity || 0).mul(line.price).minus(line.discount || 0).toDecimalPlaces(2))}</strong>
            <Button variant="outline" className="sale-remove" disabled={locked} aria-label={`Hapus ${line.product.nama}`} onClick={() => remove(line.product.id)}><Trash2 /></Button>
          </article>)}
        </div>
        <div className="sale-summary">
          <div className="sale-total"><span>Total Belanja</span><strong>{money(preview.total)}</strong></div>
          <fieldset className="sale-methods" disabled={locked}><legend>Metode pembayaran</legend><div>{methods.map(payment => {
            const Icon = payment.jenis === 'CASH' ? Banknote : payment.jenis === 'QRIS' ? QrCode : CreditCard
            const name = payment.jenis === 'CASH' && /^(cash|tunai)$/i.test(payment.nama) ? 'Tunai' : payment.nama
            return <Button type="button" key={payment.id} aria-pressed={method?.id === payment.id} className="sale-method" variant={method?.id === payment.id ? 'default' : 'outline'} onClick={() => setMethodID(payment.id)}><Icon />{name}</Button>
          })}</div>{!methods.length && <p className="text-sm text-destructive">Belum ada metode pembayaran aktif.</p>}</fieldset>
          <Button className="sale-pay" disabled={!valid || !method || locked} onClick={openPayment}><WalletCards />Bayar<kbd>F8</kbd></Button>
        </div>
      </section>

      <section className="sale-panel sale-catalog" aria-label="Daftar produk"><div className="sale-search-area">
        <form className="sale-search" onSubmit={event => { event.preventDefault(); void chooseSearchResult() }}><Search /><input ref={searchRef} type="search" autoComplete="off" aria-label="Cari atau scan produk penjualan" aria-controls="sale-products" placeholder="Cari nama produk atau scan barcode..." disabled={locked} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const next = Math.max(0, Math.min(filtered.length - 1, highlight + (event.key === 'ArrowDown' ? 1 : -1)))
            setHighlight(next)
          }
          if (event.key === 'Escape') { event.preventDefault(); setQuery(''); setError('') }
        }} /><Barcode /></form>
        <div className="sale-sort-toolbar"><span>Urutkan produk</span><SearchSelect aria-label="Urutan produk penjualan" value={order.sort} disabled={locked} className="sale-sort-trigger" onValueChange={value => setOrder(previous => ({ ...previous, sort: value as ProductSort }))}>{productSortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</SearchSelect><label className="sale-favorites-filter"><input type="checkbox" checked={order.favoritesFirst} disabled={locked} onChange={event => setOrder(previous => ({ ...previous, favoritesFirst: event.target.checked }))} />Utamakan favorit</label><button type="button" className="sale-sort-refresh" disabled={popularityLoading || locked} onClick={() => setPopularityRevision(value => value + 1)}>{popularityLoading ? 'Memuat…' : 'Perbarui terlaris'}</button></div>
        {favoriteBusyID !== null && <span role="status" className="sr-only">Menyimpan favorit produk…</span>}
        {popularityError && <p className="sale-sort-note" role="status">Data terlaris belum berhasil dimuat. Favorit tetap bisa diatur. Klik Perbarui terlaris untuk mencoba lagi.</p>}
        <div className="sale-catalog-tools"><details className="sale-shortcuts"><summary>Shortcut keyboard</summary><p className="sale-key-hint"><kbd>↑</kbd><kbd>↓</kbd> pilih · <kbd>Enter</kbd> tambah · <kbd>F3</kbd> jumlah · <kbd>F4</kbd> tunai · <kbd>F5</kbd> QRIS · <kbd>F6</kbd> debit · <kbd>F9</kbd> kosongkan · <kbd>F10</kbd> buka laci · <kbd>Alt 1–9</kbd> pindah transaksi</p></details><span className="sale-result-count">{filtered.length.toLocaleString('id-ID')} produk</span></div>
      </div><SaleCatalog products={filtered} categories={categories} highlight={highlight} locked={locked} active={active} onHighlight={setHighlight} onAdd={add} favorites={favorites} onToggleFavorite={toggleFavorite} favoriteEditable={user.peran === 'PEMILIK'} favoriteBusyID={favoriteBusyID} /></section>
    </SaleLayout>

    {modal && active && <div className="sale-modal-backdrop"><section ref={dialogRef} className="sale-payment-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-busy={paymentStage === 'saving'} aria-labelledby="sale-payment-title">
      {completed || (changePreview && paymentStage !== 'confirm') ? <div className="sale-success">
        <p className="sale-eyebrow">{completed ? `PEMBAYARAN ${completed.status === 'SELESAI' ? 'BERHASIL' : completed.status}` : paymentStage === 'failed' ? 'PEMBAYARAN BELUM TERKONFIRMASI' : 'PEMBAYARAN SEDANG DISIMPAN'}</p>
        <h2 id="sale-payment-title">Kembalian</h2>
        <strong className="sale-change">{money(completed?.kembalian ?? changePreview?.change ?? '0')}</strong>
        <div className="sale-success-values"><div><p>Total</p><strong>{money(completed?.total_tagihan ?? changePreview?.total ?? '0')}</strong></div><div><p>Uang diterima</p><strong>{money(completed?.jumlah_dibayar ?? changePreview?.received ?? '0')}</strong></div></div>
        {completed ? <><p className="sale-receipt-number">{completed.nomor}</p><Button data-autofocus className="sale-complete" onClick={finish}><Check />Selesai<kbd className="sale-finish-key">Enter</kbd><span className="sr-only"> untuk transaksi berikutnya</span></Button><Button variant="ghost" className="sale-reprint" onClick={() => void onReprint(completed)}><Printer />Cetak ulang struk</Button></> : paymentStage === 'failed' ? <>
          <p className="sale-change-status" role="alert">{paymentError || 'Pembayaran belum berhasil disimpan.'}</p>
          <p className="sale-change-status">{pending ? 'Coba lagi untuk memeriksa atau melanjutkan transaksi yang sama.' : 'Daftar belanja tetap tersimpan.'}</p>
          <Button data-autofocus data-payment-retry className="sale-complete" onClick={() => void save(Boolean(pending))}><RotateCcw />Coba lagi<kbd className="sale-finish-key">Enter</kbd></Button>
          {!pending && <Button variant="ghost" onClick={() => { setPaymentStage('confirm'); setPaymentError('') }}>Kembali ke pembayaran</Button>}
        </> : <><p className="sale-change-status" role="status">Sedang menyimpan pembayaran…</p><Button disabled className="sale-complete"><LoaderCircle className="sale-change-spinner" aria-hidden="true" />Menyimpan pembayaran…</Button></>}
      </div> : paymentStage === 'saving' ? <div className="sale-payment-progress" role="status"><LoaderCircle className="sale-payment-spinner" aria-hidden="true" /><h2 id="sale-payment-title">Memeriksa pembayaran…</h2><p>Mohon tunggu, hasil transaksi sebelumnya sedang diperiksa.</p></div> : paymentStage === 'failed' ? <div className="sale-payment-progress"><CircleAlert className="sale-payment-failed-icon" aria-hidden="true" /><h2 id="sale-payment-title">Pembayaran belum terkonfirmasi</h2><p role="alert">{paymentError}</p><Button data-autofocus data-payment-retry className="sale-complete" onClick={() => void save(Boolean(pending))}><RotateCcw />Coba lagi<kbd className="sale-finish-key">Enter</kbd></Button>{!pending && <Button variant="ghost" onClick={() => setPaymentStage('confirm')}>Kembali ke pembayaran</Button>}</div> : <form onSubmit={event => { event.preventDefault(); if (!busy) void save(Boolean(pending)) }}>
        <div className="sale-payment-heading"><div><p className="sale-eyebrow">PEMBAYARAN</p><h2 id="sale-payment-title">Konfirmasi Pembayaran</h2></div><Button variant="outline" className="sale-modal-close" disabled={busy} aria-label="Tutup pembayaran" onClick={finish}><X /></Button></div>
        <ErrorBox>{error}</ErrorBox>
        <div className="sale-payment-total"><p>Total Belanja</p><strong>{money(preview.total)}</strong></div>
        {pending ? <p className="sale-pending">Hasil penyimpanan belum terkonfirmasi. Tekan tombol di bawah untuk memeriksa request yang sama.</p> : method?.jenis === 'CASH' ? <label className="sale-cash-label" htmlFor="sale-cash">Uang diterima<div className="sale-cash-input"><span>Rp</span><input data-autofocus id="sale-cash" inputMode="numeric" autoComplete="off" disabled={busy} placeholder="0" value={groupedCash(paid)} onChange={event => setPaid(event.target.value.replace(/\D/g, '').slice(0, 16))} /></div></label> : <div className="sale-noncash"><p>Metode: <strong>{method?.nama}</strong></p><p>Pastikan pembayaran {money(preview.total)} sudah berhasil pada QRIS/terminal.</p></div>}
        {method?.jenis !== 'CASH' && !pending && <div className="sale-reference"><Field label="Referensi pembayaran (opsional)" value={reference} onChange={setReference} disabled={busy} /></div>}
        <label className="sale-print"><input type="checkbox" checked={print} disabled={busy} onChange={event => setPrint(event.target.checked)} /><Printer />Print struk setelah pembayaran</label>
        <Button type="submit" data-autofocus={method?.jenis !== 'CASH' || Boolean(pending) ? true : undefined} className="sale-complete" disabled={busy || (!pending && (!valid || !sufficient))}><WalletCards />{busy ? 'Menyimpan…' : pending ? 'Periksa / lanjutkan transaksi' : 'Selesaikan Pembayaran'}</Button>
        <p className="sale-dialog-hint"><kbd>Enter</kbd> konfirmasi · <kbd>Esc</kbd> kembali</p>
      </form>}
    </section></div>}
  </div>
}
