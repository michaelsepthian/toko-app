/** Hari toko mengikuti WIB, terlepas dari zona waktu browser kasir. */
export function jakartaDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
