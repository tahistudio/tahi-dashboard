'use client'

/**
 * /notifications : the full history behind the bell, for both audiences.
 *
 * Ported from the Claude Design module portal-account.jsx (Notifications).
 * Companion stylesheet: app/(dashboard)/notifications/notifications.css (all
 * `.pa-*` classes).
 *
 * The three decisions that shape this page:
 *
 *  - HONEST DEEP LINKS. lib/notification-links.ts returns null for a client on
 *    documents, tasks, calls and deals. Rather than render a link that bounces
 *    them, those rows are drawn as a statement ("Nothing to open yet") with no
 *    button wrapper, so the row is not clickable at all.
 *  - OPENING A ROW MARKS IT READ, then navigates. Today only the request detail
 *    page clears the bell, so an invoice or announcement stays unread forever.
 *    Doing it on the row closes that hole without touching every destination.
 *  - COUNTS ARE WITHHELD until real rows land. A page that says "Requests 5"
 *    before the read returns is guessing.
 *
 * Filters are by KIND, not by the 30 internal event types, which are a
 * vocabulary no client should meet.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { useToast } from '@/components/tahi/toast'
import { notifyNotificationsChanged } from '@/lib/notification-events'
import {
  notificationKind,
  notificationKindsFor,
  notificationDestination,
  NOTIFICATION_KINDS,
  type NotificationAudience,
  type NotificationKind,
  type NotificationKindDef,
} from '@/lib/notification-links'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationRow {
  id: string
  eventType: string
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
  read: boolean
  createdAt: string
}

type Tab = 'all' | 'past'
type LoadState = 'loading' | 'ready' | 'error'

/** The All tab is the last thirty days; Past is everything older. */
const WINDOW_DAYS = 30
const PAGE_SIZE = 20

// ─── Time ─────────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function relTime(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const min = Math.floor((now - t) / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hr = d.getHours()
  const hh = hr % 12 === 0 ? 12 : hr % 12
  return `${hh}:${String(d.getMinutes()).padStart(2, '0')}${hr < 12 ? 'am' : 'pm'}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Today / Yesterday / weekday and date, then bare date once it is over a week old. */
function dayLabel(iso: string, now: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  const nowDate = new Date(now)
  const a = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const i = Math.round((a - b) / 86400000)
  if (i <= 0) return 'Today'
  if (i === 1) return 'Yesterday'
  if (i < 7) return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
  const year = d.getFullYear() !== nowDate.getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`
}

function monthLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="pa-skel" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="pa-skel-row" key={i}>
          <span className="pa-skel-sq" />
          <span className="pa-skel-lines">
            <span className="pa-skel-l w70" />
            <span className="pa-skel-l w45" />
          </span>
          <span className="pa-skel-l" />
        </div>
      ))}
    </div>
  )
}

