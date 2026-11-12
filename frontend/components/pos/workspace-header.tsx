'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  Banknote,
  CalendarDays,
  History as HistoryIcon,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  ShoppingBasket,
  Store,
  Sun,
  Truck,
  WalletCards,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DeviceSettings } from '@/lib/hardware'
import type { User } from '@/lib/types'

export type View =
  | 'cashier'
  | 'purchases'
  | 'products'
  | 'history'
  | 'masters'
  | 'devices'
  | 'shopping'

type Props = {
  user: User
  view: View
  devices: DeviceSettings
  loading: boolean
  canPrintLastSale: boolean
  operationalDateRef: (element: HTMLDivElement | null) => void
  onNavigate: (view: View) => void
  onDrawer: () => void
  onRefresh: () => void
  onPrintLastSale: () => void
  onLogout: () => Promise<void>
}

const primary: { view: View; title: string; icon: typeof Store }[] = [
  { view: 'cashier', title: 'Penjualan', icon: ShoppingBasket },
  { view: 'products', title: 'Produk', icon: Archive },
  { view: 'history', title: 'Riwayat', icon: HistoryIcon },
  { view: 'shopping', title: 'Rencana Belanja', icon: CalendarDays },
]

export function WorkspaceHeader({
  user,
  view,
  devices,
  loading,
  canPrintLastSale,
  operationalDateRef,
  onNavigate,
  onDrawer,
  onRefresh,
  onPrintLastSale,
  onLogout,
}: Props) {
  const owner = user.peran === 'PEMILIK'
  const moreRef = useRef<HTMLDetailsElement>(null)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const value = localStorage.getItem('toko:theme') !== 'light'
    setDark(value)
    document.documentElement.classList.toggle('dark', value)
  }, [])

  useEffect(() => {
    function outside(event: PointerEvent) {
      const menu = moreRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false
      }
    }
    function escape(event: KeyboardEvent) {
      const menu = moreRef.current
      if (event.key === 'Escape' && menu?.open) {
        event.preventDefault()
        event.stopPropagation()
        menu.open = false
        menu.querySelector('summary')?.focus()
      }
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('toko:theme', next ? 'dark' : 'light')
  }

  function closeMenu() {
    if (moreRef.current) moreRef.current.open = false
  }

  return (
    <header className="pos-topbar">
      <div className="pos-topbar-inner">
        <div className="pos-brand">
          <div className="pos-brand-icon">
            {loading ? <RefreshCw className="animate-spin" aria-label="Memuat data" /> : <Store />}
          </div>
          <div>
            <h1>{devices.storeName}</h1>
            <p>{devices.address}</p>
            <StoreClock />
          </div>
        </div>

        <nav className="pos-header-actions" aria-label="Menu utama">
          <div className="pos-operating-session">
            <div ref={operationalDateRef} />
            <div className="pos-quick-actions">
              <Button
                variant="outline"
                aria-label="Buka Laci"
                title="Buka Laci (F10)"
                onClick={onDrawer}
              >
                <Banknote />
                <span className="pos-drawer-label">Buka Laci</span>
                <kbd>F10</kbd>
              </Button>

              <details className="pos-more" ref={moreRef}>
                <summary aria-label="Menu lainnya">
                  <Menu />
                  <span className="sr-only">Menu lainnya</span>
                </summary>
                <div className="pos-more-menu">
                  <p className="pos-user-label">
                    {user.username ?? user.nama} · {owner ? 'Pemilik' : 'Kasir'}
                  </p>
                  <Button
                    variant="ghost"
                    className="pos-theme-toggle"
                    role="switch"
                    aria-checked={dark}
                    aria-label="Tema gelap"
                    onClick={toggleTheme}
                  >
                    {dark ? <Moon /> : <Sun />}
                    <span>Tema {dark ? 'gelap' : 'terang'}</span>
                    <span className="pos-theme-switch" aria-hidden="true">
                      <span />
                    </span>
                  </Button>

                  {owner && (
                    <>
                      <Button
                        variant={view === 'purchases' ? 'default' : 'ghost'}
                        onClick={() => onNavigate('purchases')}
                      >
                        <Truck />
                        Pembelian
                      </Button>
                      <Button
                        variant={view === 'masters' ? 'default' : 'ghost'}
                        onClick={() => onNavigate('masters')}
                      >
                        <WalletCards />
                        Data Master
                      </Button>
                      <Button
                        variant={view === 'devices' ? 'default' : 'ghost'}
                        onClick={() => onNavigate('devices')}
                      >
                        <Settings />
                        Perangkat
                      </Button>
                    </>
                  )}

                  <Button
                    variant="ghost"
                    disabled={loading}
                    onClick={() => {
                      closeMenu()
                      onRefresh()
                    }}
                  >
                    <RefreshCw />
                    Muat ulang data
                  </Button>
                  {canPrintLastSale && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        closeMenu()
                        onPrintLastSale()
                      }}
                    >
                      Cetak struk terakhir
                    </Button>
                  )}
                  <Button variant="ghost" onClick={onLogout}>
                    <LogOut />
                    Keluar
                  </Button>
                </div>
              </details>
            </div>
          </div>

          <div className="pos-primary-nav">
            {primary.map((tab) => (
              <Button
                key={tab.view}
                variant={view === tab.view ? 'default' : 'ghost'}
                aria-label={tab.title}
                aria-current={view === tab.view ? 'page' : undefined}
                onClick={() => onNavigate(tab.view)}
              >
                <tab.icon />
                {tab.view === 'shopping' ? (
                  <span>
                    <span className="shopping-nav-prefix">Rencana </span>Belanja
                  </span>
                ) : (
                  tab.title
                )}
              </Button>
            ))}
          </div>
        </nav>
      </div>
    </header>
  )
}

const storeDate = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
})
const storeTime = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Jakarta',
})

function StoreClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  return (
    <time>{now ? `${storeDate.format(now)} · ${storeTime.format(now)}` : 'Memuat tanggal…'}</time>
  )
}
