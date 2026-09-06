'use client'

/**
 * /notifications : the full history behind the bell, for both audiences.
 *
 * Ported from the Claude Design module portal-account.jsx (Notifications).
 * Companion stylesheet: app/(dashboard)/notifications/notifications.css (all
 * `.pa-*` classes). The frame is <RailLayout>, the same one Requests, Clients
 * and Tasks stand on, so a filter rail reads identically everywhere.
 *
 * The five decisions that shape this page:
 *
 *  - VIEWS, NOT LENSES. All / Unread / Past are three mutually exclusive
 *    rooms in the rail. The previous reading had a Past tab AND an unread
 *    chip, which is four states drawn as two controls, and no way to tell
 *    from the page which of them you were in.
 *  - THE COUNTS ARE THE SERVER'S. `?facets=true` returns row totals per view
 *    and per kind over the window, so a kind that is real but absent from
 *    page one is not drawn as an empty, unpressable one. Counting the loaded
 *    rows could only ever describe the loaded rows.
 *  - HONEST DEEP LINKS. lib/notification-links.ts returns null for a client on
 *    documents, tasks, calls and deals. Rather than render a link that bounces
 *    them, those rows are drawn as a statement ("Nothing to open yet") with no
 *    button wrapper, so the row is not clickable at all.
 *  - OPENING A ROW MARKS IT READ, then navigates. Today only the request detail
 *    page clears the bell, so an invoice or announcement stays unread forever.
 *    Doing it on the row closes that hole without touching every destination.
 *  - EMAIL PREFERENCES IS A DESTINATION, not a page action: the rail's foot on
 *    a desk, and a card at the end of the feed on a phone, where the rail has
 *    folded into the Filters sheet.
 *
 * Filters are by KIND, not by the 30 internal event types, which are a
 * vocabulary no client should meet.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiPath } from '@/lib/api'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { PageHeader } from '@/components/tahi/page-header'
import { useToast } from '@/components/tahi/toast'
import { notifyNotificationsChanged } from '@/lib/notification-events'
import { RailLayout } from '@/components/tahi/rail/rail-layout'
import type { RailFilterChip } from '@/components/tahi/rail/rail-controls'
import {
  NotificationsRail,
  NOTIFICATION_VIEWS,
  type NotificationView,
  type NotificationViewCounts,
} from '@/components/tahi/notifications/notifications-rail'
import {
  notificationKind,
  notificationKindsFor,
  notificationDestination,
  NOTIFICATION_KINDS,
  type NotificationAudience,
  type NotificationFacets,
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

type LoadState = 'loading' | 'ready' | 'error'

interface FeedResponse {
  items?: NotificationRow[]
  unreadCount?: number
  nextCursor?: string | null
  hasMore?: boolean
  facets?: NotificationFacets
}

/** All and Unread are the last thirty days; Past is everything older. */
const WINDOW_DAYS = 30
const PAGE_SIZE = 20

/**
 * Email preferences, for both audiences.
 *
 * The studio reads it as the settings Notifications section; a client reads
 * the same section as the Notifications room of their own account, because
 * that section is `audience: 'both'` and sits in the Account group of
 * components/tahi/settings/settings-shell.tsx. One destination, two readings,
 * and no second route to keep in step.
 */
const PREFS_HREF = '/settings?section=notifications'

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

/** The phone's Views control. The rail is inside the Filters sheet below
 *  1024px, and three one-word rooms do not deserve a trip into a sheet. */
