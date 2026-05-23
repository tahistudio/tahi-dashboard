'use client'

/**
 * <TimerChip>. Always-present timer control in the admin top-nav.
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
 * we prompt the user to log or discard. Covers laptop-sleep gaps.
 *
 * Admin-only. Clients never see this.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Play, Pause, Square, Loader2, Clock3, ChevronDown, ExternalLink, Search,
  Inbox, CheckSquare, Users,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { formatElapsed, isStaleTimer } from '@/lib/timer-helpers'
import { notifyTimerChanged, subscribeToTimerChanges } from '@/lib/timer-events'
import { useToast } from '@/components/tahi/toast'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { Popover } from '@/components/tahi/popover'
import { EmptyState } from '@/components/tahi/empty-state'

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
  const [controlsOpen, setControlsOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
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

  // Lazy-load each source list the first time its tab is activated.
  // Track which lists we've already tried to load so an empty server
  // response doesn't cause an infinite re-fetch loop (the previous
  // version re-fired the effect every render because the "fetch me"
  // condition (length === 0 && !loading) stayed true after an empty
  // result).
  const fetchedRef = useRef({ request: false, task: false, client: false })

  useEffect(() => {
    if (!pickerOpen) return
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
  }, [pickerOpen, pickerSource, requestsLoading, tasksLoading, clientsLoading])

  // Close either popover if the other opens, so we don't get stacked.
  useEffect(() => { if (pickerOpen) setControlsOpen(false) }, [pickerOpen])
  useEffect(() => { if (controlsOpen) setPickerOpen(false) }, [controlsOpen])

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
        setPickerOpen(false)
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
      setControlsOpen(false)
    }
  }

  if (!loaded) {
    // Render a placeholder that matches the eventual "Track time"
    // chip's geometry so the nav doesn't jump when state arrives.
    return (
      <button
        disabled
        aria-label="Timer loading"
        className="flex items-center"
        style={{
          gap: '0.375rem',
          padding: '0.3125rem 0.625rem',
          borderRadius: 'var(--radius-button)',
          background: 'transparent',
          border: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-subtle)',
          fontSize: '0.75rem',
          fontWeight: 500,
          cursor: 'wait',
          minHeight: '2rem',
        }}
      >
        <Clock3 size={12} aria-hidden="true" className="animate-pulse" />
        <span className="hidden sm:inline">Track time</span>
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
            e.currentTarget.style.color = 'var(--color-text-active)'
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
          width="22rem"
          align="end"
          maxHeight="28rem"
        >
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
          // Active = brand-filled chip so the running timer stands
          // out from the rest of the nav. Paused = muted, clearly
          // "not currently counting".
          background: isPaused ? 'var(--color-bg-secondary)' : 'var(--color-brand)',
          border: `1px solid ${isPaused ? 'var(--color-border)' : 'var(--color-brand)'}`,
          color: isPaused ? 'var(--color-text-muted)' : '#ffffff',
          fontSize: '0.75rem',
          fontWeight: 600,
          cursor: 'pointer',
          minHeight: '2rem',
          boxShadow: isPaused ? 'none' : '0 1px 0 rgba(15, 20, 16, 0.16)',
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
                width: '0.4375rem', height: '0.4375rem', borderRadius: '50%',
                background: '#ffffff',
                boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.32)',
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
    </>
  )
}

/**
 * Three-tab picker: Request | Task | Client. Common search bar across all
 * three; tab swap clears the query. Each tab shows up to 40 results so the
 * popover never grows unbounded.
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

  return (
    <>
      {/* Header. Tiny label + tight segmented control. The label gives
          the popover a clear identity ("you're picking a target") and
          the segmented control is the brand pattern used elsewhere. */}
      <div
        style={{
          padding: '0.75rem 0.875rem 0.625rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <p
          style={{
            fontSize: '0.625rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-subtle)',
            margin: '0 0 0.4375rem',
          }}
        >
          Track time on
        </p>
        <div
          role="tablist"
          aria-label="Track time source"
          style={{
            display: 'flex',
            gap: '0.125rem',
            padding: '0.1875rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {(['request', 'task', 'client'] as const).map(s => {
            const Icon = s === 'request' ? Inbox : s === 'task' ? CheckSquare : Users
            const active = source === s
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSource(s)}
                className="flex items-center justify-center"
                style={{
                  flex: 1,
                  gap: '0.3125rem',
                  padding: '0.3125rem 0.5rem',
                  fontSize: '0.75rem',
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--color-text-active)' : 'var(--color-text-muted)',
                  background: active ? 'var(--color-brand-100)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'background-color 150ms ease, color 150ms ease',
                }}
                onMouseEnter={e => {
                  if (!active) e.currentTarget.style.background = 'var(--color-bg-secondary)'
                }}
                onMouseLeave={e => {
                  if (!active) e.currentTarget.style.background = 'transparent'
                }}
              >
                <Icon size={12} aria-hidden="true" />
                {s === 'request' ? 'Requests' : s === 'task' ? 'Tasks' : 'Clients'}
              </button>
            )
          })}
        </div>
      </div>

      {/* Search */}
      <div
        style={{
          padding: '0.625rem 0.875rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg)',
          flexShrink: 0,
        }}
      >
        <div
          className="tahi-input-group flex items-center"
          style={{
            gap: '0.4375rem',
            padding: '0 0.5rem',
            height: '2rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <Search size={13} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={source === 'request' ? 'Search requests' : source === 'task' ? 'Search tasks' : 'Search clients'}
            autoFocus
            style={{
              flex: 1, minWidth: 0,
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: '0.8125rem',
              color: 'var(--color-text)',
            }}
          />
        </div>
      </div>

      {/* Items */}
      <div role="list" style={{ overflowY: 'auto', flex: 1, padding: '0.25rem' }}>
        {loading ? (
          <div
            style={{
              padding: '1.5rem 0.75rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              color: 'var(--color-text-subtle)',
              fontSize: '0.75rem',
            }}
          >
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-brand)' }} aria-hidden="true" />
            Loading
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '0.5rem' }}>
            <EmptyState
              variant="inline"
              icon={<SourceIcon className="w-5 h-5" />}
              title={q
                ? 'No matches'
                : source === 'request' ? 'No open requests'
                : source === 'task' ? 'No open tasks'
                : 'No active clients'}
              description={q
                ? 'Try a shorter search.'
                : source === 'request' ? 'Track time straight from a request once one is open.'
                : source === 'task' ? 'Pick up a task to start timing work against it.'
                : 'Track miscellaneous time against a client when needed.'}
            />
          </div>
        ) : (
          items.slice(0, 40).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item.id)}
              disabled={acting}
              className="flex items-center w-full"
              style={{
                gap: '0.5rem',
                padding: '0.4375rem 0.5rem',
                fontSize: '0.8125rem',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: acting ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                color: 'var(--color-text)',
                transition: 'background-color 150ms ease',
              }}
              onMouseEnter={e => {
                if (acting) return
                e.currentTarget.style.background = 'var(--color-bg-secondary)'
                const tile = e.currentTarget.querySelector<HTMLElement>('[data-row-icon]')
                if (tile) {
                  tile.style.background = 'var(--color-brand-100)'
                  tile.style.color = 'var(--color-text-active)'
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                const tile = e.currentTarget.querySelector<HTMLElement>('[data-row-icon]')
                if (tile) {
                  tile.style.background = 'var(--color-bg-tertiary)'
                  tile.style.color = 'var(--color-text-muted)'
                }
              }}
            >
              <span
                data-row-icon
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1.5rem',
                  height: '1.5rem',
                  flexShrink: 0,
                  background: 'var(--color-bg-tertiary)',
                  color: 'var(--color-text-muted)',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'background-color 150ms ease, color 150ms ease',
                }}
              >
                <SourceIcon size={12} aria-hidden="true" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="truncate" style={{ fontWeight: 500 }}>
                  {item.mono && (
                    <span
                      className="font-mono"
                      style={{ color: 'var(--color-text-subtle)', marginRight: '0.3125rem', fontWeight: 400 }}
                    >
                      {item.mono}
                    </span>
                  )}
                  {item.label}
                </div>
                {item.sub && (
                  <div
                    className="truncate"
                    style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}
                  >
                    {item.sub}
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
