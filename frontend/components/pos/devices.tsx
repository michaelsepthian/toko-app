'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { ResponsivePanel } from '@/components/ui/responsive-panel'
import { defaultDevices, openDrawer, printers, type DeviceSettings } from '@/lib/hardware'
import { message } from '@/lib/api'
import { useNotice } from '@/lib/use-notice'
import { ErrorBox, Field, inputClass, Panel } from './common'
import { SearchSelect } from './search-select'

export function Devices({ settings, onChange }: { settings: DeviceSettings; onChange: (settings: DeviceSettings) => void }) {
  const [names, setNames] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useNotice()
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<'printer' | 'identity' | null>(null)
  const [draft, setDraft] = useState(settings)
  const update = (patch: Partial<DeviceSettings>) => setDraft(previous => ({ ...previous, ...patch }))
  function edit(kind: 'printer' | 'identity') { setDraft(settings); setError(''); setEditor(kind) }

  return <div className="mx-auto max-w-5xl space-y-4 p-5">
    {status && <p role="status" className="text-sm text-primary">{status}</p>}
    <div className="grid gap-5 md:grid-cols-2">
      <Panel title="Printer & laci USB" subtitle="Pengaturan disimpan pada browser komputer kasir ini."><p className="mb-4 text-sm">{settings.mode === 'qz' ? `QZ Tray · ${settings.printer || 'Printer belum dipilih'}` : 'Dialog cetak browser'} · {settings.width} mm</p><Button onClick={() => edit('printer')}>Edit perangkat</Button></Panel>
      <Panel title="Identitas struk & scanner"><p className="mb-1 font-semibold">{settings.storeName}</p><p className="mb-4 text-sm text-muted-foreground">{settings.address}</p><Button onClick={() => edit('identity')}>Edit identitas struk</Button></Panel>
    </div>
    <ResponsivePanel open={editor !== null} title={editor === 'identity' ? 'Edit identitas struk' : 'Edit perangkat'} busy={busy} dirty={JSON.stringify(draft) !== JSON.stringify(settings)} onClose={() => setEditor(null)}>
      <ErrorBox>{error}</ErrorBox>
      {status && <p role="status" className="mb-3 text-sm text-primary">{status}</p>}
      <form onSubmit={event => {
        event.preventDefault()
        try { localStorage.setItem('toko:devices', JSON.stringify(draft)); onChange(draft); setStatus('Pengaturan perangkat tersimpan.'); setEditor(null) }
        catch (err) { setError(message(err)) }
      }}><fieldset disabled={busy} className="space-y-4">
        {editor === 'identity' ? <>
          <Field label="Nama toko" value={draft.storeName} onChange={storeName => update({ storeName })} />
          <Field label="Alamat toko" value={draft.address} onChange={address => update({ address })} />
          <Field label="Pesan penutup" value={draft.footer} onChange={footer => update({ footer })} />
          <p className="text-sm text-muted-foreground">Scanner USB: atur mode keyboard/HID dan akhiran Enter. Barcode harus cocok persis, termasuk angka nol di depan.</p>
        </> : <>
          <div className="text-sm font-semibold"><span>Cara cetak</span><SearchSelect className={inputClass} value={draft.mode} onValueChange={value => update({ mode: value as DeviceSettings['mode'] })} aria-label="Cara cetak"><option value="browser">Dialog cetak browser</option><option value="qz">QZ Tray / ESC-POS</option></SearchSelect></div>
          {draft.mode === 'qz' && <>
            <BusyButton type="button" variant="outline" busy={busy} busyLabel="Menghubungkan…" onClick={async () => { if (busy) return; setBusy(true); setError(''); try { setNames(await printers()); setStatus('Terhubung ke QZ Tray. Pilih printer USB.') } catch (err) { setError(`Tidak dapat menghubungkan QZ Tray: ${message(err)}`) } finally { setBusy(false) } }}>Hubungkan QZ Tray & cari printer</BusyButton>
            <SearchSelect className={inputClass} value={draft.printer} onValueChange={value => update({ printer: value })} aria-label="Nama printer"><option value="">Pilih printer</option>{[...new Set([draft.printer, ...names])].filter(Boolean).map(name => <option key={name}>{name}</option>)}</SearchSelect>
            <SearchSelect className={inputClass} value={draft.drawerPin} onValueChange={value => update({ drawerPin: Number(value) as 0 | 1 })} aria-label="Pin laci pada printer"><option value={0}>Pin 2 (default)</option><option value={1}>Pin 5</option></SearchSelect>
            <label className="flex gap-2"><input type="checkbox" checked={draft.autoDrawer} onChange={e => update({ autoDrawer: e.target.checked })} />Buka laci setelah transaksi cash berhasil</label>
            <BusyButton type="button" variant="outline" busy={busy} busyLabel="Mengirim perintah…" onClick={async () => { if (busy) return; setBusy(true); setError(''); try { setStatus(await openDrawer(draft)) } catch (err) { setError(message(err)) } finally { setBusy(false) } }}>Tes perintah laci</BusyButton>
          </>}
          <SearchSelect className={inputClass} value={draft.width} onValueChange={value => update({ width: value as '58' | '80' })} aria-label="Lebar struk"><option value="58">58 mm</option><option value="80">80 mm</option></SearchSelect>
          <p className="text-sm text-muted-foreground">QZ Tray harus berjalan di komputer ini. Printer harus mendukung ESC/POS. Jalur laci menggunakan port laci printer.</p>
          <a className="text-primary underline" href="https://qz.io/download/" target="_blank" rel="noreferrer">Unduh QZ Tray</a>
        </>}
        <div className="flex flex-wrap gap-2"><Button type="submit">Simpan pengaturan</Button><Button type="button" variant="outline" onClick={() => { if (window.confirm('Kembalikan semua pengaturan perangkat ke nilai awal?')) setDraft(defaultDevices) }}>Kembalikan pengaturan awal</Button></div>
      </fieldset></form>
    </ResponsivePanel>
  </div>
}
