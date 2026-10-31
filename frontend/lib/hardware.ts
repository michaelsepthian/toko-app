import type { Payment, Transaction } from './types'
import { dateTime, escapeHTML, money } from './pos'

export type DeviceSettings = { mode: 'browser' | 'qz'; printer: string; width: '58' | '80'; drawerPin: 0 | 1; autoDrawer: boolean; storeName: string; address: string; footer: string }
export const defaultDevices: DeviceSettings = { mode: 'browser', printer: '', width: '80', drawerPin: 0, autoDrawer: false, storeName: 'Toko Suhartini', address: 'Taman Kopo Indah Ruko 2 No. 5', footer: 'Terima kasih atas kunjungan Anda' }
export function readDevices(): DeviceSettings {
  try { return { ...defaultDevices, ...JSON.parse(localStorage.getItem('toko:devices') || '{}') } } catch { return defaultDevices }
}
async function connect() {
  const module = await import('qz-tray')
  const qz = module.default
  if (!qz.websocket.isActive()) await qz.websocket.connect()
  return qz
}
export async function printers(): Promise<string[]> { const result = await (await connect()).printers.find(); return Array.isArray(result) ? result : [result] }
// Nama produk dari database tidak boleh menyisipkan perintah ESC/POS.
export function rawText(value: string) { return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '') }
function receiptText(sale: Transaction, method: string, settings: DeviceSettings) {
  const columns = settings.width === '58' ? 32 : 48
  const rule = '-'.repeat(columns)
  const output = [rawText(settings.storeName), rawText(settings.address), rule, rawText(sale.nomor), dateTime(sale.tanggal), `Metode: ${rawText(method)}`, rule]
  for (const line of sale.detail ?? []) {
    const name = rawText(line.nama_produk)
    for (let offset = 0; offset < name.length; offset += columns) output.push(name.slice(offset, offset + columns))
    output.push(`${line.jumlah} x ${money(line.harga_jual ?? '0')}`, `  ${money(line.subtotal)}`)
  }
  output.push(rule, `Subtotal: ${money(sale.subtotal_barang)}`, `Diskon: ${money(sale.diskon_transaksi)}`,
    `Biaya pembayaran: ${money(sale.biaya_pembayaran)}`, `TOTAL: ${money(sale.total_tagihan ?? '0')}`,
    `Bayar: ${money(sale.jumlah_dibayar ?? '0')}`, `Kembali: ${money(sale.kembalian ?? '0')}`, rule, rawText(settings.footer))
  return output.map(rawText).join('\n')
}
export async function printReceipt(sale: Transaction, payments: Payment[], settings: DeviceSettings) {
  if (sale.status !== 'SELESAI' || !sale.detail?.length) throw new Error('Hanya transaksi selesai dengan detail yang dapat dicetak.')
  const method = payments.find(p => p.id === sale.metode_pembayaran_id)?.nama ?? 'Pembayaran'
  if (settings.mode === 'qz') {
    if (!settings.printer) throw new Error('Pilih printer pada menu Perangkat.')
    const qz = await connect()
    await qz.print(qz.configs.create(settings.printer, { encoding: 'UTF-8' }), [
      { type: 'raw', format: 'command', flavor: 'plain', data: '\x1b@' + receiptText(sale, method, settings) + '\n\n\n\x1dV\x00' },
    ])
    return 'Struk dikirim ke antrean printer.'
  }
  const text = receiptText(sale, method, settings)
  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.title = 'Cetak struk'; frame.style.cssText = 'position:fixed;width:0;height:0;border:0;bottom:0;right:0'
    frame.onload = () => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); resolve() } catch (err) { reject(err) }
      window.setTimeout(() => frame.remove(), 60000)
    }
    frame.srcdoc = `<!doctype html><html lang="id"><head><title>${escapeHTML(sale.nomor)}</title><style>@page{size:${settings.width}mm auto;margin:3mm}body{margin:0;color:#000;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace;max-width:${settings.width === '58' ? 50 : 72}mm}</style></head><body><pre>${escapeHTML(text)}</pre></body></html>`
    document.body.appendChild(frame)
  })
  return 'Dialog cetak dibuka. Konfirmasi pada browser.'
}
export async function openDrawer(settings: DeviceSettings) {
  if (settings.mode !== 'qz' || !settings.printer) throw new Error('Pembukaan laci memerlukan QZ Tray dan printer ESC/POS yang sudah dipilih.')
  const qz = await connect()
  // ESC p m t1 t2; pin 0/1 merujuk pin keluaran drawer pada printer.
  await qz.print(qz.configs.create(settings.printer), [{ type: 'raw', format: 'command', flavor: 'plain', data: '\x1bp' + String.fromCharCode(settings.drawerPin) + '\x19\xfa' }])
  return 'Perintah buka laci dikirim. Periksa perangkat.'
}
