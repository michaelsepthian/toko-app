'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, Banknote, CalendarDays, History as HistoryIcon, LogOut, Moon, Menu, RefreshCw, Settings, ShoppingBasket, Store, Sun, Truck, WalletCards, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, masterData, message, logout } from '@/lib/api'
import type { Data, Stock, Transaction, User } from '@/lib/types'
import { defaultDevices, openDrawer, printReceipt, readDevices, type DeviceSettings } from '@/lib/hardware'
import { AuthGate } from './pos/auth-gate'
import { Checkout } from './pos/checkout'
import { SaleCheckout } from './pos/sale-checkout'
import { Products, Masters, Inventory } from './pos/masters'
import { History } from './pos/history'
import { Devices } from './pos/devices'
import { ErrorBox } from './pos/common'
import { ShoppingPlan } from './pos/shopping-plan'
import { clearActionHash, useContentMotion, useDismissInteractions } from '@/lib/ui-interactions'
import { useNotice } from '@/lib/use-notice'
import { invalidateProducts } from '@/lib/product-cache'

const initialData: Data = { categories: [], units: [], payments: [], sources: [], stocks: [] }
type View = 'cashier' | 'purchases' | 'products' | 'history' | 'masters' | 'devices' | 'shopping'
export function PosApp() { return <AuthGate>{user => <Workspace key={user.id} user={user} />}</AuthGate> }

