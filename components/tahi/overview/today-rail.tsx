'use client'

// ─── Today Rail ────────────────────────────────────────────────────────────────
//
// The WORK-zone "Today" surface (homepage Studio Ledger Slice 3). Two stacked
// halves in one card's footprint:
//
//   UPPER  Upcoming calls in a CardDeck (peek-behind stack): page through the
//          next few calls in one card's space. Each call shows the time
//          client-local FIRST with Auckland beneath (the masthead's Two Clocks
//          approach), and a [Join] button that only surfaces inside the live
//          window (~10 min before start) when a meetingUrl exists.
//
//   LOWER  "Next on the bench": the single most urgent open task as a hero block
//          + up to three quiet task rows beneath, split by a hairline rule.
//
// Both halves gate to a calm one-liner when empty. Names carry data-private.
// See SPECS/homepage-studio-ledger.md.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Video, ExternalLink, ArrowRight } from 'lucide-react'
import { CardDeck } from '@/components/tahi/card-deck'
import { apiPath } from '@/lib/api'

const AUCKLAND_TZ = 'Pacific/Auckland'
const JOIN_WINDOW_MS = 10 * 60000 // [Join] appears within ~10 min of the start

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

// ─── Shapes (mirror UpcomingCallsWidget + OpenTasksCard in overview-content) ──

interface UpcomingCall {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  meetingUrl: string | null
  withName: string | null
  withSubtitle: string | null
  parentType: 'lead' | 'deal' | 'org' | 'request' | 'task' | null
  parentHref: string | null
  fromCalendar: boolean
}

interface OverviewTask {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  orgName: string | null
  type: string
  subtaskCount: number
}

const TASK_CLOSED = new Set(['done', 'completed', 'cancelled'])

function priorityWeight(p: string): number {
  switch (p) {
    case 'urgent': return 3
    case 'high': return 2
    case 'standard': return 1
    default: return 0
  }
}

// Due-state chip: overdue red, due-today amber, soon muted, later subtle.
function taskDueState(due: string | null): { label: string; color: string } | null {
  if (!due) return null
  const d = new Date(due)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((dueDay - startOfToday) / 86400000)
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, color: 'var(--color-danger)' }
  if (diffDays === 0) return { label: 'Due today', color: 'var(--color-due-soon-text)' }
  if (diffDays <= 7) return { label: `Due in ${diffDays}d`, color: 'var(--color-text-muted)' }
  return { label: `Due ${d.toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' })}`, color: 'var(--color-text-subtle)' }
}

