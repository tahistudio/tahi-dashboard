'use client'

/**
 * <TimerChip>. Always-present time-tracker control in the admin top-nav.
 *
 * Re-skinned to the "Tahi App Shell" forest design: a single relative `.tt`
 * root holding the pill and an absolutely-positioned `.tt-panel` child. No
 * shared Popover; outside-click + Escape are handled locally.
 *
 * Two states in one pill:
 *
 *   Idle:    Clock icon + "Track time". Click -> opens the panel with a
 *            searchable picker across Requests / Tasks / Clients. Picking a
 *            row POSTs /api/admin/timers and the chip flips to active.
 *   Active:  Pulsing dot (.tt-dot) + HH:MM:SS + target. Click -> opens the
 *            panel readout with Pause/Resume, Stop & log, Discard, and a
 *            jump-to-request link.
 *
 * Heartbeats POST /api/admin/timers/ping every 30s while active. Polls
 * GET /api/admin/timers every 30s so the chip resyncs with the server
 * (catches pauses from another tab, stop from the request page, etc.).
 *
 * On first load, if the active timer's lastPingAt is > 2 minutes old we
 * prompt the user to log or discard. Covers laptop-sleep gaps.
 *
 * Admin-only. Clients never see this.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, Inbox, CheckSquare, Users } from 'lucide-react'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { apiPath } from '@/lib/api'
import { formatElapsed, isStaleTimer } from '@/lib/timer-helpers'
import { notifyTimerChanged, subscribeToTimerChanges } from '@/lib/timer-events'
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

interface RequestOption {
  id: string
  title: string
  orgName: string | null
  requestNumber: number | null
}

interface TaskOption {
  id: string
  title: string
  orgName: string | null
}

interface ClientOption {
  id: string
  name: string
}

type TimerSource = 'request' | 'task' | 'client'

const POLL_MS = 30_000

function prettyHoursShort(h: number | undefined): string {
  if (!h || h <= 0) return '0m'
  if (h >= 1) return `${h.toFixed(h % 1 === 0 ? 0 : 2)}h`
  const minutes = Math.round(h * 60)
  if (minutes >= 1) return `${minutes}m`
  return `${Math.round(h * 3600)}s`
}

export function TimerChip() {
  const [timer, setTimer] = useState<ActiveTimerResponse['timer']>(null)
  const [loaded, setLoaded] = useState(false)
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const [staleTimer, setStaleTimer] = useState<ActiveTimerResponse['timer']>(null)

  const [requests, setRequests] = useState<RequestOption[]>([])
  const [tasks, setTasks] = useState<TaskOption[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [clientsLoading, setClientsLoading] = useState(false)
  const [pickerSource, setPickerSource] = useState<TimerSource>('request')
  const [pickerQuery, setPickerQuery] = useState('')

  const rootRef = useRef<HTMLDivElement>(null)
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
      // silent: offline / transient
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

  // Other components (per-request TimeCard etc.) broadcast a custom event
  // when they mutate the timer; we re-fetch immediately instead of waiting
  // for the 30s poll so the nav stays accurate.
  useEffect(() => subscribeToTimerChanges(() => { void fetchTimer() }), [fetchTimer])

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

  // Outside-click + Escape close the panel (replaces the shared Popover).
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Clear the picker query whenever the panel closes.
  useEffect(() => { if (!open) setPickerQuery('') }, [open])

  // Lazy-load each source list the first time its tab is activated while the
  // picker (idle panel) is open. Track which lists we've already tried to load
  // so an empty server response doesn't cause an infinite re-fetch loop (the
  // "fetch me" condition length === 0 && !loading would otherwise stay true
  // after an empty result).
  const fetchedRef = useRef({ request: false, task: false, client: false })

  useEffect(() => {
    if (!open || timer) return
    if (pickerSource === 'request' && !fetchedRef.current.request && !requestsLoading) {
      fetchedRef.current.request = true
      setRequestsLoading(true)
      fetch(apiPath('/api/admin/requests?status=active'))
        .then(r => r.json() as Promise<{ requests: RequestOption[] }>)
        .then(d => setRequests(d.requests ?? []))
        .catch(() => setRequests([]))
        .finally(() => setRequestsLoading(false))
    } else if (pickerSource === 'task' && !fetchedRef.current.task && !tasksLoading) {
      fetchedRef.current.task = true
      setTasksLoading(true)
      fetch(apiPath('/api/admin/tasks?status=all'))
        .then(r => r.json() as Promise<{ items: TaskOption[] }>)
        .then(d => setTasks(d.items ?? []))
        .catch(() => setTasks([]))
        .finally(() => setTasksLoading(false))
    } else if (pickerSource === 'client' && !fetchedRef.current.client && !clientsLoading) {
      fetchedRef.current.client = true
      setClientsLoading(true)
      fetch(apiPath('/api/admin/clients?status=active'))
        .then(r => r.json() as Promise<{ organisations: Array<{ id: string; name: string }> }>)
        .then(d => setClients((d.organisations ?? []).map(o => ({ id: o.id, name: o.name }))))
        .catch(() => setClients([]))
        .finally(() => setClientsLoading(false))
    }
  }, [open, timer, pickerSource, requestsLoading, tasksLoading, clientsLoading])

  // --- actions -------------------------------------------------------------

  async function startTimer(source: TimerSource, id: string, confirmed = false) {
    setActing(true)
    try {
      const url = confirmed ? apiPath('/api/admin/timers?confirmed=true') : apiPath('/api/admin/timers')
      const body =
        source === 'request' ? { requestId: id } :
        source === 'task' ? { taskId: id } :
        { orgId: id }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        // If there's already a timer running, just tell the user to stop
        // it first. Keeping this simple for the nav case; the per-request
        // page has the full "switch" flow.
        const j = await res.json().catch(() => ({})) as { currentTimer?: { requestId?: string } }
        showToast(
          j.currentTimer?.requestId ? 'Stop the active timer first' : 'A timer is already running',
          'warning',
        )
      } else if (res.ok) {
        await fetchTimer()
        notifyTimerChanged()
        setOpen(false)
        setPickerQuery('')
        showToast('Timer started', 'success')
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? `Couldn't start timer (${res.status})`, 'error')
      }
    } catch {
      showToast('Network error. Timer not started.', 'error')
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
        notifyTimerChanged()
        showToast(timer.isPaused ? 'Timer resumed' : 'Timer paused', 'success')
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Timer action failed', 'error')
      }
    } catch {
      showToast('Network error. Try again.', 'error')
    } finally {
      setActing(false)
      setOpen(false)
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
        notifyTimerChanged()
        if (action === 'log' && data.logged && typeof data.hours === 'number') {
          showToast(`Timer stopped. ${prettyHoursShort(data.hours)} logged.`, 'success')
        } else if (action === 'log' && data.reason) {
          showToast(`Stopped. Not logged (${data.reason}).`, 'warning')
        } else {
          showToast(action === 'discard' ? 'Timer discarded' : 'Timer stopped', 'success')
        }
      }
    } finally {
      setActing(false)
      setOpen(false)
    }
  }

  // Pre-hydration placeholder. Matches the idle pill geometry so the nav
  // doesn't jump when state arrives.
  if (!loaded) {
    return (
      <div className="tt" data-status="idle">
        <button type="button" className="tt-pill" disabled aria-label="Timer loading">
          <span className="tt-ic"><ShellIcon n="clock" s={16} /></span>
          <span className="tt-lbl">Track time</span>
          <span className="tt-chev"><ShellIcon n="chevron" s={12} /></span>
        </button>
      </div>
    )
  }

  const status: 'idle' | 'running' | 'paused' = !timer ? 'idle' : timer.isPaused ? 'paused' : 'running'
  const active = !!timer
  const running = status === 'running'
  const paused = status === 'paused'

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
  const elapsed = formatElapsed(seconds)
  const targetTitle = timer?.targetTitle ?? 'Untitled'

  return (
    <div
      ref={rootRef}
      className={'tt' + (open ? ' open' : '') + (active ? ' active' : '')}
      data-status={status}
    >
      <button
        type="button"
        className="tt-pill"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={active ? `Active timer ${elapsed} ${running ? 'running' : 'paused'}` : 'Track time'}
      >
        <span className="tt-ic">
          {active ? <span className="tt-dot" aria-hidden="true" /> : <ShellIcon n="clock" s={16} />}
        </span>
        {active ? (
          <span className="tt-live">
            <span className="tt-time">{elapsed}</span>
            <span className="tt-tgt">{targetTitle}</span>
          </span>
        ) : (
          <span className="tt-lbl">Track time</span>
        )}
        <span className="tt-chev"><ShellIcon n="chevron" s={12} /></span>
      </button>

      {open && (
        <div className="tt-panel">
          <div className="tt-head">Time tracker</div>

          {!active ? (
            <SourcePicker
              source={pickerSource}
              setSource={s => { setPickerSource(s); setPickerQuery('') }}
              requests={requests}
              tasks={tasks}
              clients={clients}
              loading={
                pickerSource === 'request' ? requestsLoading :
                pickerSource === 'task' ? tasksLoading : clientsLoading
              }
              query={pickerQuery}
              setQuery={setPickerQuery}
              onPick={id => void startTimer(pickerSource, id)}
              acting={acting}
            />
          ) : (
            <>
              <div className="tt-readout">
                <span className="tt-big">{elapsed}</span>
                <span className="tt-sub">{`${running ? 'Running' : 'Paused'} . ${targetTitle}`}</span>
              </div>

              <div className="tt-ctrls">
                {running && (
                  <button type="button" className="tt-btn" onClick={() => void pauseOrResume()} disabled={acting}>
                    {acting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ShellIcon n="pause" s={14} />} Pause
                  </button>
                )}
                {paused && (
                  <button type="button" className="tt-btn tt-start" onClick={() => void pauseOrResume()} disabled={acting}>
                    {acting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ShellIcon n="play" s={14} />} Resume
                  </button>
                )}
                <button type="button" className="tt-btn tt-stop" onClick={() => void stop('log')} disabled={acting}>
                  <ShellIcon n="square" s={12} /> Stop
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: timer?.requestId ? 'space-between' : 'flex-end',
                  gap: '0.5rem',
                }}
              >
                {timer?.requestId && (
                  <Link
                    href={`/requests/${timer.requestId}`}
                    onClick={() => setOpen(false)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3125rem',
                      font: '600 11.5px Manrope, sans-serif',
                      color: 'var(--text-muted)',
                      textDecoration: 'none',
                      padding: '0.25rem 0.375rem',
                      borderRadius: '6px',
                      transition: 'color 0.14s, background 0.14s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = 'var(--brand-strong)'
                      e.currentTarget.style.background = 'var(--bg-secondary)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'var(--text-muted)'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <ExternalLink size={12} aria-hidden="true" /> Open request
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void stop('discard')}
                  disabled={acting}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: acting ? 'not-allowed' : 'pointer',
                    font: '600 11.5px Manrope, sans-serif',
                    color: 'var(--text-faint)',
                    padding: '0.25rem 0.375rem',
                    borderRadius: '6px',
                    opacity: acting ? 0.5 : 1,
                    transition: 'color 0.14s, background 0.14s',
                  }}
                  onMouseEnter={e => { if (!acting) e.currentTarget.style.color = 'var(--text-muted)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-faint)' }}
                >
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Stale-timer recovery prompt */}
      {staleTimer && timer && timer.id === staleTimer.id && (
        <ConfirmDialog
          open
          title="Was your timer still running?"
          description={`Your timer on "${staleTimer.targetTitle ?? 'this item'}" hasn't heartbeated for a while. Your laptop may have slept or the tab was closed. Log the time up to when it went stale, or keep it running from now.`}
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
    </div>
  )
}

