'use client'

/**
 * TeammateHome - the scoped team-member Overview ("My studio") home.
 *
 * Ported from the Claude Design overview.jsx `TeammateHome`, composed from the
 * shared OVKit primitives (ov-kit.tsx) and the `.ov-*` grammar in overview.css.
 * Every figure is REAL, scoped to the signed-in team member via the member
 * routes (all resolve teamMembers.clerkUserId = auth userId server-side):
 *
 *   masthead : TheWire  <- GET /api/admin/overview/wire?scope=me
 *              Hero      <- GET /api/admin/overview/me            (My open work)
 *              Vitals    <- me + tasks (Overdue / Due today / Timer / Replies)
 *              NeedsYou  <- overdue task + next call + oldest reply
 *   My day   : My work   <- GET /api/admin/tasks?assignee=me
 *              Calls      <- GET /api/admin/discovery-calls/upcoming (today, studio-wide)
 *   Waiting  : Replies    <- GET /api/admin/overview/replies-waiting?scope=me
 *   My week  : Time        <- me.timer (live tick) + GET /api/admin/time?teamMemberId=me
 *              Docs         <- GET /api/admin/docs  (recent, honest: no pin model yet)
 *
 * There is no currency on this home, so useOvFormat() is intentionally not
 * called. Honest empty / loading states everywhere; never a fabricated number.
 * Read-only (impersonation preview) sets data-ro on the root; overview.css then
 * disables every write control (New menu, timer buttons), and NewMenu also takes
 * ro directly.
 */

import { useEffect, useRef, useState } from 'react'
import { useResource } from '@/lib/use-resource'
import { OverviewCtx } from '@/components/tahi/overview/ctx'
import {
  Card,
  CardH,
  Row,
  Hero,
  Vitals,
  NeedsYou,
  TheWire,
  Zone,
  NewMenu,
  type WireEvent,
  type NeedItem,
  type VitalItem,
  type NewMenuItem,
} from '@/components/tahi/overview/ov-kit'

/* ---------- documented inline-style hexes (CLAUDE rule 2) ------------------- */
/** Status dot + wire dot palette (mirrors the design's per-status inks). */
const HX = {
  overdue: '#C0392E',
  build: '#2A6FDB',
  review: '#C9A227',
  queued: '#6D4FA3',
  sales: '#B0761F',
} as const

/* ---------- route response shapes (read from the real route files) --------- */
interface MeData {
  openWork: number
  dueToday: number
  overdue: number
  timer: { elapsedSeconds: number; title: string | null } | null
  repliesWaiting: number
}
type WireDomain = 'content' | 'social' | 'sales' | 'money' | 'client' | 'ops'
interface WireApiEvent { id: string; type: WireDomain; text: string; at: string }
interface ReplyThread {
  id: string
  kind: 'conversation' | 'request'
  threadTitle: string
  clientName: string | null
  lastSnippet: string
  ago: string
  at: string
  to: string
}
interface TaskRow {
  id: string
  title: string
  status: string
  dueDate: string | null
  orgName: string | null
  updatedAt: string
}
interface CallRow {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number | null
  meetingUrl: string | null
  withName: string | null
}
interface TimeData {
  totalHours: number
  billableHours: number
  capacityHours: number | null
}
interface DocRow {
  id: string
  title: string
  lastEditedBy: string | null
  lastEditedAt: string
}

/* ---------- date + format helpers ------------------------------------------ */
function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function weekBounds(): { from: string; to: string; today: string } {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7 // Mon=0 .. Sun=6
  const mon = new Date(now)
  mon.setDate(now.getDate() - dow)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return { from: ymdLocal(mon), to: ymdLocal(sun), today: ymdLocal(now) }
}
/** Whole-day difference (a - b) between two YYYY-MM-DD strings. */
function dayDelta(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((da.getTime() - db.getTime()) / 86400000)
}
/** "Overdue 2 days" / "Due today" / "Due tomorrow" / "Due Fri" / "Due 14 Jul". */
function dueLabel(dueDate: string | null, today: string): string | null {
  if (!dueDate) return null
  const d = dueDate.slice(0, 10)
  const delta = dayDelta(d, today)
  if (delta < 0) {
    const n = Math.abs(delta)
    return `Overdue ${n} day${n === 1 ? '' : 's'}`
  }
  if (delta === 0) return 'Due today'
  if (delta === 1) return 'Due tomorrow'
  const date = new Date(d + 'T00:00:00')
  if (delta < 7) return 'Due ' + date.toLocaleDateString('en-NZ', { weekday: 'short' })
  return 'Due ' + date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}
