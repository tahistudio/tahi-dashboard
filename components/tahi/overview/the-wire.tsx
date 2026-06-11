'use client'

// ─── The Wire ─────────────────────────────────────────────────────────────────
//
// A 32px stepped ticker rail for "The Studio Ledger, lit" (SPECS/homepage-lit.md,
// Dynamics layer 3). It pulls the most recent cross-dashboard events from
// /api/admin/overview/wire and shows ONE at a time: a small category dot in the
// event's --domain-* ink, the text, and a relative time. It auto-advances every
// 4s with a 240ms slide-up (transform + opacity only), and PAUSES on hover,
// focus-within, or when the tab is hidden.
//
// Resting-page budget: at rest the Wire's 4s step is one of the only two moving
// things on the page (the other is the minute marker). Under prefers-reduced-
// motion it degrades to a short static list with no auto-advance and no slide.
//
// aria-live="polite" announces each new event to assistive tech. Money + client
// event text can carry amounts/names, so those rows carry data-private.

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPath } from '@/lib/api'

type WireDomain = 'content' | 'social' | 'sales' | 'money' | 'client' | 'ops'

interface WireEvent {
  id: string
  type: WireDomain
  text: string
  at: string
}

// Domain ink token per category. CSS var STRINGS only (never runtime-built class
// names) so dark mode swaps to the -bright inks without any JS.
const DOMAIN_INK: Record<WireDomain, string> = {
  content: 'var(--domain-content)',
  social: 'var(--domain-social)',
  sales: 'var(--domain-sales)',
  money: 'var(--domain-money)',
  client: 'var(--domain-clients)',
  ops: 'var(--domain-ops)',
}

// Categories whose text can carry an amount or a client name.
const PRIVATE_DOMAINS: ReadonlySet<WireDomain> = new Set<WireDomain>(['money', 'client'])

const DWELL_MS = 4000
const SLIDE_MS = 240
const RAIL_HEIGHT = '2rem' // 32px

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Compact relative time, e.g. "just now", "4m", "3h", "2d". Total + safe: an
// unparseable timestamp renders nothing rather than "NaN".
function relativeTime(at: string, now: number): string {
  const ms = new Date(at).getTime()
  if (!Number.isFinite(ms)) return ''
  const diff = Math.max(0, now - ms)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.floor(hr / 24)
  return `${d}d`
}

export function TheWire({ className }: { className?: string }) {
  const [events, setEvents] = useState<WireEvent[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const cleanupSwap = useRef<number | null>(null)

  // Detect reduced motion once on mount (and keep it stable for the session).
  useEffect(() => {
    setReduced(prefersReducedMotion())
  }, [])

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/overview/wire'))
      if (!res.ok) throw new Error('Failed')
      const json = (await res.json()) as { events?: WireEvent[] }
      const next = json.events ?? []
      setEvents(next)
      setIndex(0)
      setNow(Date.now())
    } catch {
      setEvents([])
    }
  }, [])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  // Pause whenever the tab is hidden; resume (and refresh "now") when visible.
  useEffect(() => {
    function onVisibility() {
      if (typeof document === 'undefined') return
      if (document.hidden) {
        setPaused(true)
      } else {
        setNow(Date.now())
        setPaused(false)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Auto-advance loop. Suspended under reduced motion, while paused (hover /
  // focus-within / hidden tab), and when there is 0 or 1 event to show. The
  // slide-out plays first, then we swap the event and slide the new one in.
  useEffect(() => {
    if (reduced) return
    if (paused) return
    if (events.length < 2) return

    const dwell = window.setTimeout(() => {
      setPhase('out')
      const swap = window.setTimeout(() => {
        setIndex(i => (i + 1) % events.length)
        setNow(Date.now())
        setPhase('in')
      }, SLIDE_MS)
      // Store the inner timer on the outer closure so the cleanup clears both.
      cleanupSwap.current = swap
    }, DWELL_MS)

    return () => {
      window.clearTimeout(dwell)
      if (cleanupSwap.current != null) {
        window.clearTimeout(cleanupSwap.current)
        cleanupSwap.current = null
      }
    }
  }, [reduced, paused, events.length, index])

  // Empty state: a calm one-liner, no rail chrome beyond the height.
  if (events.length === 0) {
    return (
      <div
        className={className}
        style={{
          height: RAIL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-subtle)',
        }}
      >
        The wire is quiet. New activity across the studio shows up here.
      </div>
    )
  }

  // Reduced motion: a short static list, no auto-advance, no marquee.
  if (reduced) {
    const list = events.slice(0, 4)
    return (
      <ul
        className={className}
        aria-label="Recent studio activity"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-4)',
          minHeight: RAIL_HEIGHT,
          fontSize: 'var(--text-xs)',
        }}
      >
        {list.map(e => (
          <li key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <Dot domain={e.type} />
            <span
              {...(PRIVATE_DOMAINS.has(e.type) ? { 'data-private': true } : {})}
              style={{ color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {e.text}
            </span>
            <RelTime at={e.at} now={now} />
          </li>
        ))}
      </ul>
    )
  }

  const current = events[index]

  return (
    <div
      ref={wrapRef}
      className={className}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(p => (typeof document !== 'undefined' && document.hidden ? p : false))}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => {
        // Only resume if focus left the rail entirely.
        if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) setPaused(false)
      }}
      style={{
        height: RAIL_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        fontSize: 'var(--text-xs)',
      }}
    >
      {/* Stable live region: always present, never animated, so SR picks up each
          event announcement reliably regardless of the visual transition state. */}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {current.text}
      </span>

      {/* Visual ticker: transitions are decorative only; no live region here. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2-5)',
          minWidth: 0,
          transform: phase === 'in' ? 'translateY(0)' : 'translateY(-0.5rem)',
          opacity: phase === 'in' ? 1 : 0,
          transition: `transform ${SLIDE_MS}ms var(--ease-productive), opacity ${SLIDE_MS}ms var(--ease-productive)`,
        }}
      >
        <Dot domain={current.type} />
        <span
          {...(PRIVATE_DOMAINS.has(current.type) ? { 'data-private': true } : {})}
          style={{
            color: 'var(--color-text)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {current.text}
        </span>
        <RelTime at={current.at} now={now} />
      </div>
    </div>
  )
}

// ── Small parts ────────────────────────────────────────────────────────────────

function Dot({ domain }: { domain: WireDomain }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '0.4375rem',
        height: '0.4375rem',
        flexShrink: 0,
        borderRadius: '9999px',
        background: DOMAIN_INK[domain],
        display: 'inline-block',
      }}
    />
  )
}

function RelTime({ at, now }: { at: string; now: number }) {
  const label = relativeTime(at, now)
  if (!label) return null
  return (
    <span
      style={{
        flexShrink: 0,
        color: 'var(--color-text-subtle)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}
