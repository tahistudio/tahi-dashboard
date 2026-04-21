'use client'

/**
 * <TimeCard> — unified time block on a request detail page.
 *
 * Three things in one card so the user has a single place to think about
 * time on this request:
 *
 *   1. Live timer controls (start / pause / stop / switch prompt).
 *   2. Manual log form (collapsed by default; opens on click).
 *   3. Total hours + a compact list of recent entries.
 *
 * All mutations are optimistic — we mutate local state immediately, fire
 * the server call, roll back + toast on error.
 *
 * Admin-only. Server enforces this too.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, ArrowRightLeft, Loader2, Plus, Clock } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { formatElapsed } from '@/lib/timer-helpers'
import { Card } from '@/components/tahi/card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useToast } from '@/components/tahi/toast'

interface ActiveTimer {
  id: string
  requestId: string | null
  taskId: string | null
  startedAt: string
  pausedAt: string | null
  pausedSeconds: number
  targetTitle: string | null
  isPaused: boolean
}

interface TimeEntry {
  id: string
  hours: number
  billable: boolean | null
  notes: string | null
  date: string
  teamMemberName: string | null
}

interface Props {
  requestId: string
}

export function TimeCard({ requestId }: Props) {
  const { showToast } = useToast()
  const [timer, setTimer] = useState<ActiveTimer | null>(null)
  const [timerLoaded, setTimerLoaded] = useState(false)
  const [acting, setActing] = useState(false)
  const [switchConfirm, setSwitchConfirm] = useState(false)

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [billable, setBillable] = useState(true)
  const [saving, setSaving] = useState(false)

  const [tick, setTick] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // --- fetch --------------------------------------------------------------

  const fetchTimer = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/timers'))
      if (res.ok) {
        const data = await res.json() as { timer: ActiveTimer | null }
        setTimer(data.timer)
      }
    } finally {
      setTimerLoaded(true)
    }
  }, [])

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/time-entries`))
      if (res.ok) {
        const data = await res.json() as { items: TimeEntry[] }
        setEntries(data.items ?? [])
      }
    } finally {
      setEntriesLoaded(true)
    }
  }, [requestId])

  useEffect(() => { void fetchTimer() }, [fetchTimer])
  useEffect(() => { void fetchEntries() }, [fetchEntries])

  // Live counter — only while the timer is on THIS request + not paused.
  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (!timer || timer.isPaused || timer.requestId !== requestId) return
    intervalRef.current = setInterval(() => setTick(t => t + 1), 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [timer, requestId])

  // --- timer actions ------------------------------------------------------

  async function start(confirmed = false) {
    setActing(true)
    try {
      const url = confirmed ? apiPath('/api/admin/timers?confirmed=true') : apiPath('/api/admin/timers')
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      if (res.status === 409) {
        setSwitchConfirm(true)
      } else if (res.ok) {
        await fetchTimer()
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

  async function pauseResume() {
    if (!timer) return
    setActing(true)
    try {
      const res = await fetch(apiPath(`/api/admin/timers/${timer.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: timer.isPaused ? 'resume' : 'pause' }),
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
    }
  }

  async function stop() {
    if (!timer) return
    setActing(true)
    try {
      const res = await fetch(apiPath(`/api/admin/timers/${timer.id}?action=log`), {
        method: 'DELETE',
      })
      if (res.ok) {
        const data = await res.json() as { hours?: number; logged?: boolean; reason?: string }
        setTimer(null)
        if (data.logged && typeof data.hours === 'number') {
          // Refresh entries so the new row appears in the list immediately.
          await fetchEntries()
          const pretty = data.hours >= 0.01 ? `${data.hours.toFixed(2)}h` : `${Math.round((data.hours ?? 0) * 3600)}s`
          showToast(`Logged ${pretty}`)
        } else if (data.reason) {
          showToast(`Timer stopped — not logged (${data.reason})`)
        } else {
          showToast('Timer stopped — not logged')
        }
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Couldn\'t stop timer')
      }
    } catch {
      showToast('Network error — try again')
    } finally {
      setActing(false)
    }
  }

  // --- manual log ---------------------------------------------------------

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault()
    const h = parseFloat(hours)
    if (!h || h <= 0) return
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/time-entries`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: h, description: notes.trim() || undefined, billable }),
      })
      if (res.ok) {
        setHours('')
        setNotes('')
        setBillable(true)
        setLogOpen(false)
        await fetchEntries()
        showToast(`Logged ${h}h manually`)
      } else {
        showToast('Failed to log time')
      }
    } catch {
      showToast('Network error — try again')
    } finally {
      setSaving(false)
    }
  }

  // --- derived ------------------------------------------------------------

  const onThis = timer && timer.requestId === requestId
  const onOther = timer && timer.requestId !== requestId

  void tick
  const now = Date.now()
  let seconds = 0
  if (onThis && timer) {
    const startedMs = new Date(timer.startedAt).getTime()
    const endMs = timer.pausedAt ? new Date(timer.pausedAt).getTime() : now
    seconds = Math.max(0, Math.floor((endMs - startedMs - (timer.pausedSeconds ?? 0) * 1000) / 1000))
  }

  const totalHours = entries.reduce((s, e) => s + e.hours, 0)

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h3
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em', margin: 0 }}
        >
          Time
        </h3>
        {entriesLoaded && totalHours > 0 && (
          <span className="font-mono tabular-nums" style={{ fontSize: '0.75rem', color: 'var(--color-text)', fontWeight: 600 }}>
            {totalHours.toFixed(1)}h logged
          </span>
        )}
      </div>

      {/* Timer row */}
      <div
        style={{
          padding: '0.875rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.625rem',
        }}
      >
        {!timerLoaded ? (
          <div style={{ height: '2.25rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }} />
        ) : onThis ? (
          <>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0.625rem 0.75rem',
                background: timer!.isPaused ? 'var(--color-bg-secondary)' : 'var(--color-brand-50)',
                border: `1px solid ${timer!.isPaused ? 'var(--color-border)' : 'var(--color-brand-100)'}`,
                borderRadius: 'var(--radius-md)',
                gap: '0.375rem',
              }}
            >
              {timer!.isPaused
                ? <Pause size={14} style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
                : <span
                    aria-hidden="true"
                    className="animate-pulse"
                    style={{
                      width: '0.5rem', height: '0.5rem', borderRadius: '50%',
                      background: 'var(--color-brand)',
                    }}
                  />
              }
              <span
                className="font-mono tabular-nums"
                style={{
                  fontSize: '1.125rem', fontWeight: 700,
                  color: timer!.isPaused ? 'var(--color-text-muted)' : 'var(--color-brand-dark)',
                  letterSpacing: '0.02em',
                }}
              >
                {formatElapsed(seconds)}
              </span>
            </div>
            <div className="flex items-center" style={{ gap: '0.375rem' }}>
              <ActionButton
                icon={timer!.isPaused ? <Play size={13} /> : <Pause size={13} />}
                label={timer!.isPaused ? 'Resume' : 'Pause'}
                onClick={pauseResume}
                disabled={acting}
              />
              <ActionButton
                icon={<Square size={13} />}
                label="Stop & log"
                onClick={stop}
                disabled={acting}
                variant="primary"
              />
            </div>
          </>
        ) : onOther ? (
          <>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.4 }}>
              Timer is running on
              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}> {timer!.targetTitle ?? 'another item'}</span>.
            </p>
            <ActionButton
              icon={<ArrowRightLeft size={13} />}
              label="Switch to this request"
              onClick={() => void start(false)}
              disabled={acting}
            />
          </>
        ) : (
          <ActionButton
            icon={acting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            label={acting ? 'Starting…' : 'Start timer'}
            onClick={() => void start(false)}
            disabled={acting}
            variant="primary"
          />
        )}
      </div>

      {/* Manual log + entries */}
      <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Entry list */}
        {entriesLoaded && entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            {entries.slice(0, 5).map(entry => (
              <div
                key={entry.id}
                className="flex items-center justify-between"
                style={{ fontSize: '0.75rem', padding: '0.1875rem 0' }}
              >
                <span
                  className="truncate"
                  style={{
                    color: 'var(--color-text-muted)',
                    flex: 1, minWidth: 0,
                    marginRight: '0.5rem',
                  }}
                  title={entry.notes ?? entry.teamMemberName ?? ''}
                >
                  {entry.teamMemberName ?? 'Unknown'}
                  {entry.notes && (
                    <span style={{ color: 'var(--color-text-subtle)' }}> — {entry.notes}</span>
                  )}
                </span>
                <span
                  className="font-mono tabular-nums font-medium"
                  style={{ color: 'var(--color-text)', flexShrink: 0 }}
                >
                  {entry.hours.toFixed(1)}h
                </span>
              </div>
            ))}
            {entries.length > 5 && (
              <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: '0.1875rem 0 0' }}>
                …and {entries.length - 5} more
              </p>
            )}
          </div>
        )}

        {entriesLoaded && entries.length === 0 && (
          <p
            className="flex items-center"
            style={{
              gap: '0.375rem',
              fontSize: '0.75rem',
              color: 'var(--color-text-subtle)',
              margin: 0,
            }}
          >
            <Clock size={12} aria-hidden="true" />
            No time logged yet.
          </p>
        )}

        {/* Manual log form — collapsed behind a small button */}
        {logOpen ? (
          <form onSubmit={handleLogSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.375rem' }}>
            <div className="flex items-center" style={{ gap: '0.375rem' }}>
              <input
                type="number"
                step="0.25"
                min="0"
                value={hours}
                onChange={e => setHours(e.target.value)}
                placeholder="Hours"
                autoFocus
                required
                style={{
                  width: '4.5rem',
                  padding: '0.3125rem 0.5rem',
                  fontSize: '0.75rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  outline: 'none',
                }}
              />
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="What did you work on?"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '0.3125rem 0.5rem',
                  fontSize: '0.75rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  outline: 'none',
                }}
              />
            </div>
            <div className="flex items-center justify-between" style={{ gap: '0.375rem' }}>
              <label className="flex items-center" style={{ gap: '0.3125rem', fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                <input
                  type="checkbox"
                  checked={billable}
                  onChange={e => setBillable(e.target.checked)}
                  style={{ accentColor: 'var(--color-brand)' }}
                />
                Billable
              </label>
              <div className="flex items-center" style={{ gap: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => { setLogOpen(false); setHours(''); setNotes(''); setBillable(true) }}
                  style={{
                    fontSize: '0.6875rem',
                    padding: '0.25rem 0.5rem',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !hours || parseFloat(hours) <= 0}
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    padding: '0.25rem 0.625rem',
                    border: 'none',
                    background: 'var(--color-brand)',
                    color: '#fff',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.6 : 1,
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {saving ? 'Saving…' : 'Log'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="inline-flex items-center transition-colors"
            style={{
              gap: '0.3125rem',
              padding: '0.3125rem 0.625rem',
              fontSize: '0.6875rem',
              fontWeight: 500,
              borderRadius: 'var(--radius-button)',
              border: '1px dashed var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              alignSelf: 'flex-start',
              marginTop: '0.25rem',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.color = 'var(--color-brand)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            <Plus size={11} aria-hidden="true" />
            Log time manually
          </button>
        )}
      </div>

      {switchConfirm && (
        <ConfirmDialog
          open
          title="Switch timer?"
          description="You have another timer running. Stop it, log the time, and start a new timer on this request?"
          confirmLabel="Stop other & start here"
          variant="warning"
          onConfirm={() => { setSwitchConfirm(false); void start(true) }}
          onCancel={() => setSwitchConfirm(false)}
        />
      )}
    </Card>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  variant = 'secondary',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}) {
  const isPrimary = variant === 'primary'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center flex-1 transition-colors"
      style={{
        gap: '0.375rem',
        padding: '0.4375rem 0.75rem',
        fontSize: '0.75rem',
        fontWeight: 500,
        borderRadius: 'var(--radius-button)',
        border: isPrimary ? 'none' : '1px solid var(--color-border)',
        background: isPrimary ? 'var(--color-brand)' : 'var(--color-bg)',
        color: isPrimary ? '#ffffff' : 'var(--color-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        minHeight: '2rem',
      }}
      onMouseEnter={e => {
        if (!disabled) {
          if (isPrimary) e.currentTarget.style.background = 'var(--color-brand-dark)'
          else {
            e.currentTarget.style.borderColor = 'var(--color-brand)'
            e.currentTarget.style.color = 'var(--color-brand-dark)'
          }
        }
      }}
      onMouseLeave={e => {
        if (isPrimary) e.currentTarget.style.background = 'var(--color-brand)'
        else {
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.color = 'var(--color-text)'
        }
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span>
      {label}
    </button>
  )
}
