'use client'

// ─── Time Tracker ─────────────────────────────────────────────────────────────
//
// Liam's first FIRM must-have for "The Studio Ledger, lit" (SPECS/homepage-lit.md,
// card 9). A FULL standalone time-tracking card in the WORK zone, domain DELIVERY
// (teal). The masthead Workshop-Light is the lite signal; THIS is the real thing.
//
//   <TimeTracker />
//
// Two faces:
//   RUNNING - a large live elapsed clock (HH:MM:SS) recomputed each second from
//     the timer's startedAt via the shared 1s tick (no per-card interval), the
//     request/client it is logged against (data-private), a workshop-ember pulse,
//     and a STOP button that logs the entry.
//   IDLE - a START control. A quick request picker (or a generic "studio time"
//     fallback) opens, and starting POSTs a real timer.
//
// Below either face: today's totals (logged + billable hours, count-up) over a
// hairline, then a short list of today's logged entries when the time endpoint
// returns any.
//
// Endpoints (all admin, already shipped):
//   GET    /api/admin/timers                         -> { timer | null } (+ elapsedSeconds, targetTitle, targetType)
//   POST   /api/admin/timers          { requestId }  -> start (409 if one already runs; retry ?confirmed=true)
//   DELETE /api/admin/timers/[id]?action=log         -> stop + log a timeEntry
//   GET    /api/admin/time?dateFrom=&dateTo=         -> { items, totalHours, billableHours } for today
//   GET    /api/admin/requests?status=active         -> { requests } for the picker
//
// Mutations are optimistic with error fallback: STOP clears the clock instantly
// then reconciles; START flips to running instantly then refetches the canonical
// timer (the server computes targetTitle for us). On failure we revert + surface
// a short inline error. The shell matches cash-runway/domain-card: var(--color-bg)
// surface, 1px hairline (borders not shadows), radius-lg, space-6 padding. Teal
// lands only in the IconChip, the running clock ink, the ember, and the count
// pill. Reduced-motion safe (the ember uses the shared .workshop-pulse, which is
// flat unless motion is allowed). Keyboard accessible throughout.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Timer, Play, Square, ArrowRight, Search } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { IconChip, CountPill } from './domain-card'
import { CountUp } from '@/components/tahi/count-up'
import { useSharedTick } from '@/lib/use-homepage-motion'

// ── Types mirrored from the timer + time endpoints ────────────────────────────

interface ActiveTimer {
  id: string
  startedAt: string
  pausedAt: string | null
  pausedSeconds: number
  requestId: string | null
  taskId: string | null
  orgId: string | null
  notes: string | null
  targetTitle: string | null
  targetType: 'request' | 'task' | 'org'
  elapsedSeconds: number
  isPaused: boolean
}

interface TodayEntry {
  id: string
  orgName: string | null
  requestTitle: string | null
  hours: number
  billable: boolean
  notes: string | null
}

