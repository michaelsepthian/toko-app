// Offsets include the gap after each row; the last entry is the total height.
export function catalogOffsets(
  count: number,
  heights: ReadonlyMap<number, number>,
  estimate = 190,
  gap = 11,
) {
  const offsets = [0]
  for (let row = 0; row < count; row++)
    offsets.push(offsets[row] + (heights.get(row) ?? estimate) + gap)
  return offsets
}

export function catalogWindow(offsets: number[], top: number, height: number, overscan = 2) {
  const count = offsets.length - 1
  function rowAt(position: number) {
    let low = 0,
      high = count
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (offsets[middle + 1] <= position) low = middle + 1
      else high = middle
    }
    return low
  }
  return {
    start: Math.max(0, rowAt(top) - overscan),
    end: Math.min(count, rowAt(top + height) + 1 + overscan),
  }
}
