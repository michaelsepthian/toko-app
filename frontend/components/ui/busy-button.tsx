'use client'

import { LoaderCircle } from 'lucide-react'
import { Button } from './button'
import type { ComponentProps } from 'react'

export function BusyButton({
  busy,
  busyLabel = 'Menyimpan…',
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { busy: boolean; busyLabel?: string }) {
  return (
    <Button {...props} disabled={disabled || busy} aria-busy={busy}>
      {busy ? (
        <>
          <LoaderCircle className="ui-spinner" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
