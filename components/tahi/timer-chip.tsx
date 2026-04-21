'use client'

/**
 * <TimerChip> — always-present timer control in the admin top-nav.
 *
 * Two states in one button:
 *
 *   Idle:    Play icon. Click → opens a Popover with a searchable list of
 *            active requests. Pick one → POST /api/admin/timers → chip
 *            switches to the active state with HH:MM:SS.
 *   Active:  Pause dot + HH:MM:SS (or just the dot on small screens).
 *            Click → opens the controls popover: Pause/Resume, Stop &
 *            log, Discard, jump to request.
 *
 * Heartbeats POST /api/admin/timers/ping every 30s while active. Polls
 * GET /api/admin/timers every 30s so the chip resyncs with the server
 * (catches pauses from another tab, stop from the request page, etc.).
 *
 * On first load, if the active timer's lastPingAt is > 2 minutes old
 * we prompt the user to log or discard — covers laptop-sleep gaps.
 *
 * Admin-only. Clients never see this.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Play, Pause, Square, Loader2, Clock3, ChevronDown, ExternalLink, Search,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { formatElapsed, isStaleTimer } from '@/lib/timer-helpers'
import { useToast } from '@/components/tahi/toast'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { Popover } from '@/components/tahi/popover'

interface ActiveTimerResponse {
  timer: {
    id: string
    requestId: string | null
    taskId: string | null
    startedAt: string
    pausedAt: string | null
    pausedSeconds: number
    lastPingAt: string
    notes: string | null
    targetTitle: string | null
    targetType: 'request' | 'task'
    elapsedSeconds: number
    elapsedHours: number
    isPaused: boolean
  } | null
}

interface RequestOption {
  id: string
  title: string
  orgName: string | null
  requestNumber: number | null
}

const POLL_MS = 30_000

export function TimerChip() {
  const [timer, setTimer] = useState<ActiveTimerResponse['timer']>(null)
  const [loaded, setLoaded] = useState(false)
  const [tick, setTick] = useState(0)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const [staleTimer, setStaleTimer] = useState<ActiveTimerResponse['timer']>(null)

  const [requests, setRequests] = useState<RequestOption[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const triggerRef = useRef<HTMLButtonElement>(null)
  const { showToast } = useToast()

  // --- fetch + heartbeat ---------------------------------------------------

  const fetchTimer = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/timers'))
      if (!res.ok) return
      const data = await res.json() as ActiveTimerResponse
      if (!loaded && data.timer && isStaleTimer(data.timer.lastPingAt)) {
        setStaleTimer(data.timer)
      }
      setTimer(data.timer)
    } catch {
      // silent — offline / transient
    } finally {
      setLoaded(true)
    }
  }, [loaded])

  const sendPing = useCallback(async () => {
    try {
      await fetch(apiPath('/api/admin/timers/ping'), { method: 'POST' })
    } catch { /* silent */ }
  }, [])

  useEffect(() => { void fetchTimer() }, [fetchTimer])

  useEffect(() => {
    const id = setInterval(() => {
      void fetchTimer()
      if (timer && !timer.isPaused) void sendPing()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [fetchTimer, sendPing, timer])

  useEffect(() => {
    if (!timer || timer.isPaused) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [timer])

  // Lazy-load requests the first time the user opens the picker.
  useEffect(() => {
    if (!pickerOpen || requests.length > 0 || requestsLoading) return
    setRequestsLoading(true)
    fetch(apiPath('/api/admin/requests?status=active'))
      .then(r => r.json() as Promise<{ requests: Array<{ id: string; title: string; orgName: string | null; requestNumber: number | null }> }>)
      .then(d => setRequests(d.requests ?? []))
      .catch(() => setRequests([]))
      .finally(() => setRequestsLoading(false))
  }, [pickerOpen, requests.length, requestsLoading])

  // Close either popover if the other opens, so we don't get stacked.
  useEffect(() => { if (pickerOpen) setControlsOpen(false) }, [pickerOpen])
  useEffect(() => { if (controlsOpen) setPickerOpen(false) }, [controlsOpen])

  // --- actions -------------------------------------------------------------

  async function startOnRequest(requestId: string, confirmed = false) {
    setActing(true)
    try {
      const url = confirmed ? apiPath('/api/admin/timers?confirmed=true') : apiPath('/api/admin/timers')
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      if (res.status === 409) {
        // If there's already a timer running, just tell the user to stop
        // it first. Keeping this simple for the nav case — the per-request
        // page has the full "switch" flow.
        const j = await res.json().catch(() => ({})) as { currentTimer?: { requestId?: string } }
        showToast(j.currentTimer?.requestId ? 'Stop the active timer first' : 'A timer is already running')
      } else if (res.ok) {
        await fetchTimer()
        setPickerOpen(false)
        setPickerQuery('')
        showToast('Timer started')
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? `Couldn't start timer (${res.status})`)
      }
    } catch {
      showToast('Network error — timer not started')
    } finally {
      setActing(false)
    }
  }

  async function pauseOrResume() {
    if (!timer || acting) return
    setActing(true)
    try {
      const action = timer.isPaused ? 'resume' : 'pause'
      const res = await fetch(apiPath(`/api/admin/timers/${timer.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        await fetchTimer()
        showToast(timer.isPaused ? 'Timer resumed' : 'Timer paused')
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Timer action failed')
      }
    } catch {
      showToast('Network error — try again')
    } finally {
      setActing(false)
      setControlsOpen(false)
    }
  }

  async function stop(action: 'log' | 'discard' = 'log') {
    if (!timer || acting) return
    setActing(true)
    try {
      const res = await fetch(apiPath(`/api/admin/timers/${timer.id}?action=${action}`), {
        method: 'DELETE',
      })
      if (res.ok) {
        const data = await res.json() as { logged?: boolean; hours?: number; reason?: string }
        setTimer(null)
        setStaleTimer(null)
        if (action === 'log' && data.logged && typeof data.hours === 'number') {
          const pretty = data.hours >= 0.01 ? `${data.hours.toFixed(2)}h` : `${Math.round((data.hours ?? 0) * 3600)}s`
          showToast(`Timer stopped — ${pretty} logged`)
        } else if (action === 'log' && data.reason) {
          showToast(`Stopped — not logged (${data.reason})`)
        } else {
          showToast(action === 'discard' ? 'Timer discarded' : 'Timer stopped')
        }
      }
    } finally {
      setActing(false)
      setControlsOpen(false)
    }
  }

  if (!loaded) {
    // Render a placeholder so the nav doesn't jump when the chip appears.
    return (
      <button
        disabled
        aria-label="Timer loading"
        style={{
          width: '2.25rem',
          height: '2.25rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-button)',
          background: 'transparent',
          border: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-subtle)',
          cursor: 'wait',
        }}
      >
        <Clock3 size={14} aria-hidden="true" />
      </button>
    )
  }

  const isPaused = !!timer?.isPaused

  // Derive displayed elapsed from startedAt (server truth) + the `tick`
  // pulse for re-render. Prevents drift.
  void tick
  const now = Date.now()
  let seconds = 0
  if (timer) {
    const startedMs = new Date(timer.startedAt).getTime()
    const pausedMs = timer.pausedAt ? new Date(timer.pausedAt).getTime() : now
    const rawMs = pausedMs - startedMs - (timer.pausedSeconds ?? 0) * 1000
    seconds = Math.max(0, Math.floor(rawMs / 1000))
  }

  // ── Idle ── Play button that opens the request picker.
  if (!timer) {
    return (
      <>
        <button
          ref={triggerRef}
          onClick={() => setPickerOpen(v => !v)}
          className="flex items-center transition-colors"
          style={{
            gap: '0.375rem',
            padding: '0.3125rem 0.625rem',
            borderRadius: 'var(--radius-button)',
            background: 'transparent',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-muted)',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
            minHeight: '2rem',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-brand-50)'
            e.currentTarget.style.color = 'var(--color-brand-dark)'
            e.currentTarget.style.borderColor = 'var(--color-brand-100)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
          }}
          aria-expanded={pickerOpen}
          aria-label="Start timer"
          title="Start a timer"
        >
          <Play size={12} aria-hidden="true" />
          <span className="hidden sm:inline">Track time</span>
        </button>

        <Popover
          anchorRef={triggerRef}
          open={pickerOpen}
          onClose={() => { setPickerOpen(false); setPickerQuery('') }}
          width="18rem"
          align="end"
          maxHeight="24rem"
        >
          <RequestPicker
            requests={requests}
            loading={requestsLoading}
            query={pickerQuery}
            setQuery={setPickerQuery}
            onPick={id => void startOnRequest(id)}
            acting={acting}
          />
        </Popover>
      </>
    )
  }

  // ── Active ── Pulse + elapsed; click opens the control menu.
  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setControlsOpen(v => !v)}
        className="flex items-center transition-colors"
        style={{
          gap: '0.375rem',
          padding: '0.3125rem 0.625rem',
          borderRadius: 'var(--radius-button)',
          background: isPaused ? 'var(--color-bg-secondary)' : 'var(--color-brand-50)',
          border: `1px solid ${isPaused ? 'var(--color-border)' : 'var(--color-brand-100)'}`,
          color: isPaused ? 'var(--color-text-muted)' : 'var(--color-brand-dark)',
          fontSize: '0.75rem',
          fontWeight: 600,
          cursor: 'pointer',
          minHeight: '2rem',
        }}
        aria-expanded={controlsOpen}
        aria-label={`Active timer ${formatElapsed(seconds)} ${isPaused ? 'paused' : 'running'}`}
      >
        {isPaused
          ? <Pause size={12} aria-hidden="true" />
          : <span
              aria-hidden="true"
              className="animate-pulse"
              style={{
                width: '0.5rem', height: '0.5rem', borderRadius: '50%',
                background: 'var(--color-brand)',
              }}
            />}
        <span className="hidden sm:inline font-mono tabular-nums">{formatElapsed(seconds)}</span>
        <ChevronDown size={10} aria-hidden="true" className="hidden sm:inline-block" />
      </button>

      <Popover
        anchorRef={triggerRef}
        open={controlsOpen}
        onClose={() => setControlsOpen(false)}
        width="16rem"
        align="end"
      >
        {/* Target */}
        <div
          style={{
            padding: '0.625rem 0.875rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <p
            style={{
              fontSize: '0.625rem',
              fontWeight: 600,
              color: 'var(--color-text-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              margin: 0,
            }}
          >
            Tracking
          </p>
          <div className="flex items-center" style={{ gap: '0.375rem', marginTop: '0.125rem' }}>
            <span
              className="truncate"
              style={{ fontSize: '0.8125rem', color: 'var(--color-text)', flex: 1, minWidth: 0, fontWeight: 500 }}
            >
              {timer.targetTitle ?? 'Untitled'}
            </span>
            {timer.requestId && (
              <Link
                href={`/requests/${timer.requestId}`}
                onClick={() => setControlsOpen(false)}
                aria-label="Open request"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1.25rem',
                  height: '1.25rem',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-subtle)',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
              >
                <ExternalLink size={12} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>

        {/* Big live time */}
        <div style={{ padding: '0.625rem 0.875rem 0', textAlign: 'center' }}>
          <span
            className="font-mono tabular-nums"
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: isPaused ? 'var(--color-text-muted)' : 'var(--color-brand-dark)',
              letterSpacing: '0.02em',
            }}
          >
            {formatElapsed(seconds)}
          </span>
        </div>

        {/* Actions */}
        <div style={{ padding: '0.375rem' }}>
          <MenuItem
            icon={isPaused ? <Play size={13} /> : <Pause size={13} />}
            label={isPaused ? 'Resume timer' : 'Pause timer'}
            onClick={pauseOrResume}
            disabled={acting}
          />
          <MenuItem
            icon={<Square size={13} />}
            label="Stop & log time"
            onClick={() => void stop('log')}
            disabled={acting}
          />
          <MenuItem
            icon={<Clock3 size={13} />}
            label="Discard (don't log)"
            onClick={() => void stop('discard')}
            disabled={acting}
            tone="danger"
          />
        </div>
      </Popover>

      {/* Stale-timer recovery prompt */}
      {staleTimer && timer && timer.id === staleTimer.id && (
        <ConfirmDialog
          open
          title="Was your timer still running?"
          description={`Your timer on "${staleTimer.targetTitle ?? 'this item'}" hasn't heartbeated for a while — your laptop may have slept or the tab was closed. Log the time up to when it went stale, or keep it running from now.`}
          confirmLabel="Log & stop"
          cancelLabel="Keep running"
          variant="warning"
          onConfirm={() => {
            void stop('log')
            setStaleTimer(null)
          }}
          onCancel={() => setStaleTimer(null)}
        />
      )}
    </>
  )
}

function RequestPicker({
  requests,
  loading,
  query,
  setQuery,
  onPick,
  acting,
}: {
  requests: RequestOption[]
  loading: boolean
  query: string
  setQuery: (v: string) => void
  onPick: (id: string) => void
  acting: boolean
}) {
  const filtered = requests.filter(r => {
    const q = query.toLowerCase().trim()
    if (!q) return true
    return r.title.toLowerCase().includes(q)
      || (r.orgName?.toLowerCase().includes(q) ?? false)
      || (r.requestNumber != null && String(r.requestNumber).includes(q))
  })
  return (
    <>
      <div
        style={{
          padding: '0.5rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <div
          className="flex items-center"
          style={{
            gap: '0.375rem',
            padding: '0.375rem 0.5rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <Search size={12} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search requests…"
            autoFocus
            style={{
              flex: 1, minWidth: 0,
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: '0.75rem',
              color: 'var(--color-text)',
            }}
          />
        </div>
      </div>

      <div role="list" style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <p style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)', textAlign: 'center', margin: 0 }}>
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)', textAlign: 'center', margin: 0 }}>
            {query ? 'No matches.' : 'No active requests.'}
          </p>
        ) : (
          filtered.slice(0, 40).map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              disabled={acting}
              className="flex items-center w-full transition-colors"
              style={{
                gap: '0.5rem',
                padding: '0.4375rem 0.625rem',
                fontSize: '0.75rem',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--color-border-subtle)',
                cursor: acting ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                color: 'var(--color-text)',
              }}
              onMouseEnter={e => { if (!acting) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <Play
                size={11}
                aria-hidden="true"
                style={{ color: 'var(--color-brand)', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="truncate" style={{ fontWeight: 500 }}>
                  {r.requestNumber != null && (
                    <span
                      className="font-mono"
                      style={{ color: 'var(--color-text-subtle)', marginRight: '0.3125rem', fontWeight: 400 }}
                    >
                      #{String(r.requestNumber).padStart(3, '0')}
                    </span>
                  )}
                  {r.title}
                </div>
                {r.orgName && (
                  <div
                    className="truncate"
                    style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}
                  >
                    {r.orgName}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'neutral' | 'danger'
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center w-full transition-colors"
      style={{
        gap: '0.5rem',
        padding: '0.4375rem 0.625rem',
        fontSize: '0.8125rem',
        color: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
      }}
      onMouseEnter={e => {
        if (!disabled) e.currentTarget.style.background = tone === 'danger' ? 'var(--color-danger-bg)' : 'var(--color-bg-secondary)'
      }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {disabled ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span>}
      {label}
    </button>
  )
}
