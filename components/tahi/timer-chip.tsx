'use client'

/**
 * <TimerChip> — global nav chip showing the current user's active timer.
 *
 * Responsibilities:
 *   - Fetch the active timer on mount, poll every 30s. The 30s poll doubles
 *     as the heartbeat (a GET implicitly keeps the session alive; we also
 *     send a dedicated POST /timers/ping so lastPingAt reliably updates).
 *   - Display HH:MM:SS that ticks every second between polls so the UI
 *     feels live without hammering the API.
 *   - Menu with Pause / Resume / Stop + open-timed-target shortcut.
 *   - Auto-recovery: if the initial fetch returns a stale timer (lastPingAt
 *     older than 2 minutes), prompt the user "log N hours and stop?" before
 *     starting to tick again.
 *
 * The chip renders nothing when no timer is active — zero-state is absence
 * of the chip. A TimerStartButton sibling (not this file) is where a user
 * starts a new timer.
 *
 * Admin-only. Clients never see a timer chip.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Play, Pause, Square, Loader2, Clock3, ChevronDown, ExternalLink } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { formatElapsed, isStaleTimer } from '@/lib/timer-helpers'
import { useToast } from '@/components/tahi/toast'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'

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

const POLL_MS = 30_000

export function TimerChip() {
  const [timer, setTimer] = useState<ActiveTimerResponse['timer']>(null)
  const [loaded, setLoaded] = useState(false)
  const [tick, setTick] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const [staleTimer, setStaleTimer] = useState<ActiveTimerResponse['timer']>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  // --- fetch + heartbeat ---------------------------------------------------

  const fetchTimer = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/timers'))
      if (!res.ok) return
      const data = await res.json() as ActiveTimerResponse
      // Detect stale timer on first load only — we don't want to re-prompt
      // mid-session if a poll happens to land right after suspension.
      if (!loaded && data.timer && isStaleTimer(data.timer.lastPingAt)) {
        setStaleTimer(data.timer)
        // Still set timer so if the user dismisses, the ticker shows the
        // current live elapsed. If they confirm stop, we clear it.
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

  // 30s poll doubles as heartbeat.
  useEffect(() => {
    const id = setInterval(() => {
      void fetchTimer()
      if (timer && !timer.isPaused) void sendPing()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [fetchTimer, sendPing, timer])

  // 1s live tick while active (paused timers shouldn't count up).
  useEffect(() => {
    if (!timer || timer.isPaused) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [timer])

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  // --- actions -------------------------------------------------------------

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
      }
    } finally {
      setActing(false)
      setMenuOpen(false)
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
        const data = await res.json() as { logged?: boolean; hours?: number }
        setTimer(null)
        setStaleTimer(null)
        if (action === 'log' && data.logged && typeof data.hours === 'number') {
          showToast(`Timer stopped — ${data.hours}h logged`)
        } else {
          showToast(action === 'discard' ? 'Timer discarded' : 'Timer stopped')
        }
      }
    } finally {
      setActing(false)
      setMenuOpen(false)
    }
  }

  if (!loaded || !timer) {
    return null
  }

  // Derive displayed elapsed. Compute from startedAt so the counter never
  // drifts away from server truth, and use `tick` as a React re-render pulse.
  void tick
  const now = Date.now()
  const startedMs = new Date(timer.startedAt).getTime()
  const pausedMs = timer.pausedAt ? new Date(timer.pausedAt).getTime() : now
  const rawMs = pausedMs - startedMs - (timer.pausedSeconds ?? 0) * 1000
  const seconds = Math.max(0, Math.floor(rawMs / 1000))

  const isPaused = timer.isPaused

  return (
    <>
      <div ref={anchorRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => setMenuOpen(v => !v)}
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
          aria-expanded={menuOpen}
          aria-label={`Active timer ${formatElapsed(seconds)} ${isPaused ? 'paused' : 'running'}. Open menu.`}
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
          <span className="font-mono tabular-nums">{formatElapsed(seconds)}</span>
          <ChevronDown size={10} aria-hidden="true" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 0.375rem)',
              right: 0,
              zIndex: 70,
              minWidth: '16rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-md)',
              overflow: 'hidden',
            }}
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
                    onClick={() => setMenuOpen(false)}
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
          </div>
        )}

        {/* Inline spinner while actioning */}
        {acting && (
          <Loader2 size={12} className="animate-spin" style={{ marginLeft: '0.375rem', color: 'var(--color-text-subtle)' }} />
        )}
      </div>

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
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span>
      {label}
    </button>
  )
}