interface PickerRequest {
  id: string
  title: string
  orgName: string | null
  requestNumber: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// HH:MM:SS from a whole-seconds count. Hours are not zero-padded past two digits
// (a timer is never expected to run for >99h, but if it did it would just widen).
function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

// Live elapsed: recompute from startedAt every render so the clock is always
// truthful even if the tab was backgrounded (the shared tick resumes + fires).
function liveElapsedSeconds(timer: ActiveTimer, nowMs: number): number {
  if (timer.isPaused && timer.pausedAt) {
    const end = new Date(timer.pausedAt).getTime()
    const ms = end - new Date(timer.startedAt).getTime() - (timer.pausedSeconds ?? 0) * 1000
    return Math.max(0, Math.floor(ms / 1000))
  }
  const ms = nowMs - new Date(timer.startedAt).getTime() - (timer.pausedSeconds ?? 0) * 1000
  return Math.max(0, Math.floor(ms / 1000))
}

function todayIso(): string {
  // Local calendar day in YYYY-MM-DD. timeEntries.date is stored as a plain
  // calendar date so we filter on the user's local today.
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function fmtHours(h: number): string {
  // One decimal, but drop a trailing .0 so a clean 2h reads "2h" not "2.0h".
  const rounded = Math.round(h * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
}

// ── Component ───────────────────────────────────────────────────────────────────

export function TimeTracker({ className }: { className?: string }) {
  const [timer, setTimer] = useState<ActiveTimer | null>(null)
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState<{ totalHours: number; billableHours: number; items: TodayEntry[] }>({
    totalHours: 0,
    billableHours: 0,
    items: [],
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [srAnnounce, setSrAnnounce] = useState('')

  // Shared 1s tick drives the live clock (no per-card interval).
  useSharedTick(1000)
  const nowMs = Date.now()

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchTimer = useCallback(async (): Promise<ActiveTimer | null> => {
    try {
      const res = await fetch(apiPath('/api/admin/timers'), { cache: 'no-store' })
      if (!res.ok) return null
      const json = (await res.json()) as { timer: ActiveTimer | null }
      return json.timer ?? null
    } catch {
      return null
    }
  }, [])

  const fetchToday = useCallback(async () => {
    try {
      const d = todayIso()
      const res = await fetch(apiPath(`/api/admin/time?dateFrom=${d}&dateTo=${d}`), { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as {
        items?: TodayEntry[]
        totalHours?: number
        billableHours?: number
      }
      setToday({
        totalHours: json.totalHours ?? 0,
        billableHours: json.billableHours ?? 0,
        items: json.items ?? [],
      })
    } catch {
      /* keep last-known totals */
    }
  }, [])

  const refresh = useCallback(async () => {
    const t = await fetchTimer()
    setTimer(t)
    await fetchToday()
  }, [fetchTimer, fetchToday])

  useEffect(() => {
    let active = true
    ;(async () => {
      const t = await fetchTimer()
      if (active) setTimer(t)
      await fetchToday()
      if (active) setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [fetchTimer, fetchToday])

  // ── SR announcements ────────────────────────────────────────────────────────
  // Announce timer state transitions to screen readers via a visually-hidden
  // live region. We use a brief non-empty string then clear it so re-starting
  // the same request fires a fresh announcement each time.
  const prevTimerRef = useRef<ActiveTimer | null>(null)
  useEffect(() => {
    const prev = prevTimerRef.current
    prevTimerRef.current = timer
    if (!loading) {
      if (!prev && timer) {
        // Started
        const name = timer.targetTitle ?? 'Studio time'
        setSrAnnounce(`Timer started for ${name}`)
      } else if (prev && !timer) {
        // Stopped
        setSrAnnounce('Timer stopped')
      } else if (prev && timer && prev.isPaused !== timer.isPaused) {
        setSrAnnounce(timer.isPaused ? 'Timer paused' : 'Timer resumed')
      }
    }
  }, [timer, loading])

  // Clear announcement after a short delay so the same message can fire again.
  useEffect(() => {
    if (!srAnnounce) return
    const id = window.setTimeout(() => setSrAnnounce(''), 2000)
    return () => window.clearTimeout(id)
  }, [srAnnounce])

  // ── Mutations ───────────────────────────────────────────────────────────────

  const start = useCallback(
    async (requestId: string, optimisticLabel: string) => {
      setError(null)
      setBusy(true)
      setPickerOpen(false)
      // Optimistic: paint a running clock immediately from "now".
      const optimistic: ActiveTimer = {
        id: 'optimistic',
        startedAt: new Date().toISOString(),
        pausedAt: null,
        pausedSeconds: 0,
        requestId,
        taskId: null,
        orgId: null,
        notes: null,
        targetTitle: optimisticLabel,
        targetType: 'request',
        elapsedSeconds: 0,
        isPaused: false,
      }
      setTimer(optimistic)
      try {
        let res = await fetch(apiPath('/api/admin/timers'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId }),
        })
        // 409 = a timer already runs; confirm to auto-stop + switch.
        if (res.status === 409) {
          res = await fetch(apiPath('/api/admin/timers?confirmed=true'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId }),
          })
        }
        if (!res.ok) throw new Error('start failed')
        // Refetch canonical timer (server fills targetTitle/targetType) + totals.
        await refresh()
      } catch {
        setError('Could not start the timer')
        setTimer(null)
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const stop = useCallback(async () => {
    if (!timer) return
    setError(null)
    setBusy(true)
    const stopping = timer
    // Optimistic: clear the clock instantly.
    setTimer(null)
    try {
      if (stopping.id === 'optimistic') {
        // The start round-trip never resolved; just resync.
        await refresh()
        return
      }
      const res = await fetch(apiPath(`/api/admin/timers/${stopping.id}?action=log`), { method: 'DELETE' })
      if (!res.ok) throw new Error('stop failed')
      await fetchToday()
    } catch {
      setError('Could not stop the timer')
      // Revert so the user can retry.
      setTimer(stopping)
    } finally {
      setBusy(false)
    }
  }, [timer, refresh, fetchToday])

  // ── Render ──────────────────────────────────────────────────────────────────

  const running = !!timer
  const elapsed = timer ? liveElapsedSeconds(timer, nowMs) : 0

  return (
    <section
      aria-label="Time tracker"
      className={className}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
      }}
    >
      {/* Visually-hidden live region for timer state announcements */}
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
        {srAnnounce}
      </span>

      {/* Header: teal chip + letterpress title + live/idle state pill */}
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2-5)', minWidth: 0 }}>
          <IconChip domain="delivery">
            <Timer size={15} />
          </IconChip>
          <h2 style={LABEL_STYLE}>Time tracker</h2>
        </div>
        {running && (
          <CountPill domain="delivery">
            <span
              className="workshop-pulse"
              aria-hidden="true"
              style={{
                width: '0.375rem',
                height: '0.375rem',
                borderRadius: '9999px',
                background: 'var(--domain-delivery)',
                display: 'inline-block',
              }}
            />
            {timer?.isPaused ? 'Timer paused' : 'Timer running'}
          </CountPill>
        )}
      </div>

      {/* The face: running clock or idle start */}
      {loading ? (
        <div className="tahi-shimmer" style={{ height: '3rem', width: '12rem', borderRadius: 'var(--radius-sm)' }} />
      ) : running ? (
        <RunningFace timer={timer!} elapsed={elapsed} onStop={stop} busy={busy} />
      ) : (
        <IdleFace
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          onStart={start}
          busy={busy}
        />
      )}

      {error && (
        <p role="alert" style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}

      {/* Today's totals */}
      <div
        className="flex items-end"
        style={{
          gap: 'var(--space-5)',
          marginTop: 'var(--space-6)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
        }}
      >
        <Total label="Logged today" value={today.totalHours} />
        <Total label="Billable" value={today.billableHours} />
      </div>

      {/* Today's entries (when the endpoint returns any) */}
      {today.items.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, marginTop: 'var(--space-4)' }}>
          {today.items.slice(0, 4).map(entry => (
            <li
              key={entry.id}
              className="flex items-center justify-between"
              style={{
                gap: 'var(--space-3)',
                padding: 'var(--space-1-5) 0',
                fontSize: 'var(--text-xs)',
                minWidth: 0,
              }}
            >
              <span
                data-private
                style={{
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {entry.requestTitle ?? entry.orgName ?? entry.notes ?? 'Studio time'}
              </span>
              <span
                className="tabular-nums"
                style={{ flexShrink: 0, fontWeight: 600, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}
              >
                {fmtHours(entry.hours)}h
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Footer link to the full time log */}
      <Link
        href="/time"
        className="view-link flex items-center"
        style={{
          gap: 'var(--space-1)',
          marginTop: 'var(--space-4)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-link)',
          textDecoration: 'none',
        }}
      >
        View time log <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
      </Link>
    </section>
  )
}

// ── Running face ────────────────────────────────────────────────────────────────

function RunningFace({
  timer,
  elapsed,
  onStop,
  busy,
}: {
  timer: ActiveTimer
  elapsed: number
  onStop: () => void
  busy: boolean
}) {
  return (
    <div>
      <div className="flex items-baseline" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span
          className="tabular-nums"
          aria-live="off"
          style={{
            fontSize: 'clamp(1.75rem, 5vw, 2.25rem)',
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: 'var(--domain-delivery)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatClock(elapsed)}
        </span>
      </div>

      {/* What it is logged against */}
      <p
        data-private
        style={{
          marginTop: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {timer.targetTitle ?? 'Studio time'}
      </p>

      <button
        type="button"
        onClick={onStop}
        disabled={busy}
        className="tahi-press flex items-center justify-center"
        style={{
          marginTop: 'var(--space-4)',
          gap: 'var(--space-1-5)',
          minHeight: '2.75rem',
          padding: '0 var(--space-4)',
          width: '100%',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Square size={14} aria-hidden="true" fill="currentColor" /> Stop &amp; log
      </button>
    </div>
  )
}

// ── Idle face ───────────────────────────────────────────────────────────────────

function IdleFace({
  pickerOpen,
  setPickerOpen,
  onStart,
  busy,
}: {
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  onStart: (requestId: string, label: string) => void
  busy: boolean
}) {
  if (pickerOpen) {
    return <RequestPicker onPick={onStart} onCancel={() => setPickerOpen(false)} busy={busy} />
  }
  return (
    <div>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
        No timer running. Start one against a request.
      </p>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={busy}
        className="tahi-press flex items-center justify-center"
        style={{
          marginTop: 'var(--space-4)',
          gap: 'var(--space-1-5)',
          minHeight: '2.75rem',
          padding: '0 var(--space-4)',
          width: '100%',
          background: 'var(--domain-delivery)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Play size={14} aria-hidden="true" fill="currentColor" /> Start a timer
      </button>
    </div>
  )
}

// ── Request picker ──────────────────────────────────────────────────────────────

function RequestPicker({
  onPick,
  onCancel,
  busy,
}: {
  onPick: (requestId: string, label: string) => void
  onCancel: () => void
  busy: boolean
}) {
  const [requests, setRequests] = useState<PickerRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    let active = true
    ;(async () => {
      try {
        const res = await fetch(apiPath('/api/admin/requests?status=active'), { cache: 'no-store' })
        if (!res.ok) throw new Error('failed')
        const json = (await res.json()) as { requests?: PickerRequest[] }
        if (active) setRequests(json.requests ?? [])
      } catch {
        if (active) setRequests([])
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? requests.filter(
        r =>
          r.title.toLowerCase().includes(q) ||
          (r.orgName ?? '').toLowerCase().includes(q),
      )
    : requests

  return (
    <div>
      {/* Search field */}
      <div
        className="flex items-center"
        style={{
          gap: 'var(--space-2)',
          padding: '0 var(--space-3)',
          minHeight: '2.75rem',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <Search size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onCancel()
          }}
          placeholder="Search a request to time"
          aria-label="Search a request to time"
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
          }}
        />
        <button
          type="button"
          onClick={onCancel}
          className="tahi-press"
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-subtle)',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            cursor: 'pointer',
            padding: 'var(--space-1) var(--space-1)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Results */}
      <div style={{ marginTop: 'var(--space-2)', maxHeight: '11rem', overflowY: 'auto' }}>
        {loading ? (
          <div className="tahi-shimmer" style={{ height: '2.5rem', width: '100%', borderRadius: 'var(--radius-sm)' }} />
        ) : filtered.length === 0 ? (
          <p style={{ padding: 'var(--space-3) 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
            {q ? 'No matching requests.' : 'No active requests to time.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filtered.slice(0, 8).map(r => {
              const label = r.orgName ? `${r.title} (${r.orgName})` : r.title
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(r.id, label)}
                    className="time-picker-row flex items-center justify-between"
                    style={{
                      width: '100%',
                      gap: 'var(--space-3)',
                      minHeight: '2.75rem',
                      padding: 'var(--space-2) var(--space-2)',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: busy ? 'default' : 'pointer',
                      textAlign: 'left',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: 'hidden' }}>
                      <span
                        data-private
                        style={{
                          display: 'block',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 500,
                          color: 'var(--color-text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.title}
                      </span>
                      {r.orgName && (
                        <span
                          data-private
                          style={{
                            display: 'block',
                            fontSize: 'var(--text-2xs, 0.6875rem)',
                            color: 'var(--color-text-subtle)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.orgName}
                        </span>
                      )}
                    </span>
                    <Play
                      size={13}
                      aria-hidden="true"
                      style={{ flexShrink: 0, color: 'var(--domain-delivery)' }}
                      fill="currentColor"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Today total ─────────────────────────────────────────────────────────────────

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p style={{ ...LABEL_STYLE, color: 'var(--color-text-subtle)', marginBottom: 'var(--space-1)' }}>{label}</p>
      <p
        className="tabular-nums"
        style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 700,
          lineHeight: 1,
          color: 'var(--color-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <CountUp value={value} format={fmtHours} />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-subtle)' }}>h</span>
      </p>
    </div>
  )
}