function humanise(value: string): string {
  return value.replace(/_/g, ' ')
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function TodayRail({ className }: { className?: string }) {
  const [calls, setCalls] = useState<UpcomingCall[]>([])
  const [tasks, setTasks] = useState<OverviewTask[]>([])
  const [callsLoading, setCallsLoading] = useState(true)
  const [tasksLoading, setTasksLoading] = useState(true)

  // Mount-gated clock: time differs server vs client, so resolve the viewer's
  // zone after mount (and re-render once) to avoid a hydration mismatch.
  const [localTz, setLocalTz] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setLocalTz(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])

  useEffect(() => {
    fetch(apiPath('/api/admin/discovery-calls/upcoming?limit=5&includePast=1'))
      .then(r => (r.ok ? (r.json() as Promise<{ calls: UpcomingCall[] }>) : { calls: [] }))
      .then(d => setCalls(d.calls ?? []))
      .catch(() => setCalls([]))
      .finally(() => setCallsLoading(false))
  }, [])

  useEffect(() => {
    fetch(apiPath('/api/admin/tasks'))
      .then(r => (r.ok ? (r.json() as Promise<{ tasks: OverviewTask[] }>) : { tasks: [] }))
      .then(d => setTasks(d.tasks ?? []))
      .catch(() => setTasks([]))
      .finally(() => setTasksLoading(false))
  }, [])

  const openTasks = tasks
    .filter(t => !TASK_CLOSED.has(t.status))
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
      if (ad !== bd) return ad - bd
      return priorityWeight(b.priority) - priorityWeight(a.priority)
    })

  const hero = openTasks[0]
  const benchRows = openTasks.slice(1, 4)

  return (
    <section
      aria-label="Today"
      className={className}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
      }}
    >
      {/* UPPER: upcoming calls in a peek-behind deck */}
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <h2 style={LABEL_STYLE}>Today</h2>
        <Link
          href="/leads"
          className="view-link"
          style={{ ...LABEL_STYLE, color: 'var(--color-link)' }}
        >
          Calls <ArrowRight size={11} aria-hidden="true" className="view-arrow" style={{ display: 'inline', verticalAlign: 'middle' }} />
        </Link>
      </div>

      {callsLoading ? (
        <CallShimmer />
      ) : (
        <CardDeck<UpcomingCall>
          items={calls}
          ariaLabel="Upcoming calls"
          minHeight="6.25rem"
          getKey={(c) => c.id}
          emptyState={<CalmLine>No calls on the board. Sync one from Google Calendar.</CalmLine>}
          renderCard={(call, isActive) => (
            <CallCard call={call} isActive={isActive} mounted={mounted} localTz={localTz} />
          )}
        />
      )}

      {/* Hairline rule between the two halves */}
      <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: 'var(--space-5) 0' }} />

      {/* LOWER: next on the bench */}
      <h3 style={{ ...LABEL_STYLE, marginBottom: 'var(--space-3)' }}>Next on the bench</h3>

      {tasksLoading ? (
        <TaskShimmer />
      ) : !hero ? (
        <CalmLine>Bench is clear. Nothing open right now.</CalmLine>
      ) : (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <HeroTask task={hero} />
          {benchRows.map(t => (
            <QuietTaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Call card (Two Clocks: client-local first, AKL beneath) ─────────────────

function CallCard({
  call,
  isActive,
  mounted,
  localTz,
}: {
  call: UpcomingCall
  isActive: boolean
  mounted: boolean
  localTz: string | null
}) {
  const start = new Date(call.scheduledAt)
  const valid = !isNaN(start.getTime())

  // Live window: [Join] only appears within ~10 min before start through the
  // end of the call, and only when a meeting link exists.
  const showJoin = Boolean(call.meetingUrl) && valid && mounted && (() => {
    const now = Date.now()
    const s = start.getTime()
    const end = s + call.durationMinutes * 60000
    return now >= s - JOIN_WINDOW_MS && now <= end
  })()

  const showLocal = mounted && localTz && localTz !== AUCKLAND_TZ
  const localTime = valid && showLocal ? fmtTime(start, localTz as string) : ''
  const aklTime = valid ? fmtTime(start, AUCKLAND_TZ) : ''
  const dayLabel = valid ? start.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : ''

  return (
    <div
      className="flex items-start"
      style={{
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        minHeight: '6.25rem',
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: '2rem',
          height: '2rem',
          background: 'var(--color-brand-50)',
          color: 'var(--color-brand)',
          borderRadius: 'var(--radius-leaf-sm)',
        }}
      >
        <Video size={14} aria-hidden="true" />
      </div>

      <div className="flex-1 min-w-0">
        {call.parentHref && isActive ? (
          <Link
            href={call.parentHref}
            className="truncate hover:underline"
            style={{ display: 'block', fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}
          >
            <span data-private>{call.withName ?? call.title}</span>
          </Link>
        ) : (
          <p className="truncate" style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
            <span data-private>{call.withName ?? call.title}</span>
          </p>
        )}
        {call.withSubtitle && (
          <p className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
            <span data-private>{call.withSubtitle}</span>
          </p>
        )}

        {/* Two Clocks: client-local first, Auckland beneath (or AKL only) */}
        <div style={{ marginTop: 'var(--space-2)' }}>
          {showLocal ? (
            <>
              <p className="tabular-nums" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
                {dayLabel}
                {localTime ? ` · ${localTime}` : ''}
              </p>
              <p className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
                AKL {aklTime} · {call.durationMinutes}min
              </p>
            </>
          ) : (
            <p className="tabular-nums" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
              AKL {dayLabel}{aklTime ? ` · ${aklTime}` : ''}
              <span style={{ fontWeight: 400, color: 'var(--color-text-subtle)' }}> · {call.durationMinutes}min</span>
            </p>
          )}
        </div>
      </div>

      {showJoin && call.meetingUrl && (
        <a
          href={call.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center flex-shrink-0 tahi-press"
          style={{
            gap: 'var(--space-1)',
            padding: 'var(--space-1-5) var(--space-3)',
            minHeight: '2.75rem',
            background: 'var(--color-brand)',
            color: '#fff',
            borderRadius: 'var(--radius-leaf-sm)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Join <ExternalLink size={12} aria-hidden="true" />
        </a>
      )}
    </div>
  )
}

function fmtTime(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(date)
  } catch {
    return ''
  }
}

// ─── Bench tasks ───────────────────────────────────────────────────────────────

function HeroTask({ task }: { task: OverviewTask }) {
  const dueState = taskDueState(task.dueDate)
  const prColor = task.priority === 'urgent' || task.priority === 'high'
    ? 'var(--color-danger)'
    : task.priority === 'low'
      ? 'var(--color-text-subtle)'
      : 'var(--color-brand)'
  return (
    <Link
      href={`/tasks?task=${task.id}`}
      className="block group"
      style={{
        padding: 'var(--space-4)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        transition: 'border-color var(--dur-2) var(--ease-productive)',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)' }}
    >
      <div className="flex items-start" style={{ gap: 'var(--space-2)' }}>
        <span
          aria-hidden="true"
          className="flex-shrink-0"
          style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', background: prColor, marginTop: '0.375rem' }}
        />
        <p
          data-private
          style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text)', flex: 1, minWidth: 0, lineHeight: 1.35 }}
        >
          {task.title}
        </p>
      </div>
      <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-2)', paddingLeft: 'var(--space-4)', gap: 'var(--space-2)' }}>
        <span data-private className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', minWidth: 0 }}>
          {task.orgName ?? humanise(task.type)}
        </span>
        {dueState && (
          <span className="flex-shrink-0" style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: dueState.color }}>
            {dueState.label}
          </span>
        )}
      </div>
    </Link>
  )
}

function QuietTaskRow({ task }: { task: OverviewTask }) {
  const dueState = taskDueState(task.dueDate)
  return (
    <Link
      href={`/tasks?task=${task.id}`}
      className="flex items-center group"
      style={{
        gap: 'var(--space-2-5, 0.625rem)',
        padding: 'var(--space-2) var(--space-2)',
        minHeight: '2.75rem',
        marginLeft: 'calc(-1 * var(--space-2))',
        marginRight: 'calc(-1 * var(--space-2))',
        borderRadius: 'var(--radius-sm)',
        textDecoration: 'none',
        transition: 'background-color var(--dur-2) var(--ease-productive)',
      }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-row-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <span
        data-private
        className="truncate"
        style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)', flex: 1, minWidth: 0 }}
      >
        {task.title}
      </span>
      {dueState && (
        <span className="flex-shrink-0" style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: dueState.color }}>
          {dueState.label}
        </span>
      )}
    </Link>
  )
}

// ─── Loading + calm empty states ─────────────────────────────────────────────

function CalmLine({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)' }}>
      {children}
    </p>
  )
}

function CallShimmer() {
  return (
    <div
      className="flex items-center"
      style={{
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        minHeight: '6.25rem',
      }}
    >
      <div className="tahi-shimmer flex-shrink-0" style={{ width: '2rem', height: '2rem', borderRadius: 'var(--radius-leaf-sm)' }} />
      <div className="flex-1 flex flex-col" style={{ gap: 'var(--space-2)' }}>
        <div className="tahi-shimmer" style={{ height: '0.875rem', width: '60%' }} />
        <div className="tahi-shimmer" style={{ height: '0.6875rem', width: '40%' }} />
        <div className="tahi-shimmer" style={{ height: '0.6875rem', width: '50%' }} />
      </div>
    </div>
  )
}

function TaskShimmer() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
      <div className="tahi-shimmer" style={{ height: '4rem', borderRadius: 'var(--radius-md)' }} />
      {[0, 1].map(n => (
        <div key={n} className="tahi-shimmer" style={{ height: '1.75rem' }} />
      ))}
    </div>
  )
}
