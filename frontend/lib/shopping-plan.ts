import type { ShoppingItem } from './types'

/** Tanggal kalender dihitung sebagai tanggal murni, bukan zona waktu browser. */
export function calendarDays(month: string): string[] {
  const first = new Date(`${month}-01T00:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7
  first.setUTCDate(1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first)
    date.setUTCDate(first.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

export function shiftShoppingMonth(month: string, amount: number): string {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + amount)
  return date.toISOString().slice(0, 10)
}

export function shoppingDateLabel(date: string, monthOnly = false): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', ...(monthOnly ? { month: 'long', year: 'numeric' } as const : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as const) }).format(new Date(`${date}T00:00:00Z`))
}

export function shoppingQuantity(item: Pick<ShoppingItem, 'jumlah' | 'satuan'>): string | null {
  if (item.jumlah === null || Number(item.jumlah) <= 0) return null
  const quantity = item.jumlah.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',')
  return [quantity, item.satuan].filter(Boolean).join(' ')
}