function Workspace({ user }: { user: User }) {
  const owner = user.peran === 'PEMILIK'
  const [view, setView] = useState<View>('cashier'); const [data, setData] = useState<Data>(initialData)
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useNotice()
  const [dark, setDark] = useState(false); const [devices, setDevices] = useState<DeviceSettings>(defaultDevices)
  const [lastSale, setLastSale] = useState<Transaction | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const drawerBusy = useRef(false)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const masterVersion = useRef<string | null>(null)
  const masterChangePending = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  useContentMotion(contentRef, view)
  useDismissInteractions()
  useEffect(() => { clearActionHash() }, [])
  const [operationalDateHost, setOperationalDateHost] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setDevices(readDevices())
    const value = localStorage.getItem('toko:theme') !== 'light'
    setDark(value); document.documentElement.classList.toggle('dark',value)
  }, [])
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const measure = () => document.documentElement.style.setProperty('--pos-header-height',`${header.getBoundingClientRect().height}px`)
    const observer = new ResizeObserver(measure); observer.observe(header); measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    function outside(event: PointerEvent) {
      const menu = moreRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false
    }
    function escape(event: KeyboardEvent) {
      const menu = moreRef.current
      if (event.key === 'Escape' && menu?.open) {
        event.preventDefault(); event.stopPropagation(); menu.open = false
        menu.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [])
  function navigate(next: View) {
    document.querySelectorAll<HTMLDetailsElement>('.pos-more[open], .shopping-item-menu[open], .sale-shortcuts[open], .sale-product-options[open]').forEach(menu => { menu.open = false })
    window.dispatchEvent(new Event('toko-close-popovers'))
    clearActionHash(); setView(next)
  }
  function toggleTheme() { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark',next); localStorage.setItem('toko:theme',next ? 'dark' : 'light') }

  const refresh = useCallback(async (checkVersion = false, force = false) => {
    if (!checkVersion) { setLoading(true); setError('') }
    try {
      const masters = await masterData(checkVersion, force)
      const catalogChanged = force || masterChangePending.current || (masterVersion.current !== null && masterVersion.current !== masters.version)
      // Concurrent local refresh/version checks share this acknowledgement, so
      // only the first completion invalidates the product pages.
      masterChangePending.current = false
      masterVersion.current = masters.version
      if (catalogChanged) invalidateProducts()
      setData(previous => previous.categories === masters.categories && previous.units === masters.units && previous.payments === masters.payments && previous.sources === masters.sources ? previous : { ...previous, ...masters })
    } catch (err) {
      // A successful mutation must refresh products even if the small master
      // snapshot is temporarily unavailable.
      if (masterChangePending.current) { masterChangePending.current = false; invalidateProducts() }
      setError(`Gagal memuat data: ${message(err)}`)
    } finally { setLoading(false) }
  }, [])
  const refreshStocks = useCallback(async () => {
    if (!owner) return
    try { const stocks = await api<Stock[]>('/stok/ringkasan'); setData(previous => ({ ...previous, stocks })) }
    catch (err) { setError(`Gagal memuat stok: ${message(err)}`) }
  }, [owner])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (view === 'purchases') void refreshStocks() }, [view, refreshStocks])
  useEffect(() => {
    const update = () => { masterChangePending.current = true; void refresh() }
    const check = () => { if (document.visibilityState === 'visible') void refresh(true) }
    const storage = (event: StorageEvent) => { if (event.key === 'toko:master-updated') check() }
    // Hanya memeriksa nomor versi; master tidak diunduh lagi jika tidak berubah.
    const interval = window.setInterval(check, 30000)
    window.addEventListener('focus', check)
    window.addEventListener('storage', storage)
    window.addEventListener('toko-master-updated', update)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', check); window.removeEventListener('storage', storage); window.removeEventListener('toko-master-updated', update) }
  }, [refresh])
  async function drawer() {
    if (drawerBusy.current) return
    drawerBusy.current = true; setError('')
    try { setNotice(await openDrawer(devices)) } catch (err) { setNotice(`Buka laci belum berhasil: ${message(err)}`) }
    finally { drawerBusy.current = false }
  }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key !== 'F10') return
      event.preventDefault()
      if (!event.repeat) void drawer()
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })
  async function print(sale: Transaction) { try { setNotice(await printReceipt(sale, data.payments, devices)) } catch (err) { setError(`Transaksi tersimpan; cetak belum berhasil: ${message(err)}`) } }
  async function saved(record: Transaction, purchase: boolean, shouldPrint: boolean) {
    setNotice(purchase ? `${record.nomor} tersimpan.` : ''); setError('')
    if (!purchase) setLastSale(record)
    if (purchase) await refreshStocks()
    if (!purchase && shouldPrint) await print(record)
    const method = data.payments.find(p => p.id === record.metode_pembayaran_id)
    if (!purchase && record.status === 'SELESAI' && devices.autoDrawer && method?.jenis === 'CASH') {
      try { setNotice(await openDrawer(devices)) } catch (err) { setError(`Transaksi tersimpan; perintah laci gagal: ${message(err)}`) }
    }
  }
  const primary: { view: View; title: string; icon: typeof Store }[] = [
    { view:'cashier',title:'Penjualan',icon:ShoppingBasket },
    { view:'products',title:'Produk',icon:Archive },
    { view:'history',title:'Riwayat',icon:HistoryIcon },
    { view:'shopping',title:'Rencana Belanja',icon:CalendarDays },
  ]
  return <main className="pos-app min-h-screen bg-background text-foreground">
    <div ref={headerRef}>
      <header className="pos-topbar"><div className="pos-topbar-inner">
        <div className="pos-brand"><div className="pos-brand-icon">{loading ? <RefreshCw className="animate-spin" aria-label="Memuat data" /> : <Store />}</div><div><h1>{devices.storeName}</h1><p>{devices.address}</p><StoreClock /></div></div>
        <nav className="pos-header-actions" aria-label="Menu utama">
          <div className="pos-operating-session">
            <div ref={setOperationalDateHost} />
            <div className="pos-quick-actions"><Button variant="outline" aria-label="Buka Laci" title="Buka Laci (F10)" onClick={() => void drawer()}><Banknote /><span className="pos-drawer-label">Buka Laci</span><kbd>F10</kbd></Button>
              <details className="pos-more" ref={moreRef}><summary aria-label="Menu lainnya"><Menu /><span className="sr-only">Menu lainnya</span></summary><div className="pos-more-menu">
                <p className="pos-user-label">{user.username ?? user.nama} · {owner ? 'Pemilik' : 'Kasir'}</p>
                <Button variant="ghost" className="pos-theme-toggle" role="switch" aria-checked={dark} aria-label="Tema gelap" onClick={toggleTheme}>{dark ? <Moon /> : <Sun />}<span>Tema {dark ? 'gelap' : 'terang'}</span><span className="pos-theme-switch" aria-hidden="true"><span /></span></Button>
                {owner && <><Button variant={view === 'purchases' ? 'default' : 'ghost'} onClick={() => navigate('purchases')}><Truck />Pembelian</Button><Button variant={view === 'masters' ? 'default' : 'ghost'} onClick={() => navigate('masters')}><WalletCards />Data Master</Button><Button variant={view === 'devices' ? 'default' : 'ghost'} onClick={() => navigate('devices')}><Settings />Perangkat</Button></>}
                <Button variant="ghost" disabled={loading} onClick={() => { if (moreRef.current) moreRef.current.open=false; void refresh(false, true); if (view === 'purchases') void refreshStocks() }}><RefreshCw />Muat ulang data</Button>
                {lastSale && <Button variant="ghost" onClick={() => { if (moreRef.current) moreRef.current.open=false; void print(lastSale) }}>Cetak struk terakhir</Button>}
                <Button variant="ghost" onClick={async () => { try { await logout() } catch (err) { setError(message(err)) } }}><LogOut />Keluar</Button>
              </div></details>
            </div>
          </div>
          <div className="pos-primary-nav">{primary.map(tab => <Button key={tab.view} variant={view === tab.view ? 'default' : 'ghost'} aria-label={tab.title} aria-current={view === tab.view ? 'page' : undefined} onClick={() => navigate(tab.view)}><tab.icon />{tab.view === 'shopping' ? <span><span className="shopping-nav-prefix">Rencana </span>Belanja</span> : tab.title}</Button>)}</div>
        </nav>
      </div></header>
      {error && <div className="pos-error-banner flex items-center gap-2"><div className="flex-1"><ErrorBox>{error}</ErrorBox></div><Button variant="ghost" aria-label="Tutup pesan kesalahan" onClick={() => setError('')}><X /></Button></div>}
    </div>
    {notice && <div role="status" className="pos-toast"><span>{notice}</span><button aria-label="Tutup pemberitahuan" onClick={() => setNotice('')}><X className="size-4" /></button></div>}
    <div ref={contentRef} className="pos-view-content">
    <SaleCheckout loading={loading} user={user} data={data} active={view === 'cashier'} operationalDateHost={operationalDateHost} onSaved={saved} onReprint={print} />
    {owner && <Checkout loading={loading} user={user} data={data} purchase active={view === 'purchases'} onSaved={saved} />}
    {view === 'purchases' && owner && <Inventory data={data} refresh={refreshStocks} />}
    {view === 'products' && <Products loading={loading} data={data} refresh={refresh} owner={owner} />}
    <ShoppingPlan active={view === 'shopping'} owner={owner} data={data} masterLoading={loading} />
    {view === 'history' && <History data={data} owner={owner} refresh={refresh} print={print} storeName={devices.storeName} userID={user.id} />}
    {view === 'masters' && owner && <Masters data={data} refresh={refresh} />}
    {view === 'devices' && owner && <Devices settings={devices} onChange={setDevices} />}
    </div>
  </main>
}

const storeDate = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
const storeTime = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' })
function StoreClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  return <time>{now ? `${storeDate.format(now)} · ${storeTime.format(now)}` : 'Memuat tanggal…'}</time>
}