/** Time-of-day label for a call, e.g. "10:00am". */
function timeLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, '')
    .toLowerCase()
}
/** Compact relative age from an ISO timestamp, e.g. "5m ago", "3h ago". */
function relAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return `${Math.floor(d / 7)}w ago`
}
function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
/** Seconds -> "H:MM:SS". */
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
/** Seconds -> "H:MM" (compact, for the Vitals timer cell). */
function clockShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

/** Wire domain -> dot ink. Mirrors the design's colourful pulse dots. */
const WIRE_INK: Record<WireDomain, string> = {
  client: 'var(--brand)',
  ops: HX.build,
  money: HX.review,
  sales: HX.sales,
  content: HX.queued,
  social: HX.build,
}

/** Open task ordering + presentation. */
const TASK_CLOSED = new Set(['done', 'completed', 'cancelled', 'archived'])
interface StatusMeta { label: string; variant: 'info' | 'warn' | 'muted' | 'rose'; dot: string }
function statusMeta(status: string, overdue: boolean): StatusMeta {
  if (overdue) return { label: 'Overdue', variant: 'rose', dot: HX.overdue }
  switch (status) {
    case 'in_progress':
      return { label: 'In progress', variant: 'info', dot: HX.build }
    case 'blocked':
      return { label: 'Blocked', variant: 'rose', dot: HX.overdue }
    case 'in_review':
    case 'review':
    case 'client_review':
      return { label: 'In review', variant: 'warn', dot: HX.review }
    case 'submitted':
    case 'todo':
    case 'backlog':
      return { label: 'Assigned', variant: 'muted', dot: 'var(--brand)' }
    default:
      return { label: humanise(status), variant: 'muted', dot: HX.queued }
  }
}
function humanise(s: string): string {
  if (!s) return 'Queued'
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}

