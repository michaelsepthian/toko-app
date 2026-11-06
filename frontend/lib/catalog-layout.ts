/** Match the 14px row insets and 11px column gap in globals.css. */
export function catalogColumns(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 2
  const available = width - 28
  const minimumCard = 216
  const gap = 11
  return Math.max(2, Math.floor((available + gap) / (minimumCard + gap)))
}
