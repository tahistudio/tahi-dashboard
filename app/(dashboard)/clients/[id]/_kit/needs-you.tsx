'use client'

/**
 * <NeedsYou>. The strip that leads the client Overview: everything about this
 * account that is waiting on the studio, each line paired with the button that
 * answers it. When nothing is outstanding it says so in the same place rather
 * than disappearing, so an empty strip reads as "checked and clear" instead of
 * "not loaded".
 */

import { useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import type { NeedItem } from './needs'

const TONE_DOT: Record<NeedItem['tone'], string> = {
  danger: 'var(--color-danger)',
  warn: 'var(--color-warning)',
  info: 'var(--color-info)',
}

export function NeedsYou({
  items,
  loading,
  onAct,
}: {
  items: NeedItem[]
  loading?: boolean
  onAct: (item: NeedItem) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? items : items.slice(0, 5)
  const clear = items.length === 0

  if (loading) {
    return (
      <div
        className="animate-pulse"
        style={{
          minHeight: '5rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
        aria-hidden="true"
      />
    )
  }

  return (
    <section
      aria-label="Needs you"
      style={{
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${clear ? 'var(--color-border-strong)' : 'var(--badge-danger-border)'}`,
        // --badge-danger-* rather than --color-danger-bg: globals.css declares
        // that --color-danger-bg is deliberately not overridden for dark, so a
        // --color-text line on it is near-white on near-white in dark mode.
        background: clear ? 'var(--color-bg)' : 'var(--badge-danger-bg)',
        overflow: 'hidden',
      }}
    >
      <div className="flex items-center flex-wrap" style={{ gap: '0.5625rem', padding: '0.75rem 1rem' }}>
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center flex-shrink-0"
          style={{
            width: '1.625rem',
            height: '1.625rem',
            borderRadius: 'var(--radius-leaf-sm)',
            background: clear ? 'var(--color-brand)' : 'var(--color-danger)',
            color: '#ffffff',
          }}
        >
          {clear ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        </span>
        <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>
          {clear ? 'Nothing needs you' : 'Needs you'}
        </h3>
        {!clear && (
          <span
            className="tabular-nums"
            style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--badge-danger-text)' }}
          >
            {items.length}
          </span>
        )}
        {clear && (
          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
            Quiet in a good way. Nothing overdue, nothing waiting on a signature.
          </span>
        )}
      </div>

      {!clear && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 0.5rem 0.5rem', display: 'flex', flexDirection: 'column' }}>
          {shown.map(item => (
            <li
              key={item.key}
              className="flex items-center flex-wrap"
              style={{
                gap: '0.625rem',
                minHeight: '2.75rem',
                padding: '0.3125rem 0.5rem',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '0.5rem',
                  height: '0.5rem',
                  borderRadius: '9999px',
                  flexShrink: 0,
                  background: TONE_DOT[item.tone],
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: '10rem',
                  fontSize: '0.8125rem',
                  lineHeight: 1.4,
                  color: 'var(--color-text)',
                }}
              >
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => onAct(item)}
                // Three overdue requests would otherwise give three buttons
                // named only "Open". The line itself is the distinguisher.
                aria-label={`${item.action}: ${item.text}`}
                className="tahi-focus-ring"
                style={{
                  flexShrink: 0,
                  minHeight: '2.75rem',
                  padding: '0 0.75rem',
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: 'var(--radius-button)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-brand)'
                  e.currentTarget.style.color = 'var(--color-brand-dark)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border-strong)'
                  e.currentTarget.style.color = 'var(--color-text)'
                }}
              >
                {item.action}
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="tahi-focus-ring"
          style={{
            margin: '0 0.75rem 0.5rem',
            minHeight: '2.75rem',
            padding: '0 0.25rem',
            border: 'none',
            background: 'none',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          {showAll ? 'Show fewer' : `Show ${items.length - 5} more`}
        </button>
      )}
    </section>
  )
}
