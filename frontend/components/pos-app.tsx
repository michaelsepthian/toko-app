'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { message, logout } from '@/lib/api'
import type { Transaction, User } from '@/lib/types'
import {
  defaultDevices,
  openDrawer,
  printReceipt,
  readDevices,
  type DeviceSettings,
} from '@/lib/hardware'
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
import { useWorkspaceData } from '@/lib/use-workspace-data'
import { WorkspaceHeader, type View } from './pos/workspace-header'

export function PosApp() {
  return <AuthGate>{(user) => <Workspace key={user.id} user={user} />}</AuthGate>
}

function Workspace({ user }: { user: User }) {
  const owner = user.peran === 'PEMILIK'
  const [view, setView] = useState<View>('cashier')
  const { data, loading, error, setError, refresh, refreshStocks } = useWorkspaceData(
    owner,
    view === 'purchases',
  )
  const [notice, setNotice] = useNotice()
  const [devices, setDevices] = useState<DeviceSettings>(defaultDevices)
  const [lastSale, setLastSale] = useState<Transaction | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const drawerBusy = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  useContentMotion(contentRef, view)
  useDismissInteractions()
  useEffect(() => {
    clearActionHash()
  }, [])
  const [operationalDateHost, setOperationalDateHost] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setDevices(readDevices())
  }, [])
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const measure = () =>
      document.documentElement.style.setProperty(
        '--pos-header-height',
        `${header.getBoundingClientRect().height}px`,
      )
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    measure()
    return () => observer.disconnect()
  }, [])
  function navigate(next: View) {
    document
      .querySelectorAll<HTMLDetailsElement>(
        '.pos-more[open], .shopping-item-menu[open], .sale-shortcuts[open], .sale-product-options[open]',
      )
      .forEach((menu) => {
        menu.open = false
      })
    window.dispatchEvent(new Event('toko-close-popovers'))
    clearActionHash()
    setView(next)
  }

  async function drawer() {
    if (drawerBusy.current) return
    drawerBusy.current = true
    setError('')
    try {
      setNotice(await openDrawer(devices))
    } catch (err) {
      setNotice(`Buka laci belum berhasil: ${message(err)}`)
    } finally {
      drawerBusy.current = false
    }
  }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key !== 'F10'
      )
        return
      event.preventDefault()
      if (!event.repeat) void drawer()
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })
  async function print(sale: Transaction) {
    try {
      setNotice(await printReceipt(sale, data.payments, devices))
    } catch (err) {
      setError(`Transaksi tersimpan; cetak belum berhasil: ${message(err)}`)
    }
  }
  async function saved(record: Transaction, purchase: boolean, shouldPrint: boolean) {
    setNotice(purchase ? `${record.nomor} tersimpan.` : '')
    setError('')
    if (!purchase) setLastSale(record)
    if (purchase) await refreshStocks()
    if (!purchase && shouldPrint) await print(record)
    const method = data.payments.find((p) => p.id === record.metode_pembayaran_id)
    if (
      !purchase &&
      record.status === 'SELESAI' &&
      devices.autoDrawer &&
      method?.jenis === 'CASH'
    ) {
      try {
        setNotice(await openDrawer(devices))
      } catch (err) {
        setError(`Transaksi tersimpan; perintah laci gagal: ${message(err)}`)
      }
    }
  }
  return (
    <main className="pos-app min-h-screen bg-background text-foreground">
      <div ref={headerRef}>
        <WorkspaceHeader
          user={user}
          view={view}
          devices={devices}
          loading={loading}
          canPrintLastSale={lastSale !== null}
          operationalDateRef={setOperationalDateHost}
          onNavigate={navigate}
          onDrawer={() => void drawer()}
          onRefresh={() => {
            void refresh(false, true)
            if (view === 'purchases') void refreshStocks()
          }}
          onPrintLastSale={() => {
            if (lastSale) void print(lastSale)
          }}
          onLogout={async () => {
            try {
              await logout()
            } catch (err) {
              setError(message(err))
            }
          }}
        />
        {error && (
          <div className="pos-error-banner flex items-center gap-2">
            <div className="flex-1">
              <ErrorBox>{error}</ErrorBox>
            </div>
            <Button variant="ghost" aria-label="Tutup pesan kesalahan" onClick={() => setError('')}>
              <X />
            </Button>
          </div>
        )}
      </div>
      {notice && (
        <div role="status" className="pos-toast">
          <span>{notice}</span>
          <button aria-label="Tutup pemberitahuan" onClick={() => setNotice('')}>
            <X className="size-4" />
          </button>
        </div>
      )}
      <div ref={contentRef} className="pos-view-content">
        <SaleCheckout
          loading={loading}
          user={user}
          data={data}
          active={view === 'cashier'}
          operationalDateHost={operationalDateHost}
          onSaved={saved}
          onReprint={print}
        />
        {owner && (
          <Checkout
            loading={loading}
            user={user}
            data={data}
            purchase
            active={view === 'purchases'}
            onSaved={saved}
          />
        )}
        {view === 'purchases' && owner && <Inventory data={data} refresh={refreshStocks} />}
        {view === 'products' && (
          <Products loading={loading} data={data} refresh={refresh} owner={owner} />
        )}
        <ShoppingPlan
          active={view === 'shopping'}
          owner={owner}
          data={data}
          masterLoading={loading}
        />
        {view === 'history' && (
          <History
            data={data}
            owner={owner}
            refresh={refresh}
            print={print}
            storeName={devices.storeName}
            userID={user.id}
          />
        )}
        {view === 'masters' && owner && <Masters data={data} refresh={refresh} />}
        {view === 'devices' && owner && <Devices settings={devices} onChange={setDevices} />}
      </div>
    </main>
  )
}
