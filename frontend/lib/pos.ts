import Decimal from 'decimal.js'
import type { CartLine, Payment } from './types'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
const currencyFormatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 })
const dateFormatter = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta' })
export const money = (value: Decimal.Value = 0) => currencyFormatter.format(new Decimal(value || 0).toNumber())
export const dateTime = (value: string) => dateFormatter.format(new Date(value))
export function totals(lines: CartLine[], discount: string, method?: Payment, purchase = false) {
  const subtotal = lines.reduce((sum, line) => sum.plus(new Decimal(line.quantity || 0).mul(line.price || 0).minus(line.discount || 0).toDecimalPlaces(2)), new Decimal(0))
  const base = subtotal.minus(discount || 0)
  const fee = base.mul(method?.tarif_persen || 0).div(100).plus(method?.tarif_tetap || 0).toDecimalPlaces(0)
  const total = base.plus(purchase || method?.penanggung_biaya === 'PELANGGAN' ? fee : 0)
  return { subtotal, base, fee, total }
}
export function validLines(lines: CartLine[], discount = '0') {
  try {
    if (!lines.length || lines.length > 200 || !validNumber(discount, 2, true)) return false
    for (const line of lines) {
      if (!validNumber(line.quantity, 3, false) || !validNumber(line.price, 2, true) || !validNumber(line.discount, 2, true)) return false
      if (new Decimal(line.discount).gt(new Decimal(line.quantity).mul(line.price))) return false
    }
    return new Decimal(discount).lte(totals(lines, '0').subtotal)
  } catch { return false }
}
export function validNumber(value: string, places: number, zero: boolean) {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(value)) return false
  const n = new Decimal(value)
  return (zero ? n.gte(0) : n.gt(0)) && n.lt('1000000000000000')
}
export function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}
