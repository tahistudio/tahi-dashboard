'use client'

/**
 * <RequestTimerControl> — compact sidebar card on a request detail page
 * for starting / pausing / stopping a live timer on THIS request.
 *
 * States:
 *   - No active timer anywhere → "Start timer" button
 *   - Active timer on this request → live HH:MM:SS + Pause + Stop
 *   - Active timer on a different target → "Timer running on X → Switch"
 *
 * Backend: /api/admin/timers (GET/POST), /api/admin/timers/[id]
 * (PATCH pause/resume, DELETE log/discard). Admins only.
 */

import { useCallback, useEffect, useState } from 'react'
import { Play, Pause, Square, ArrowRightLeft, Loader2 } from 'lucide-react'
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

interface Props {
  requestId: string
}

export function RequestTimerControl({ requestId }: Props) {
  const [timer, setTimer] = useState<ActiveTimer | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [acting, setActing] = useState(false)
  const [switchConfirm, setSwitchConfirm] = useState(false)
  const [tick, setTick] = useState(0)
  const { showToast } = useToast()

  const fetchTimer = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/timers'))
      if (res.ok) {
        const data = await res.json() as { timer: ActiveTimer | null }
        setTimer(data.timer)
      }
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void fetchTimer() }, [fetchTimer])

  // Keep the live counter moving even while we wait between polls.
  useEffect(() => {
    if (!timer || timer.isPaused || timer.requestId !== requestId) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [timer, requestId])

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
      }
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
      }
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
        const data = await res.json() as { hours?: number; logged?: boolean }
        setTimer(null)
        if (data.logged && typeof data.hours === 'number') {
          showToast(`Logged ${data.hours}h`)
        } else {
          showToast('Timer stopped')
        }
      }
    } finally {
      setActing(false)
    }
  }

  if (!loaded) return null

  // Active on this request
  const onThis = timer && timer.requestId === requestId
  const onOther = timer && timer.requestId !== requestId

  // derive elapsed seconds whenever tick changes
  void tick
  const now = Date.now()
  let seconds = 0
  if (onThis && timer) {
    const startedMs = new Date(timer.startedAt).getTime()
    const endMs = timer.pausedAt ? new Date(timer.pausedAt).getTime() : now
    seconds = Math.max(0, Math.floor((endMs - startedMs - (timer.pausedSeconds ?? 0) * 1000) / 1000))
  }

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <h3
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em', margin: 0 }}
        >
          Timer
        </h3>
      </div>

      <div style={{ padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {onThis ? (
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

      {switchConfirm && (
        <ConfirmDialog
          open
          title="Switch timer?"
          description="You have another timer running. Stop it, log the time, and start a new timer on this request?"
          confirmLabel="Stop other & start here"
          variant="warning"
          onConfirm={() => {
            setSwitchConfirm(false)
            void start(true)
          }}
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
