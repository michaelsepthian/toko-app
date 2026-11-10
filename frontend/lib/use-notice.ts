'use client'

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** Only transient messages expire; loading, errors and pending recovery stay visible. */
export function useNotice(): [string, Dispatch<SetStateAction<string>>] {
  const [notice, setNotice] = useState({ message: '' })
  const publish = useCallback<Dispatch<SetStateAction<string>>>(value => {
    // A new object also restarts the timer when the same message is published again.
    setNotice(previous => ({ message: typeof value === 'function' ? value(previous.message) : value }))
  }, [])

  useEffect(() => {
    if (!notice.message) return
    const timer = window.setTimeout(() => setNotice(current => current === notice ? { message: '' } : current), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  return [notice.message, publish]
}