/**
 * Three-source picker: Request | Task | Client. Common search bar across all
 * three; tab swap clears the query. Each tab shows up to 40 results so the
 * panel never grows unbounded. Re-skinned to the app-shell tt-* classes.
 */
function SourcePicker({
  source,
  setSource,
  requests,
  tasks,
  clients,
  loading,
  query,
  setQuery,
  onPick,
  acting,
}: {
  source: TimerSource
  setSource: (s: TimerSource) => void
  requests: RequestOption[]
  tasks: TaskOption[]
  clients: ClientOption[]
  loading: boolean
  query: string
  setQuery: (v: string) => void
  onPick: (id: string) => void
  acting: boolean
}) {
  const q = query.toLowerCase().trim()

  // Normalise the active list into a common shape so we can render once.
  let items: Array<{ id: string; label: string; sub?: string; mono?: string }> = []
  if (source === 'request') {
    items = requests
      .filter(r => !q
        || r.title.toLowerCase().includes(q)
        || (r.orgName?.toLowerCase().includes(q) ?? false)
        || (r.requestNumber != null && String(r.requestNumber).includes(q)))
      .map(r => ({
        id: r.id,
        label: r.title,
        sub: r.orgName ?? undefined,
        mono: r.requestNumber != null ? `#${String(r.requestNumber).padStart(3, '0')}` : undefined,
      }))
  } else if (source === 'task') {
    items = tasks
      .filter(t => !q
        || t.title.toLowerCase().includes(q)
        || (t.orgName?.toLowerCase().includes(q) ?? false))
      .map(t => ({ id: t.id, label: t.title, sub: t.orgName ?? 'Internal' }))
  } else {
    items = clients
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .map(c => ({ id: c.id, label: c.name }))
  }

  const SourceIcon = source === 'request' ? Inbox : source === 'task' ? CheckSquare : Users

  const emptyTitle = q
    ? 'No matches'
    : source === 'request' ? 'No open requests'
    : source === 'task' ? 'No open tasks'
    : 'No active clients'
  const emptyDesc = q
    ? 'Try a shorter search.'
    : source === 'request' ? 'Track time from a request once one is open.'
    : source === 'task' ? 'Pick up a task to time work against it.'
    : 'Track miscellaneous time against a client.'

  return (
    <>
      {/* Source tabs. No dedicated app-shell class exists for this control, so
          it's composed from the shell CSS vars (no new hardcoded hex). */}
      <div role="tablist" aria-label="Track time source" style={{ display: 'flex', gap: '0.25rem' }}>
        {(['request', 'task', 'client'] as const).map(s => {
          const Icon = s === 'request' ? Inbox : s === 'task' ? CheckSquare : Users
          const on = source === s
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSource(s)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3125rem',
                padding: '0.375rem 0.25rem',
                borderRadius: '8px',
                cursor: 'pointer',
                border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
                background: on ? 'var(--brand-100)' : 'var(--bg)',
                color: on ? 'var(--brand-strong)' : 'var(--text-muted)',
                font: `${on ? 700 : 600} 11.5px Manrope, sans-serif`,
                transition: 'background 0.14s, color 0.14s, border-color 0.14s',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg-secondary)' }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'var(--bg)' }}
            >
              <Icon size={13} aria-hidden="true" />
              {s === 'request' ? 'Requests' : s === 'task' ? 'Tasks' : 'Clients'}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="tt-search">
        <ShellIcon n="search" s={15} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={source === 'request' ? 'Search requests' : source === 'task' ? 'Search tasks' : 'Search clients'}
          aria-label="Search to track time on"
          autoFocus
        />
      </div>

      {/* Results */}
      <div className="tt-list" role="list">
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '1.25rem 0.5rem',
              color: 'var(--text-faint)',
              font: '500 12px Manrope, sans-serif',
            }}
          >
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading
          </div>
        ) : items.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '0.25rem',
              padding: '1.25rem 0.75rem',
              color: 'var(--text-muted)',
            }}
          >
            <SourceIcon size={18} aria-hidden="true" style={{ color: 'var(--text-faint)', marginBottom: '0.25rem' }} />
            <span style={{ font: '600 12.5px Manrope, sans-serif', color: 'var(--text)' }}>{emptyTitle}</span>
            <span style={{ font: '500 11.5px Manrope, sans-serif', color: 'var(--text-faint)' }}>{emptyDesc}</span>
          </div>
        ) : (
          items.slice(0, 40).map(item => (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className="tt-opt"
              onClick={() => onPick(item.id)}
              disabled={acting}
              style={{ cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}
            >
              <span className="tt-ic" style={{ flexShrink: 0 }}>
                <SourceIcon size={14} aria-hidden="true" />
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span className="tt-opt-t">
                  {item.mono && (
                    <span style={{ color: 'var(--text-faint)', marginRight: '0.3125rem', fontWeight: 500 }}>
                      {item.mono}
                    </span>
                  )}
                  {item.label}
                </span>
                {item.sub && (
                  <span
                    style={{
                      font: '500 10.5px Manrope, sans-serif',
                      color: 'var(--text-faint)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.sub}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  )
}
