// Nilai form/API memakai titik desimal; tampilan rupiah memakai titik ribuan dan koma desimal.
export function formatRupiahInput(value: string) {
  const [whole, fraction] = value.split('.')
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction === undefined ? '' : `,${fraction}`)
  )
}

export function parseRupiahInput(value: string): string | null {
  const text = value
    .trim()
    .replace(/^Rp\s*/i, '')
    .replace(/\s/g, '')
  if (!/^[\d.]*(?:,\d{0,2})?$/.test(text)) return null
  const raw = text
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/^0+(?=\d)/, '')
  return raw.startsWith('.') ? `0${raw}` : raw
}