function ViewTrack({
  view, counts, onChange,
}: {
  view: NotificationView
  counts: NotificationViewCounts | null
  onChange: (next: NotificationView) => void
}) {
  const index = NOTIFICATION_VIEWS.findIndex(v => v.key === view)
  return (
    <div
      className="pa-seg pa-seg-fill"
      role="group"
      aria-label="Notification views"
      style={{
        ['--pa-seg-n' as string]: NOTIFICATION_VIEWS.length,
        ['--pa-seg-i' as string]: index < 0 ? 0 : index,
      }}
    >
      <span className="pa-seg-pill" aria-hidden="true" />
      {NOTIFICATION_VIEWS.map(v => (
        <button
          key={v.key}
          type="button"
          aria-pressed={view === v.key}
          className={'pa-seg-b tahi-focus-ring' + (view === v.key ? ' on' : '')}
          onClick={() => onChange(v.key)}
        >
          {v.label}
          {counts ? <span className="pa-seg-n">{counts[v.key]}</span> : null}
        </button>
      ))}
    </div>
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

  const [view, setView] = useState<NotificationView>('all')
  const [state, setState] = useState<LoadState>('loading')
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [facets, setFacets] = useState<NotificationFacets | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [kinds, setKinds] = useState<NotificationKind[]>([])
  const [markingAll, setMarkingAll] = useState(false)

  // One "now" per read, stamped when the rows land, so every relative
  // timestamp on the page agrees with every other one instead of each row
  // calling Date.now() and drifting.
  const [now, setNow] = useState(() => Date.now())

  // Frozen at mount so paging cannot walk over the boundary as the clock moves.
  const windowStart = useRef(new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString())

  /** The window half this view reads, which is also the boundary the facet
   *  counts are taken around. Past is everything older than it. */
  const applyWindow = useCallback((q: URLSearchParams, forView: NotificationView) => {
    if (forView === 'past') q.set('before', windowStart.current)
    else q.set('since', windowStart.current)
    if (forView === 'unread') q.set('unread', 'true')
  }, [])

  const buildQuery = useCallback((next: string | null) => {
    const q = new URLSearchParams()
    q.set('limit', String(PAGE_SIZE))
    if (next) q.set('cursor', next)
    applyWindow(q, view)
    if (kinds.length) q.set('kind', kinds.join(','))
    // Only the first page of a read pays for the counts. Paging older rows
    // cannot change them.
    if (!next) q.set('facets', 'true')
    return q.toString()
  }, [applyWindow, view, kinds])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch(apiPath(`/api/notifications?${buildQuery(null)}`))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as FeedResponse
      setNow(Date.now())
      setRows(json.items ?? [])
      setUnreadCount(json.unreadCount ?? 0)
      if (json.facets) setFacets(json.facets)
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

  /** Re-take the counts without disturbing the rows on screen. One row of
   *  body, two grouped counts. */
  const refreshCounts = useCallback(async () => {
    const q = new URLSearchParams()
    q.set('limit', '1')
    q.set('facets', 'true')
    // The unfiltered window, so the rail can still say what the other kinds
    // and the other views hold.
    applyWindow(q, view === 'unread' ? 'all' : view)
    try {
      const res = await fetch(apiPath(`/api/notifications?${q.toString()}`))
      if (!res.ok) return
      const json = await res.json() as FeedResponse
      setUnreadCount(json.unreadCount ?? 0)
      if (json.facets) setFacets(json.facets)
    } catch {
      // The optimistic figures stand until the next read.
    }
  }, [applyWindow, view])

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(apiPath(`/api/notifications?${buildQuery(cursor)}`))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as FeedResponse
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
    // The row stays where it is, even on the Unread view: pulling it out from
    // under the cursor the moment it is read is how a list loses its place.
    setRows(prev => prev.map(r => r.id === id ? { ...r, read: true } : r))
    setUnreadCount(prev => Math.max(0, prev - 1))
    setFacets(prev => {
      if (!prev) return prev
      const row = rows.find(r => r.id === id)
      if (!row || row.read) return prev
      const kind = notificationKind(row.entityType)
      const unread = { ...prev.kinds.unread, [kind]: Math.max(0, (prev.kinds.unread[kind] ?? 0) - 1) }
      return {
        views: { ...prev.views, unread: Math.max(0, prev.views.unread - 1) },
        kinds: { ...prev.kinds, unread },
      }
    })
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
  }, [readOnly, rows])

  const openRow = useCallback((n: NotificationRow) => {
    const dest = notificationDestination(n.entityType, n.entityId, audience)
    if (!n.read) markRead(n.id).catch(() => {})
    if (dest) router.push(dest.href)
  }, [audience, markRead, router])

  const markAll = useCallback(async () => {
    if (readOnly) return
    // Narrowed to the lens the reader is actually looking through, so "Mark all
    // as read" never silently empties rows they cannot see: by kind, and on the
    // Past view by the same `before` boundary the list itself is paging under.
    const before = view === 'past' ? windowStart.current : undefined
    const narrowed = kinds.length > 0 || view === 'past'
    setMarkingAll(true)
    try {
      await fetch(apiPath('/api/notifications'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, kinds: kinds.length ? kinds : undefined, before }),
      })
      setRows(prev => prev.map(r => ({ ...r, read: true })))
      notifyNotificationsChanged()
      showToast(narrowed ? 'Marked those as read' : 'All caught up', 'success')
      // The server may have cleared rows this page never loaded, so take the
      // true numbers rather than guessing at them. A narrowed pass leaves
      // unread rows of other kinds standing, and claiming zero there would put
      // this page and the bell (which counts the same table) at odds.
      await refreshCounts()
    } catch {
      showToast('Could not mark those as read', 'error')
    } finally {
      setMarkingAll(false)
    }
  }, [readOnly, kinds, view, showToast, refreshCounts])

  const switchView = useCallback((next: NotificationView) => {
    if (next === view) return
    // Straight to loading, not through a frame of "you are all caught up":
    // clearing the rows before the read lands would flash the empty state.
    setState('loading')
    setView(next)
    setRows([])
    setCursor(null)
    setHasMore(false)
  }, [view])

  const toggleKind = useCallback((k: NotificationKind) => {
    setKinds(prev => prev.includes(k) ? prev.filter(x => x !== k) : prev.concat([k]))
  }, [])

  const clearFilters = useCallback(() => { setKinds([]) }, [])

  // The audience's kinds, plus any kind the server counted in this window that
  // is not on that list, so no row is unreachable by filter. The day a
  // client-visible document surface exists, the row comes back on its own.
  const kindDefs: NotificationKindDef[] = useMemo(() => {
    const base = notificationKindsFor(audience)
    const known = new Set(base.map(k => k.key))
    if (!facets) return base
    const extra: NotificationKindDef[] = []
    for (const key of Object.keys(NOTIFICATION_KINDS) as NotificationKind[]) {
      if (known.has(key)) continue
      const seen = facets.kinds.all[key] + facets.kinds.past[key]
      if (seen > 0) extra.push(NOTIFICATION_KINDS[key])
    }
    return base.concat(extra)
  }, [audience, facets])

  const kindCounts = useMemo(
    () => (facets ? facets.kinds[view] : null),
    [facets, view],
  )
  const viewCounts: NotificationViewCounts | null = facets ? facets.views : null

  const groups = useMemo(() => {
    const out: { label: string; rows: NotificationRow[] }[] = []
    let cur: { label: string; rows: NotificationRow[] } | null = null
    for (const r of rows) {
      const label = view === 'past' ? monthLabel(r.createdAt) : dayLabel(r.createdAt, now)
      if (!cur || cur.label !== label) { cur = { label, rows: [] }; out.push(cur) }
      cur.rows.push(r)
    }
    return out
  }, [rows, view, now])

  // The counted total for this lens, from the server rather than from the page
  // in hand, so the count line and the sheet's "Show N" mean the same thing as
  // the rail. The old page could only say "20+".
  //
  // On the Unread view this drops by one each time a row is ticked while the
  // row itself stays put, so the number can sit one under the rows on screen
  // for a moment. That is the honest pair: the count is how many are unread,
  // the list is what it loaded, and pulling a row out from under the cursor
  // the instant it is read is the worse of the two behaviours.
  const total = useMemo(() => {
    if (!kindCounts || !viewCounts) return rows.length
    if (!kinds.length) return viewCounts[view]
    return kinds.reduce((n, k) => n + (kindCounts[k] ?? 0), 0)
  }, [kindCounts, viewCounts, kinds, view, rows.length])

  const chips: RailFilterChip[] = useMemo(
    () => kinds.map(k => ({ key: `kind:${k}`, dimension: 'Kind', label: NOTIFICATION_KINDS[k].label })),
    [kinds],
  )

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
  } else if (rows.length === 0 && kinds.length > 0) {
    body = (
      <div className="pa-empty">
        <span className="pa-empty-ic"><ShellIcon n="bell" s={22} /></span>
        <h2>Nothing matches those kinds.</h2>
        <p>Try another kind, or clear the filters and start again.</p>
        <span className="pa-empty-a">
          <button type="button" className="pa-btn quiet tahi-focus-ring" onClick={clearFilters}>Clear filters</button>
        </span>
      </div>
    )
  } else if (rows.length === 0 && view === 'unread') {
    body = (
      <div className="pa-empty">
        <span className="pa-empty-ic"><ShellIcon n="checks" s={22} /></span>
        <h2>Nothing unread.</h2>
        <p>Everything the studio has sent you has been read.</p>
        <span className="pa-empty-a">
          <button
            type="button"
            className="pa-btn quiet tahi-focus-ring"
            onClick={() => switchView('all')}
          >
            Show everything
          </button>
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
          {view === 'past'
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
            {view === 'past'
              ? 'That is everything we have kept. Older than that, ask us and we will dig it out.'
              : 'That is the last thirty days. Anything older sits under Past.'}
          </p>
        )}
      </div>
    )
  }

  const railProps = {
    view,
    onViewChange: switchView,
    viewCounts,
    kindDefs,
    kindCounts,
    kinds,
    onToggleKind: toggleKind,
    onClearFilters: clearFilters,
    prefsHref: PREFS_HREF,
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

        <PageHeader title="Notifications" subtitle={sub} />

        <RailLayout
          rail={<NotificationsRail {...railProps} />}
          railTouch={<NotificationsRail {...railProps} variant="sheet" touch />}
          railLabel="Views and kinds"
          sheetTitle="Filters"
          switcher={<ViewTrack view={view} counts={viewCounts} onChange={switchView} />}
          chips={chips}
          onClearChip={chip => toggleKind(chip.key.slice('kind:'.length) as NotificationKind)}
          onClearAll={clearFilters}
          total={total}
          itemNoun="notification"
          loading={state === 'loading'}
          trailing={unreadCount > 0 ? (
            <button
              type="button"
              className="pa-btn quiet tahi-focus-ring"
              onClick={() => { markAll().catch(() => {}) }}
              disabled={readOnly || markingAll || state !== 'ready'}
              title={readOnly ? 'Read-only in client view' : undefined}
            >
              <span className="pa-btn-ic"><ShellIcon n="checks" s={15} /></span>
              {markingAll ? 'Marking' : 'Mark all as read'}
            </button>
          ) : undefined}
        >
          {body}

          {/* A phone has no rail to hold Email preferences, so it lands at the
              end of the feed instead. Hidden from lg up, where the rail's own
              foot carries it. */}
          {state === 'ready' && (
            <Link href={PREFS_HREF} className="pa-nprefs tahi-focus-ring">
              <span className="pa-nprefs-ic"><ShellIcon n="settings" s={16} /></span>
              <span className="pa-nprefs-t">
                <b>Email preferences</b>
                <small>Choose what lands in your inbox and what stays in the bell.</small>
              </span>
              <span className="pa-nprefs-go"><ShellIcon n="arrow" s={16} /></span>
            </Link>
          )}
        </RailLayout>
      </div>
    </div>
  )
}