/* ---------- tiny presentational helpers ------------------------------------ */
function Skel({ w = '2ch', h = '1em' }: { w?: string; h?: string }) {
  return (
    <span
      className="animate-pulse"
      style={{ display: 'inline-block', width: w, height: h, borderRadius: 6, background: 'var(--bg-tertiary)' }}
    />
  )
}
function RowsSkeleton({ n }: { n: number }) {
  return (
    <div className="ov-rows">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="ov-row">
          <span className="rw-av" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="rw-t" style={{ gap: 6 }}>
            <Skel w="60%" h="0.8em" />
            <Skel w="40%" h="0.7em" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* =========================================================== TeammateHome === */
export function TeammateHome({ ctx }: { ctx: OverviewCtx }) {
  const go = ctx.go
  const ro = ctx.isReadOnly
  const { today } = weekBounds()

  const me = useResource<MeData>('/api/admin/overview/me')
  const wire = useResource<{ events: WireApiEvent[] }>('/api/admin/overview/wire?scope=me')
  const tasksRes = useResource<{ tasks: TaskRow[] }>('/api/admin/tasks?assignee=me')
  const callsRes = useResource<{ calls: CallRow[] }>('/api/admin/discovery-calls/upcoming?limit=8&includePast=1')
  const repliesRes = useResource<{ threads: ReplyThread[] }>('/api/admin/overview/replies-waiting?scope=me')

  const meData = me.data
  const meLoading = me.isLoading && !meData

  /* ---- open tasks, ordered overdue -> due-today -> soonest ---- */
  const openTasks = (tasksRes.data?.tasks ?? [])
    .filter(t => !TASK_CLOSED.has(t.status))
    .map(t => {
      const d = t.dueDate ? t.dueDate.slice(0, 10) : null
      const delta = d ? dayDelta(d, today) : null
      return { ...t, day: d, delta, overdue: delta != null && delta < 0 }
    })
    .sort((a, b) => {
      if (a.day && b.day) return a.day < b.day ? -1 : a.day > b.day ? 1 : 0
      if (a.day) return -1
      if (b.day) return 1
      return a.updatedAt < b.updatedAt ? 1 : -1
    })
  const overdueTasks = openTasks.filter(t => t.overdue)
  const dueTodayTasks = openTasks.filter(t => t.delta === 0)

  /* ---- today's calls (studio-wide; no per-member attendee scope yet) ---- */
  const todaysCalls = (callsRes.data?.calls ?? []).filter(c => ymdLocal(new Date(c.scheduledAt)) === today).slice(0, 4)

  /* ---- replies waiting ---- */
  const threads = repliesRes.data?.threads ?? []

  /* ---- Hero ---- */
  const heroValue = meLoading ? <Skel w="1.6ch" h="0.75em" /> : (meData?.openWork ?? 0)
  const heroSub = meData ? buildHeroSub(meData) : undefined

  /* ---- Vitals ---- */
  const overdueSub = overdueTasks[0]?.title ?? (meData && meData.overdue > 0 ? 'past due items' : 'none past due')
  const dueTodaySub = dueTodayTasks[0]?.title ?? (meData && meData.dueToday > 0 ? 'assigned to you' : 'nothing due')
  const timer = meData?.timer ?? null
  const vitals: VitalItem[] = meLoading
    ? [
        { lbl: 'Overdue', num: <Skel /> },
        { lbl: 'Due today', num: <Skel /> },
        { lbl: 'Timer', num: <Skel /> },
        { lbl: 'Replies', num: <Skel /> },
      ]
    : [
        {
          lbl: 'Overdue',
          num: meData?.overdue ?? 0,
          muted: !meData?.overdue,
          trend: meData && meData.overdue > 0 ? { tone: 'bad', txt: 'past due' } : undefined,
          sub: overdueSub,
        },
        {
          lbl: 'Due today',
          num: meData?.dueToday ?? 0,
          muted: !meData?.dueToday,
          sub: dueTodaySub,
        },
        {
          lbl: 'Timer',
          num: timer ? clockShort(timer.elapsedSeconds) : '0:00',
          muted: !timer,
          trend: timer ? { tone: 'good', txt: 'running' } : undefined,
          sub: timer ? timer.title ?? 'in progress' : 'no timer',
        },
        {
          lbl: 'Replies',
          num: meData?.repliesWaiting ?? 0,
          muted: !meData?.repliesWaiting,
          trend: meData && meData.repliesWaiting > 0 ? { tone: 'bad', txt: 'to reply' } : undefined,
          sub: meData && meData.repliesWaiting > 0 ? 'waiting on you' : 'all caught up',
        },
      ]

  /* ---- NeedsYou (overdue task -> next call -> oldest reply) ---- */
  const needs: NeedItem[] = []
  const firstOverdue = overdueTasks[0]
  if (firstOverdue) {
    needs.push({
      tone: 'work',
      ic: 'tasks',
      title: firstOverdue.title,
      sub: [firstOverdue.orgName, dueLabel(firstOverdue.dueDate, today)].filter(Boolean).join(' · ') || 'Overdue',
      verb: 'Open',
      onAct: () => go('tasks'),
    })
  }
  const nextCall = todaysCalls.find(c => new Date(c.scheduledAt).getTime() + (c.durationMinutes ?? 30) * 60000 >= Date.now())
  if (nextCall) {
    needs.push({
      tone: 'call',
      ic: 'phone',
      title: nextCall.title || `Call with ${nextCall.withName ?? 'client'}`,
      sub: `${timeLabel(nextCall.scheduledAt)} · ${nextCall.durationMinutes ?? 30} min`,
      verb: nextCall.meetingUrl ? 'Join' : 'View',
      onAct: () => (nextCall.meetingUrl ? window.open(nextCall.meetingUrl, '_blank', 'noopener') : go('calls')),
    })
  }
  const firstReply = threads[0]
  if (firstReply) {
    needs.push({
      tone: 'work',
      ic: 'msg',
      title: firstReply.clientName ?? firstReply.threadTitle,
      sub: 'Waiting on your reply',
      verb: 'Reply',
      onAct: () => go('messages'),
    })
  }

  /* ---- New menu ---- */
  const newItems: NewMenuItem[] = [
    { ic: 'tasks', label: 'New task', go: () => go('tasks') },
    { ic: 'request', label: 'New request', go: () => go('requests') },
    { ic: 'clock', label: 'Log time', go: () => go('time') },
  ]

  /* ---- Wire (map member pulse -> kit events) ---- */
  const wireEvents: WireEvent[] = (wire.data?.events ?? []).map(e => ({
    color: WIRE_INK[e.type] ?? 'var(--brand)',
    who: '',
    what: e.text,
    when: relAgo(e.at),
  }))

  return (
    <div className="ov" data-ro={ro ? '1' : '0'}>
      <div className="ov-mast">
        <TheWire events={wireEvents} />
        <Hero
          variant="forest"
          label="My open work"
          value={heroValue}
          sub={heroSub}
          action={<NewMenu items={newItems} ro={ro} variant="hero" />}
        />
        <Vitals items={vitals} />
        <NeedsYou
          items={needs}
          quiet={{ title: 'All quiet.', sub: 'Nothing is waiting on you right now.' }}
          onMore={() => go('tasks')}
        />
      </div>

      {/* ---- My day ---- */}
      <Zone label="My day">
        <Card span={7} edge={overdueTasks.length > 0 ? 'risk' : undefined}>
          <CardH ic="tasks" title="My work" link="My queue" onLink={() => go('tasks')} />
          {tasksRes.isLoading && !tasksRes.data ? (
            <RowsSkeleton n={4} />
          ) : openTasks.length === 0 ? (
            <EmptyLine text="Nothing assigned to you right now." />
          ) : (
            <div className="ov-rows">
              {openTasks.slice(0, 5).map(t => {
                const meta = statusMeta(t.status, t.overdue)
                return (
                  <Row
                    key={t.id}
                    dot
                    dotColor={meta.dot}
                    title={t.orgName ? `${t.orgName} · ${t.title}` : t.title}
                    sub={dueLabel(t.dueDate, today) ?? 'No due date'}
                    right={<span className={'ov-chip ' + meta.variant}>{meta.label}</span>}
                    onClick={() => go('tasks')}
                  />
                )
              })}
            </div>
          )}
        </Card>

        <Card span={5}>
          <CardH ic="phone" title="Today's calls" link="Calendar" onLink={() => go('calls')} />
          {callsRes.isLoading && !callsRes.data ? (
            <RowsSkeleton n={2} />
          ) : todaysCalls.length === 0 ? (
            <EmptyLine text="No calls on your calendar today." />
          ) : (
            <div className="ov-rows">
              {todaysCalls.map(c => {
                const start = new Date(c.scheduledAt).getTime()
                const end = start + (c.durationMinutes ?? 30) * 60000
                const joinable = Date.now() >= start - 10 * 60000 && Date.now() <= end
                return (
                  <Row
                    key={c.id}
                    avText={initials(c.withName || c.title)}
                    title={c.title || `Call with ${c.withName ?? 'client'}`}
                    sub={`${timeLabel(c.scheduledAt)} · ${c.durationMinutes ?? 30} min`}
                    right={
                      joinable && c.meetingUrl ? (
                        <button
                          className="ov-cta"
                          style={{ height: 30, fontSize: 12, padding: '0 12px' }}
                          onClick={() => window.open(c.meetingUrl as string, '_blank', 'noopener')}
                        >
                          Join
                        </button>
                      ) : undefined
                    }
                  />
                )
              })}
            </div>
          )}
        </Card>
      </Zone>

      {/* ---- Waiting ---- */}
      <Zone label="Waiting">
        <Card span={12}>
          <CardH ic="msg" title="Replies waiting on you" link="All messages" onLink={() => go('messages')} />
          {repliesRes.isLoading && !repliesRes.data ? (
            <RowsSkeleton n={3} />
          ) : threads.length === 0 ? (
            <EmptyLine text="You're all caught up. No replies are waiting on you." />
          ) : (
            <div className="ov-rows">
              {threads.map(t => (
                <Row
                  key={t.kind + t.id}
                  avText={initials(t.clientName || t.threadTitle)}
                  title={t.lastSnippet ? `“${t.lastSnippet}”` : t.threadTitle}
                  sub={[t.clientName || t.threadTitle, t.ago].filter(Boolean).join(' · ')}
                  right={
                    <button
                      className="ov-cta ghost"
                      style={{ height: 30, fontSize: 12, padding: '0 12px' }}
                      onClick={() => go('messages')}
                    >
                      Reply
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </Zone>

      {/* ---- My week ---- */}
      <Zone label="My week">
        <MyTimeCard timer={timer} timerLoading={meLoading} go={go} />
        <RecentDocsCard go={go} />
      </Zone>
    </div>
  )
}

/* ---------- Hero sub composition ------------------------------------------- */
function buildHeroSub(me: MeData): string {
  if (me.openWork === 0) return 'Nothing on your plate right now'
  const parts: string[] = []
  if (me.dueToday > 0) parts.push(`${me.dueToday} due today`)
  if (me.overdue > 0) parts.push(`${me.overdue} overdue`)
  return parts.length ? parts.join(' · ') : 'on track'
}

/* ---------- empty line ------------------------------------------------------ */
function EmptyLine({ text }: { text: string }) {
  return (
    <div className="ov-mini" style={{ padding: '18px 2px', color: 'var(--text-faint)' }}>
      {text}
    </div>
  )
}

/* ---------- Time tracking card (live-ticking clock) ------------------------- */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduce(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduce
}

function MyTimeCard({
  timer,
  timerLoading,
  go,
}: {
  timer: { elapsedSeconds: number; title: string | null } | null
  timerLoading: boolean
  go: (id: string) => void
}) {
  const reduce = usePrefersReducedMotion()
  const { from, to, today } = weekBounds()

  // Live clock: baseline the server's elapsedSeconds at fetch and add wall-clock
  // drift each second. Re-baselines whenever a fresh snapshot arrives.
  const baseRef = useRef<{ base: number; at: number }>({ base: 0, at: Date.now() })
  const [live, setLive] = useState(0)
  useEffect(() => {
    if (!timer) return
    baseRef.current = { base: timer.elapsedSeconds, at: Date.now() }
    setLive(timer.elapsedSeconds)
    if (reduce) return
    const id = setInterval(() => {
      const { base, at } = baseRef.current
      setLive(base + Math.floor((Date.now() - at) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [timer, reduce])

  const week = useResource<TimeData>(`/api/admin/time?teamMemberId=me&dateFrom=${from}&dateTo=${to}`)
  const todayRes = useResource<TimeData>(`/api/admin/time?teamMemberId=me&dateFrom=${today}&dateTo=${today}`)

  const total = week.data?.totalHours ?? 0
  const billable = week.data?.billableHours ?? 0
  const capacity = week.data?.capacityHours ?? null
  const todayHours = todayRes.data?.totalHours ?? 0
  const billablePct = total > 0 ? Math.round((billable / total) * 100) : null
  const capacityPct = capacity && capacity > 0 ? Math.min(100, Math.round((total / capacity) * 100)) : null
  const weekLoading = week.isLoading && !week.data

  const round1 = (n: number) => Math.round(n * 10) / 10

  return (
    <Card span={6}>
      <CardH ic="clock" title="Time tracking" link="Timesheet" onLink={() => go('time')} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span
          style={{
            font: "700 28px Manrope",
            color: 'var(--text)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
          }}
        >
          {timerLoading ? <Skel w="4ch" h="0.8em" /> : timer ? clock(live) : '0:00:00'}
        </span>
        <span className={'ov-chip ' + (timer ? 'brand' : 'muted')}>{timer ? 'Running' : 'No timer'}</span>
      </div>
      <div className="ov-mini" style={{ marginTop: 5 }}>
        {timer ? timer.title ?? 'Untitled' : 'Nothing is tracking right now.'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {timer ? (
          <>
            <button className="ov-cta ghost" style={{ flex: 1, height: 34, fontSize: 12.5 }} onClick={() => go('time')}>
              Pause
            </button>
            <button className="ov-cta ghost" style={{ flex: 1, height: 34, fontSize: 12.5 }} onClick={() => go('time')}>
              Switch task
            </button>
          </>
        ) : (
          <button className="ov-cta ghost" style={{ flex: 1, height: 34, fontSize: 12.5 }} onClick={() => go('time')}>
            Start a timer
          </button>
        )}
      </div>
      <div className="ov-subrows">
        <div className="ov-subrow">
          <span>Today</span>
          <b>{weekLoading ? <Skel w="3ch" /> : `${round1(todayHours)}h`}</b>
        </div>
        <div className="ov-subrow">
          <span>This week</span>
          {capacityPct != null && (
            <span className="ov-meter" style={{ flex: 1 }}>
              <i style={{ width: `${capacityPct}%` }} />
            </span>
          )}
          <b>{weekLoading ? <Skel w="5ch" /> : capacity ? `${round1(total)}h / ${round1(capacity)}h` : `${round1(total)}h`}</b>
        </div>
        <div className="ov-subrow">
          <span>Billable</span>
          <b>{weekLoading ? <Skel w="3ch" /> : billablePct != null ? `${billablePct}%` : 'no hours yet'}</b>
        </div>
      </div>
    </Card>
  )
}

/* ---------- Recent docs card (honest: no per-member pin model yet) --------- */
function RecentDocsCard({ go }: { go: (id: string) => void }) {
  const docsRes = useResource<{ pages: DocRow[] }>('/api/admin/docs')
  const docs = (docsRes.data?.pages ?? []).slice(0, 4)
  return (
    <Card span={6}>
      <CardH ic="book" title="Recent docs" link="Docs hub" onLink={() => go('docs')} />
      {docsRes.isLoading && !docsRes.data ? (
        <RowsSkeleton n={3} />
      ) : docs.length === 0 ? (
        <EmptyLine text="No docs in the hub yet." />
      ) : (
        <div className="ov-rows">
          {docs.map(d => (
            <Row
              key={d.id}
              title={d.title}
              sub={[d.lastEditedBy ? `Edited by ${d.lastEditedBy}` : null, relAgo(d.lastEditedAt)]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => go('docs')}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