function NotifRow({
  n, kind, dest, now, onOpen, onRead, readOnly,
}: {
  n: NotificationRow
  kind: NotificationKindDef
  dest: { href: string; label: string } | null
  now: number
  onOpen: (n: NotificationRow) => void
  onRead: (id: string) => void
  readOnly: boolean
}) {
  const stamp = `${fmtDate(n.createdAt)}, ${clockTime(n.createdAt)}`
  const inner = (
    <>
      <span className="pa-nrow-ic" data-tone={kind.tone}>
        <ShellIcon n={kind.icon} s={16} />
        {!n.read && <span className="pa-nrow-dot" aria-hidden="true" />}
      </span>
      <span className="pa-nrow-t">
        <b data-private>{n.title}</b>
        {n.body && <small data-private>{n.body}</small>}
        {/* The separator sits inside the destination, so a wrap can never
            leave a dot dangling at the end of the line. */}
        <span className="pa-nrow-meta">
          <span className="pa-nrow-kind">{kind.label}</span>
          {dest ? (
            <span className="pa-nrow-dest">
              <span className="pa-sep" aria-hidden="true" />
              {`Open ${dest.label}`}
              <ShellIcon n="arrow" s={12} />
            </span>
          ) : (
            <span className="pa-nrow-nodest">
              <span className="pa-sep" aria-hidden="true" />
              Nothing to open yet
            </span>
          )}
        </span>
      </span>
      <span className="pa-nrow-when" title={stamp}>{relTime(n.createdAt, now)}</span>
    </>
  )

  return (
    <li className={'pa-nrow' + (n.read ? '' : ' unread') + (dest ? '' : ' flat')}>
      {dest ? (
        <button
          type="button"
          className="pa-nrow-main tahi-focus-inset"
          onClick={() => onOpen(n)}
          aria-label={`${n.title}. ${stamp}. Opens ${dest.label}`}
        >
          {inner}
        </button>
      ) : (
        <div className="pa-nrow-main">{inner}</div>
      )}
      {!n.read && (
        <button
          type="button"
          className="pa-nrow-read tahi-focus-ring"
          disabled={readOnly}
          title={readOnly ? 'Read-only in client view' : 'Mark as read'}
          aria-label={`Mark as read: ${n.title}`}
          onClick={() => onRead(n.id)}
        >
          <ShellIcon n="check" s={15} />
        </button>
      )}
    </li>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function NotificationsContent({
  audience,
  readOnly = false,
}: {
  audience: NotificationAudience
  /** Admin previewing the portal: writes are refused server-side elsewhere, and
   *  clearing somebody's real bell from a preview would be a surprise. */
  readOnly?: boolean
}) {
  const router = useRouter()
  const { showToast } = useToast()

  const [tab, setTab] = useState<Tab>('all')
  const [state, setState] = useState<LoadState>('loading')
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [kinds, setKinds] = useState<NotificationKind[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  // One "now" per read, stamped when the rows land, so every relative
  // timestamp on the page agrees with every other one instead of each row
  // calling Date.now() and drifting.
  const [now, setNow] = useState(() => Date.now())

  // Frozen at mount so paging cannot walk over the boundary as the clock moves.
  const windowStart = useRef(new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString())

  const buildQuery = useCallback((next: string | null) => {
    const q = new URLSearchParams()
    q.set('limit', String(PAGE_SIZE))
    if (next) q.set('cursor', next)
    if (tab === 'past') q.set('before', windowStart.current)
    else q.set('since', windowStart.current)
    if (kinds.length) q.set('kind', kinds.join(','))
    if (unreadOnly) q.set('unread', 'true')
    return q.toString()
  }, [tab, kinds, unreadOnly])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch(apiPath(`/api/notifications?${buildQuery(null)}`))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as {
        items?: NotificationRow[]
        unreadCount?: number
        nextCursor?: string | null
        hasMore?: boolean
      }
      setNow(Date.now())
      setRows(json.items ?? [])
      setUnreadCount(json.unreadCount ?? 0)
      setCursor(json.nextCursor ?? null)
      setHasMore(!!json.hasMore)
      setState('ready')
    } catch {
      setRows([])
      setState('error')
    }
  }, [buildQuery])

  useEffect(() => { load().catch(() => {}) }, [load])

  // This page deliberately does NOT listen for NOTIFICATIONS_CHANGED_EVENT: it
  // fires the event itself on every read, and reloading on its own dispatch
  // would throw away the pages the reader has already loaded.

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(apiPath(`/api/notifications?${buildQuery(cursor)}`))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as {
        items?: NotificationRow[]
        nextCursor?: string | null
        hasMore?: boolean
      }
      setRows(prev => {
        const seen = new Set(prev.map(r => r.id))
        return prev.concat((json.items ?? []).filter(r => !seen.has(r.id)))
      })
      setCursor(json.nextCursor ?? null)
      setHasMore(!!json.hasMore)
    } catch {
      showToast('Could not load older notifications', 'error')
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, buildQuery, showToast])

  const markRead = useCallback(async (id: string) => {
    if (readOnly) return
    setRows(prev => prev.map(r => r.id === id ? { ...r, read: true } : r))
    setUnreadCount(prev => Math.max(0, prev - 1))
    try {
      await fetch(apiPath('/api/notifications'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      notifyNotificationsChanged()
    } catch {
      // The row is already drawn read; a refresh corrects it either way.
    }
  }, [readOnly])

  const openRow = useCallback((n: NotificationRow) => {
    const dest = notificationDestination(n.entityType, n.entityId, audience)
    if (!n.read) markRead(n.id).catch(() => {})
    if (dest) router.push(dest.href)
  }, [audience, markRead, router])

  const markAll = useCallback(async () => {
    if (readOnly) return
    setMarkingAll(true)
    try {
      await fetch(apiPath('/api/notifications'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Narrowed to the lens the reader is actually looking through, so
        // "Mark all as read" never silently empties rows they cannot see.
        body: JSON.stringify({ all: true, kinds: kinds.length ? kinds : undefined }),
      })
      setRows(prev => prev.map(r => ({ ...r, read: true })))
      setUnreadCount(0)
      notifyNotificationsChanged()
      showToast('All caught up', 'success')
    } catch {
      showToast('Could not mark those as read', 'error')
    } finally {
      setMarkingAll(false)
    }
  }, [readOnly, kinds, showToast])

  const switchTab = useCallback((next: Tab) => {
    if (next === tab) return
    setTab(next)
    setRows([])
    setCursor(null)
    setHasMore(false)
  }, [tab])

  const toggleKind = useCallback((k: NotificationKind) => {
    setKinds(prev => prev.includes(k) ? prev.filter(x => x !== k) : prev.concat([k]))
  }, [])

  const clearFilters = useCallback(() => { setKinds([]); setUnreadOnly(false) }, [])

  // Chips: the audience's kinds, plus any kind actually present in the loaded
  // rows that is not on that list, so no row is unreachable by filter.
  const kindDefs: NotificationKindDef[] = useMemo(() => {
    const base = notificationKindsFor(audience)
    const known = new Set(base.map(k => k.key))
    const extra: NotificationKindDef[] = []
    for (const r of rows) {
      const k = notificationKind(r.entityType)
      if (!known.has(k)) { known.add(k); extra.push(NOTIFICATION_KINDS[k]) }
    }
    return base.concat(extra)
  }, [audience, rows])

  const counts = useMemo(() => {
    const o: Partial<Record<NotificationKind, number>> = {}
    for (const r of rows) {
      const k = notificationKind(r.entityType)
      o[k] = (o[k] ?? 0) + 1
    }
    return o
  }, [rows])

  const groups = useMemo(() => {
    const out: { label: string; rows: NotificationRow[] }[] = []
    let cur: { label: string; rows: NotificationRow[] } | null = null
    for (const r of rows) {
      const label = tab === 'past' ? monthLabel(r.createdAt) : dayLabel(r.createdAt, now)
      if (!cur || cur.label !== label) { cur = { label, rows: [] }; out.push(cur) }
      cur.rows.push(r)
    }
    return out
  }, [rows, tab, now])

  const anyFilter = kinds.length > 0 || unreadOnly
  const countsKnown = state === 'ready'
  const showFilters = countsKnown && (rows.length > 0 || anyFilter)
  const sub = audience === 'client'
    ? 'Everything the studio has told you, newest first. The bell only holds the last few.'
    : 'Everything the studio has flagged for you, newest first. The bell only holds the last few.'

  let body: React.ReactNode
  if (state === 'loading') {
    body = (
      <div className="pa-nlist-wrap">
        <Skeleton rows={6} />
        <p className="pa-loadnote" role="status">Loading your notifications</p>
      </div>
    )
  } else if (state === 'error') {
    body = (
      <div className="pa-errcard" role="alert">
        <span className="pa-errcard-ic"><ShellIcon n="bell" s={18} /></span>
        <span className="pa-errcard-t">
          <b>We could not load your notifications.</b>
          <small>Nothing is lost. Try again in a moment.</small>
        </span>
        <button type="button" className="pa-btn quiet tahi-focus-ring" onClick={() => { load().catch(() => {}) }}>
          Try again
        </button>
      </div>
    )
  } else if (rows.length === 0 && anyFilter) {
    body = (
      <div className="pa-empty">
        <span className="pa-empty-ic"><ShellIcon n="bell" s={22} /></span>
        <h2>Nothing matches those filters.</h2>
        <p>Try another kind, or turn off unread only.</p>
        <span className="pa-empty-a">
          <button type="button" className="pa-btn quiet tahi-focus-ring" onClick={clearFilters}>Clear filters</button>
        </span>
      </div>
    )
  } else if (rows.length === 0) {
    body = (
      <div className="pa-empty">
        <span className="pa-empty-ic">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 4c-8 0-14 4-15 12 0 3 1 4 3 4 8-1 12-7 12-16z" />
            <path d="M5 20c3-6 7-9 11-11" />
          </svg>
        </span>
        <h2>You are all caught up.</h2>
        <p>
          {tab === 'past'
            ? 'Nothing older than thirty days yet. Anything that ages out of All lands here.'
            : audience === 'client'
              ? 'When the studio moves a request, replies, or sends an invoice, it lands here.'
              : 'When work needs triage, a client replies, or money moves, it lands here.'}
        </p>
        <span className="pa-empty-a">
          <button
            type="button"
            className="pa-btn leaf primary tahi-focus-ring"
            onClick={() => router.push(audience === 'client' ? '/overview' : '/requests')}
          >
            {audience === 'client' ? 'Back to your overview' : 'Go to requests'}
          </button>
        </span>
      </div>
    )
  } else {
    body = (
      <div className="pa-nlist-wrap">
        {groups.map(g => (
          <div className="pa-ngroup" key={g.label}>
            <div className="pa-gh">
              <span className="pa-gh-l">{g.label}</span>
              <span className="pa-gh-n">{g.rows.length}</span>
            </div>
            <ul className="pa-nlist">
              {g.rows.map(n => (
                <NotifRow
                  key={n.id}
                  n={n}
                  now={now}
                  kind={NOTIFICATION_KINDS[notificationKind(n.entityType)]}
                  dest={notificationDestination(n.entityType, n.entityId, audience)}
                  onOpen={openRow}
                  onRead={(id) => { markRead(id).catch(() => {}) }}
                  readOnly={readOnly}
                />
              ))}
            </ul>
          </div>
        ))}
        {hasMore ? (
          <div className="pa-foot">
            <button
              type="button"
              className="pa-btn quiet tahi-focus-ring"
              onClick={() => { loadOlder().catch(() => {}) }}
              disabled={loadingMore}
            >
              <span className="pa-btn-ic"><ShellIcon n="chevron" s={15} /></span>
              {loadingMore ? 'Loading' : 'Load older'}
            </button>
          </div>
        ) : (
          <p className="pa-endcap">
            {tab === 'past'
              ? 'That is everything we have kept. Older than that, ask us and we will dig it out.'
              : 'That is the last thirty days. Anything older sits under Past.'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="pa">
      <div className="pa-pad">
        {readOnly && (
          <div className="pa-ro" role="status">
            <span className="pa-ro-ic"><ShellIcon n="impersonate" s={15} /></span>
            You are previewing the portal. This is your own notification history, and it is read-only here.
          </div>
        )}

        <div className="pa-head">
          <div>
            <h1 className="pa-h1">Notifications</h1>
            <p className="pa-sub">{sub}</p>
          </div>
          <div className="pa-head-a">
            <button
              type="button"
              className="pa-btn quiet tahi-focus-ring"
              onClick={() => router.push('/settings?section=notifications')}
            >
              <span className="pa-btn-ic"><ShellIcon n="settings" s={15} /></span>
              Email preferences
            </button>
          </div>
        </div>

        {/* The read-state lens and Clear stay in the toolbar, which never
            scrolls sideways; only the kind filters sit in the chip row. */}
        <div className="pa-bar">
          <div
            className="pa-seg"
            role="tablist"
            aria-label="Notification history"
            style={{ ['--pa-seg-n' as string]: 2, ['--pa-seg-i' as string]: tab === 'past' ? 1 : 0 }}
          >
            <span className="pa-seg-pill" aria-hidden="true" />
            {(['all', 'past'] as Tab[]).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={'pa-seg-b tahi-focus-ring' + (tab === t ? ' on' : '')}
                onClick={() => switchTab(t)}
              >
                {t === 'all' ? 'All' : 'Past'}
              </button>
            ))}
          </div>

          <span className="pa-count" aria-live="polite">
            {state === 'loading'
              ? 'Loading'
              : state === 'error'
                ? 'Could not load'
                : `${rows.length}${hasMore ? '+' : ''} ${rows.length === 1 && !hasMore ? 'notification' : 'notifications'}${unreadCount ? ` · ${unreadCount} unread` : ''}`}
          </span>

          {showFilters && (
            <button
              type="button"
              className={'pa-chip tahi-focus-ring' + (unreadOnly ? ' on' : '')}
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly(v => !v)}
            >
              <span className="pa-chip-ic"><ShellIcon n="bell" s={13} /></span>
              Unread only
            </button>
          )}
          {showFilters && anyFilter && (
            <button type="button" className="pa-clear tahi-focus-ring" onClick={clearFilters}>Clear filters</button>
          )}

          <span className="pa-bar-sp" />

          {showFilters && unreadCount > 0 && (
            <button
              type="button"
              className="pa-btn quiet tahi-focus-ring"
              onClick={() => { markAll().catch(() => {}) }}
              disabled={readOnly || markingAll}
              title={readOnly ? 'Read-only in client view' : undefined}
            >
              <span className="pa-btn-ic"><ShellIcon n="checks" s={15} /></span>
              {markingAll ? 'Marking' : 'Mark all as read'}
            </button>
          )}
        </div>

        {showFilters && (
          <div className="pa-chips" role="group" aria-label="Filter by kind">
            <button
              type="button"
              className={'pa-chip tahi-focus-ring' + (kinds.length === 0 ? ' on' : '')}
              aria-pressed={kinds.length === 0}
              onClick={() => setKinds([])}
            >
              All kinds
            </button>
            {kindDefs.map(k => (
              <button
                key={k.key}
                type="button"
                className={'pa-chip tahi-focus-ring' + (kinds.includes(k.key) ? ' on' : '')}
                aria-pressed={kinds.includes(k.key)}
                onClick={() => toggleKind(k.key)}
              >
                <span className="pa-chip-ic"><ShellIcon n={k.icon} s={13} /></span>
                {k.label}
                {counts[k.key] ? <span className="pa-chip-n">{counts[k.key]}</span> : null}
              </button>
            ))}
          </div>
        )}

        {body}
      </div>
    </div>
  )
}
