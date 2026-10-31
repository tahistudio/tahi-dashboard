'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, RotateCw } from 'lucide-react'
import { formatRelative } from '@/components/tahi/relative-time'

export interface RefreshButtonProps {
  onRefresh: () => void | Promise<void>
  refreshing: boolean
  /** Epoch ms of the last successful refresh, null until one has happened this visit. */
  refreshedAt: number | null
}

/** How often the "updated" hint recomputes. Not a poll: it only redraws the label. */
const HINT_TICK_MS = 30_000

const ICON_BUTTON_CLASS =
  'tahi-focus-ring inline-flex items-center justify-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] aria-disabled:cursor-wait aria-disabled:opacity-70'

/**
 * Icon button that refetches the round, the comments and the issues of the open page on demand.
 * While loading it spins and is aria-disabled (not disabled, so keyboard focus stays) and ignores
 * clicks. The status region is always rendered so the first announcement is not missed; the visible
 * "Updated just now" hint is hidden on narrow screens, where the icon alone has to do.
 */
export function RefreshButton({ onRefresh, refreshing, refreshedAt }: RefreshButtonProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (refreshedAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), HINT_TICK_MS)
    return () => clearInterval(id)
  }, [refreshedAt])

  const hint = refreshedAt === null ? '' : `Updated ${formatRelative(new Date(refreshedAt), now).toLowerCase()}`
  const text = refreshing ? 'Refreshing' : hint

  return (
    <span className="inline-flex items-center" style={{ gap: '0.5rem' }}>
      <button
        type="button"
        onClick={() => {
          if (refreshing) return
          void onRefresh()
        }}
        aria-disabled={refreshing}
        aria-label="Refresh round, comments and issues"
        title="Refresh round, comments and issues"
        className={ICON_BUTTON_CLASS}
        style={{ minWidth: '2.75rem', minHeight: '2.75rem' }}
      >
        <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
      </button>
      <span
        role="status"
        className={text ? 'sr-only whitespace-nowrap text-[var(--color-text-muted)] sm:not-sr-only sm:inline' : 'sr-only'}
        style={{ fontSize: '0.75rem' }}
      >
        {text}
      </span>
    </span>
  )
}

export interface ReloadFramesButtonProps {
  onReload: () => void
  disabled?: boolean
}

/** Reloads the site frames themselves (the data refresh above leaves them alone). */
export function ReloadFramesButton({ onReload, disabled = false }: ReloadFramesButtonProps) {
  return (
    <button
      type="button"
      onClick={onReload}
      disabled={disabled}
      aria-label="Reload page frames"
      title="Reload page frames"
      className={`${ICON_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
      style={{ minWidth: '2.75rem', minHeight: '2.75rem' }}
    >
      <RotateCw className="size-4" aria-hidden="true" />
    </button>
  )
}
