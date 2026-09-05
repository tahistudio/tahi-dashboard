/**
 * The pure vocabulary behind the Clients rail: two peer views, five saved
 * views, six filter dimensions, six sort keys, and the shapes persisted per
 * user. Structural twin of lib/tasks-views.ts and lib/requests-views.ts,
 * deliberately a separate file rather than a shared generic: the surfaces
 * share a shape, not a vocabulary.
 *
 * Everything is a plain function over plain data so it runs in the node
 * Vitest environment. Nothing here fetches, and nothing here knows about
 * React.
 *
 * One rule is load-bearing and lives here rather than in the page: an
 * archived client is out of every view except Archived. The list endpoint
 * only returns archived rows when it is asked for them, so the page fetches
 * both buckets and this module decides which of them a view is allowed to
 * see. Without that, the Archived rail count would read zero whenever the
 * user was standing anywhere else.
 */

import { resolveTracksConfig, type TracksMode } from '@/lib/plan-utils'

// -- Row shape ---------------------------------------------------------------

export type ClientEngagement = 'retainer' | 'project' | 'hourly' | 'none'

export interface ClientTracks {
  mode: TracksMode
  small: number
  large: number
  total: number
}

/**
 * The account owner: the team member holding a `project_manager` access rule
 * linked to this client. Exactly what GET /api/admin/clients/[id]/pm resolves,
 * read once for the whole roster rather than once per row.
 */
export interface ClientOwner {
  id: string
  name: string
}

/** The subset of an organisation the rail reasons about, after the raw API
 *  row has had its JSON columns parsed and its plan resolved. */
export interface ClientRow {
  id: string
  name: string
  website: string | null
  industry: string | null
  status: string
  planType: string | null
  healthStatus: string | null
  healthNote: string | null
  openRequestCount: number
  createdAt: string | null
  updatedAt: string | null
  /** Free-form studio labels, parsed out of the organisations.tags JSON. */
  tags: string[]
  /** How many brands sit under this client, from the brands JSON column. */
  brandCount: number
  tracks: ClientTracks
  engagement: ClientEngagement
  /**
   * Monthly recurring revenue in NZD, or null when it is not known. The
   * clients list endpoint cannot return it (customMrr is deliberately absent
   * from db/schema.ts), so the page fills this in from the retainer-health
   * read when the viewer is allowed to see money, and leaves it null
   * otherwise. Null renders as the engagement word, never as a dash.
   */
  mrrNzd: number | null
  /** The account owner's team member id, or null when nobody holds this
   *  client. Null is also what an unreadable owner source leaves behind, so
   *  the cell states which of the two it is rather than guessing. */
  ownerId: string | null
  ownerName: string | null
}

/** The raw shape the clients list endpoint returns. Every field is optional
 *  on purpose: this is parsed at the boundary, not trusted. */
export interface ClientApiRow {
  id: string
  name: string
  website?: string | null
  industry?: string | null
  status?: string | null
  planType?: string | null
  healthStatus?: string | null
  healthNote?: string | null
  openRequestCount?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  tags?: string | null
  brands?: string | null
  tracksMode?: string | null
  customSmallTracks?: number | null
  customLargeTracks?: number | null
}

const PLAN_ENGAGEMENT: Record<string, ClientEngagement> = {
  maintain: 'retainer',
  scale: 'retainer',
  tune: 'project',
  launch: 'project',
  // The repo's own copy calls this one "Custom project", so it reads as a
  // project here too rather than quietly joining the retainer counts.
  custom: 'project',
  hourly: 'hourly',
}

export function engagementOf(planType: string | null): ClientEngagement {
  if (!planType) return 'none'
  return PLAN_ENGAGEMENT[planType] ?? 'none'
}

export const ENGAGEMENT_LABEL: Record<ClientEngagement, string> = {
  retainer: 'Retainer',
  project: 'Project',
  hourly: 'Hourly',
  none: 'No plan',
}

/** A JSON text column that should hold an array of strings. Anything else in
 *  it is treated as empty rather than thrown, because one bad row must not
 *  take the list down. */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  } catch {
    return []
  }
}

/**
 * Turn one API row into the row the rail reads. `hasPrioritySupport` is not
 * on the list payload (it lives on the subscription), so the auto-mode track
 * shape here is the plan's base entitlement. The meter says "configured", not
 * "in use", for exactly that reason.
 */
export function toClientRow(
  raw: ClientApiRow,
  mrrNzd: number | null = null,
  owner: ClientOwner | null = null,
): ClientRow {
  const planType = raw.planType && raw.planType !== 'none' ? raw.planType : null
  const config = resolveTracksConfig(
    {
      tracksMode: raw.tracksMode ?? null,
      customSmallTracks: raw.customSmallTracks ?? null,
      customLargeTracks: raw.customLargeTracks ?? null,
    },
    planType,
    false,
  )
  return {
    id: raw.id,
    name: raw.name,
    website: raw.website ?? null,
    industry: raw.industry ?? null,
    status: raw.status ?? 'active',
    planType,
    healthStatus: raw.healthStatus ?? null,
    healthNote: raw.healthNote ?? null,
    openRequestCount: raw.openRequestCount ?? 0,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    tags: parseStringArray(raw.tags),
    brandCount: parseStringArray(raw.brands).length,
    tracks: {
      mode: config.mode,
      small: config.smallTracks,
      large: config.largeTracks,
      total: config.smallTracks + config.largeTracks,
    },
    engagement: engagementOf(planType),
    mrrNzd,
    ownerId: owner?.id ?? null,
    ownerName: owner?.name ?? null,
  }
}

// -- Health ------------------------------------------------------------------

/** Stored values are green | amber | red | null. `none` is what null reads
 *  as everywhere a key is needed. */
export const CLIENT_HEALTH_KEYS = ['red', 'amber', 'green', 'none'] as const
export type ClientHealthKey = (typeof CLIENT_HEALTH_KEYS)[number]

export const CLIENT_HEALTH_LABELS: Record<ClientHealthKey, string> = {
  red: 'At risk',
  amber: 'Watch',
  green: 'Healthy',
  none: 'Not scored',
}

export function healthKeyOf(row: Pick<ClientRow, 'healthStatus'>): ClientHealthKey {
  const raw = row.healthStatus
  return raw === 'red' || raw === 'amber' || raw === 'green' ? raw : 'none'
}

/**
 * The lines behind the health badge. The prototype had a `reasons` array on
 * the account; the repo has no such column, so this states only what the row
 * actually carries. An empty result means no tooltip, never an empty bubble.
 */
export function healthReasons(row: ClientRow): string[] {
  const out: string[] = []
  if (row.healthNote) out.push(row.healthNote)
  if (row.status === 'paused') out.push('The engagement is paused.')
  if (row.status === 'churned') out.push('This client has churned.')
  if (row.status === 'archived') out.push('Archived, and out of the working list.')
  if (row.engagement === 'retainer' && row.openRequestCount === 0) {
    out.push('A retainer with nothing open in the studio.')
  }
  if (row.openRequestCount > 0) {
    out.push(`${row.openRequestCount} open ${row.openRequestCount === 1 ? 'request' : 'requests'}.`)
  }
  if (!row.planType) out.push('No plan set, so nothing is being billed on a cycle.')
  return out
}

// -- Statuses ----------------------------------------------------------------

export const CLIENT_STATUSES = ['active', 'paused', 'churned', 'archived'] as const

export const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  churned: 'Churned',
  archived: 'Archived',
  prospect: 'Prospect',
}

export function isClientStatus(value: unknown): value is string {
  return typeof value === 'string' && (CLIENT_STATUSES as readonly string[]).includes(value)
}

// -- Plans -------------------------------------------------------------------

export const CLIENT_PLANS: readonly { value: string; label: string }[] = [
  { value: 'maintain', label: 'Maintain' },
  { value: 'scale', label: 'Scale' },
  { value: 'tune', label: 'Tune' },
  { value: 'launch', label: 'Launch' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'custom', label: 'Custom project' },
  { value: 'none', label: 'No plan' },
]

// -- Views -------------------------------------------------------------------

export type ClientsViewKey = 'list' | 'cards'

export const CLIENTS_VIEW_KEYS: readonly ClientsViewKey[] = ['list', 'cards']

export function normaliseClientsViewKey(value: unknown): ClientsViewKey {
  return (CLIENTS_VIEW_KEYS as readonly unknown[]).includes(value)
    ? (value as ClientsViewKey)
    : 'list'
}

// -- Saved views -------------------------------------------------------------

export interface ClientsSavedView {
  key: string
  label: string
  test: (row: ClientRow) => boolean
}

export const ARCHIVED_VIEW_KEY = 'archived'

export const CLIENTS_SAVED_VIEWS: readonly ClientsSavedView[] = [
  { key: 'retainers', label: 'Active retainers', test: r => r.status === 'active' && r.engagement === 'retainer' },
  { key: 'projects', label: 'Projects', test: r => r.engagement === 'project' || r.engagement === 'hourly' },
  { key: 'at_risk', label: 'At risk', test: r => healthKeyOf(r) === 'red' },
  { key: 'paused', label: 'Paused', test: r => r.status === 'paused' },
  { key: ARCHIVED_VIEW_KEY, label: 'Archived', test: r => r.status === 'archived' },
]

export function matchesClientsSavedView(row: ClientRow, key: string | null): boolean {
  if (!key) return true
  const view = CLIENTS_SAVED_VIEWS.find(v => v.key === key)
  return view ? view.test(row) : true
}

/**
 * True when the current view is one that is allowed to show archived rows.
 * Everything else hides them, which is the same rule the endpoint applies
 * server side.
 */
export function showsArchived(savedView: string | null, filters: ClientsFilters): boolean {
  return savedView === ARCHIVED_VIEW_KEY || filters.status === 'archived'
}

/** Live counts for the rail: one per saved view, plus `__all`. Archived rows
 *  count towards Archived and nothing else. */
export function countClientsSavedViews(rows: readonly ClientRow[]): Record<string, number> {
  const live = rows.filter(r => r.status !== 'archived')
  const counts: Record<string, number> = { __all: live.length }
  for (const view of CLIENTS_SAVED_VIEWS) {
    const source = view.key === ARCHIVED_VIEW_KEY ? rows : live
    let n = 0
    for (const row of source) if (view.test(row)) n += 1
    counts[view.key] = n
  }
  return counts
}

// -- Filters -----------------------------------------------------------------

export interface ClientsFilters {
  status: string
  plan: string
  health: string
  owner: string
  tag: string
  tracks: string
}

export const CLIENT_FILTER_KEYS = ['status', 'plan', 'health', 'owner', 'tag', 'tracks'] as const
export type ClientFilterKey = (typeof CLIENT_FILTER_KEYS)[number]

export const DEFAULT_CLIENT_FILTERS: ClientsFilters = {
  status: 'all',
  plan: 'all',
  health: 'all',
  owner: 'all',
  tag: 'all',
  tracks: 'all',
}

export const CLIENT_DIMENSION_LABELS: Record<ClientFilterKey, string> = {
  status: 'Status',
  plan: 'Plan',
  health: 'Health',
  owner: 'Owner',
  tag: 'Tag',
  tracks: 'Tracks',
}

/** The Owner option for "nobody holds this account". A real team member id can
 *  never collide with it: ids are UUIDs. */
export const UNASSIGNED_OWNER = 'unassigned'

/**
 * The track dimension. The prototype filtered on live track occupancy; the
 * list payload carries the client's track CONFIGURATION and not what is
 * sitting on each track right now, so the options say configuration.
 */
export const CLIENT_TRACK_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'all', label: 'Any tracks' },
  { value: 'some', label: 'Has tracks' },
  { value: 'custom', label: 'Custom track counts' },
  { value: 'off', label: 'Tracks turned off' },
  { value: 'none', label: 'No tracks' },
]

export function isClientFilterActive(filters: ClientsFilters, key: ClientFilterKey): boolean {
  return filters[key] !== DEFAULT_CLIENT_FILTERS[key]
}

export function anyClientFilterActive(filters: ClientsFilters): boolean {
  return CLIENT_FILTER_KEYS.some(k => isClientFilterActive(filters, k))
}

export function matchesClientFilters(row: ClientRow, filters: ClientsFilters): boolean {
  if (filters.status !== 'all' && row.status !== filters.status) return false

  if (filters.plan === 'none') {
    if (row.planType) return false
  } else if (filters.plan !== 'all' && row.planType !== filters.plan) {
    return false
  }

  if (filters.health !== 'all' && healthKeyOf(row) !== filters.health) return false

  if (filters.owner === UNASSIGNED_OWNER) {
    if (row.ownerId) return false
  } else if (filters.owner !== 'all' && row.ownerId !== filters.owner) {
    return false
  }

  if (filters.tag !== 'all' && !row.tags.includes(filters.tag)) return false

  switch (filters.tracks) {
    case 'some': return row.tracks.total > 0
    case 'custom': return row.tracks.mode === 'custom'
    case 'off': return row.tracks.mode === 'off'
    case 'none': return row.tracks.total === 0
    default: return true
  }
}

// -- Search ------------------------------------------------------------------

/** Name, website, industry and the studio tags. The server already filters on
 *  name and website through the `search` param; this is the client-side half
 *  so typing narrows the loaded page instantly. */
export function matchesClientQuery(row: ClientRow, query: string): boolean {
  const term = query.trim().toLowerCase()
  if (!term) return true
  const hay = `${row.name} ${row.website ?? ''} ${row.industry ?? ''} ${row.tags.join(' ')}`
  return hay.toLowerCase().includes(term)
}

// -- Sort --------------------------------------------------------------------

export type ClientsSortKey = 'name' | 'health' | 'open' | 'mrr' | 'updated' | 'created'
export type ClientsSortDir = 'asc' | 'desc'

export interface ClientsSort {
  key: ClientsSortKey
  dir: ClientsSortDir
}

export const DEFAULT_CLIENTS_SORT: ClientsSort = { key: 'name', dir: 'asc' }

export const CLIENT_SORT_KEYS: readonly { value: ClientsSortKey; label: string; money?: boolean }[] = [
  { value: 'name', label: 'Name' },
  { value: 'health', label: 'Health' },
  { value: 'open', label: 'Open requests' },
  { value: 'mrr', label: 'MRR', money: true },
  { value: 'updated', label: 'Last activity' },
  { value: 'created', label: 'Client since' },
]

/** The sort options this viewer is allowed. MRR disappears for anyone who
 *  cannot see money, so the control can never name a column that is not on
 *  screen. */
export function clientSortKeys(canSeeMoney: boolean): readonly { value: ClientsSortKey; label: string }[] {
  return CLIENT_SORT_KEYS.filter(k => canSeeMoney || !k.money)
}

/** A stored MRR sort belonging to someone who has since lost money access
 *  falls back to Name rather than sorting by an invisible column. */
export function normaliseClientsSort(sort: ClientsSort, canSeeMoney: boolean): ClientsSort {
  if (sort.key === 'mrr' && !canSeeMoney) return { key: 'name', dir: sort.dir }
  return sort
}

const CLIENT_SORT_DIR_LABELS: Record<ClientsSortKey, readonly [string, string]> = {
  name: ['A to Z', 'Z to A'],
  health: ['Most urgent first', 'Healthiest first'],
  open: ['Most open first', 'Fewest open first'],
  mrr: ['Highest first', 'Lowest first'],
  updated: ['Most recent first', 'Quietest first'],
  created: ['Newest first', 'Longest standing first'],
}

export function clientSortKeyLabel(sort: ClientsSort): string {
  return CLIENT_SORT_KEYS.find(k => k.value === sort.key)?.label ?? 'Name'
}

export function clientSortDirLabel(sort: ClientsSort): string {
  const pair = CLIENT_SORT_DIR_LABELS[sort.key] ?? CLIENT_SORT_DIR_LABELS.name
  return sort.dir === 'desc' ? pair[1] : pair[0]
}

const HEALTH_RANK: Record<ClientHealthKey, number> = { red: 0, amber: 1, green: 2, none: 3 }

function timeValue(iso: string | null): number {
  if (!iso) return Number.MAX_SAFE_INTEGER
  const t = Date.parse(iso)
  // Negated so the newest timestamp is the smallest value: ascending then
  // reads as "Most recent first", which is what the direction label promises.
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : -t
}

export function clientSortValue(row: ClientRow, key: ClientsSortKey): string | number {
  switch (key) {
    case 'health': return HEALTH_RANK[healthKeyOf(row)]
    case 'open': return -row.openRequestCount
    case 'mrr': return row.mrrNzd == null ? Number.MAX_SAFE_INTEGER : -row.mrrNzd
    case 'updated': return timeValue(row.updatedAt ?? row.createdAt)
    case 'created': return timeValue(row.createdAt)
    default: return row.name.toLowerCase()
  }
}

export function compareClients(a: ClientRow, b: ClientRow, sort: ClientsSort = DEFAULT_CLIENTS_SORT): number {
  const va = clientSortValue(a, sort.key)
  const vb = clientSortValue(b, sort.key)
  let d = typeof va === 'string' && typeof vb === 'string'
    ? va.localeCompare(vb)
    : Number(va) - Number(vb)
  if (sort.dir === 'desc') d = -d
  if (d !== 0) return d
  return a.name.localeCompare(b.name)
}

/** A sorted copy. Never mutates the caller's array. */
export function sortClients(rows: readonly ClientRow[], sort: ClientsSort = DEFAULT_CLIENTS_SORT): ClientRow[] {
  return rows.slice().sort((a, b) => compareClients(a, b, sort))
}

// -- The whole pipeline ------------------------------------------------------

export interface ClientsViewState {
  savedView: string | null
  filters: ClientsFilters
  query: string
  sort: ClientsSort
}

/** Archived rule, then saved view, then filters, then search, then sort. One
 *  call so the list and the cards render exactly the same set. */
export function applyClientViews(rows: readonly ClientRow[], state: ClientsViewState): ClientRow[] {
  const archivedAllowed = showsArchived(state.savedView, state.filters)
  const kept = rows.filter(row => {
    if (!archivedAllowed && row.status === 'archived') return false
    return matchesClientsSavedView(row, state.savedView)
      && matchesClientFilters(row, state.filters)
      && matchesClientQuery(row, state.query)
  })
  return sortClients(kept, state.sort)
}

/** Every tag on the loaded rows, sorted, so the Tag control can only ever
 *  offer a value that exists. */
export function clientTagValues(rows: readonly ClientRow[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) for (const tag of row.tags) seen.add(tag)
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

// -- Persisted shapes --------------------------------------------------------

export interface ClientsSnapshot {
  view: ClientsViewKey
  savedView: string | null
  filters: ClientsFilters
  sort: ClientsSort
}

export function isClientsFilters(value: unknown): value is ClientsFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return CLIENT_FILTER_KEYS.every(k => typeof o[k] === 'string')
}

export function isClientsSort(value: unknown): value is ClientsSort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const knownKey = CLIENT_SORT_KEYS.some(k => k.value === o.key)
  return knownKey && (o.dir === 'asc' || o.dir === 'desc')
}

export function isClientsSnapshot(value: unknown): value is ClientsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const viewOk = (CLIENTS_VIEW_KEYS as readonly unknown[]).includes(o.view)
  const savedOk = o.savedView === null || typeof o.savedView === 'string'
  return viewOk && savedOk && isClientsFilters(o.filters) && isClientsSort(o.sort)
}

/** True when the live state is exactly what the user saved as their default,
 *  which is what flips the rail from "Save as default" to "Your default". */
export function clientsSnapshotsEqual(a: ClientsSnapshot | null, b: ClientsSnapshot | null): boolean {
  if (!a || !b) return false
  if (normaliseClientsViewKey(a.view) !== normaliseClientsViewKey(b.view)) return false
  if ((a.savedView ?? null) !== (b.savedView ?? null)) return false
  for (const k of CLIENT_FILTER_KEYS) {
    if ((a.filters[k] ?? DEFAULT_CLIENT_FILTERS[k]) !== (b.filters[k] ?? DEFAULT_CLIENT_FILTERS[k])) return false
  }
  return a.sort.key === b.sort.key && a.sort.dir === b.sort.dir
}

// -- URL ---------------------------------------------------------------------

/**
 * What an inbound link is allowed to say. `/clients?status=...` predates the
 * rail and was a comma list, because the old filter chip was a multiselect.
 * The rail is single valued, so a link carrying one known status still lands
 * exactly where it used to, and one carrying several opens on All rather than
 * silently dropping four fifths of the request.
 */
export function statusFromUrl(raw: string | null): string {
  if (!raw) return DEFAULT_CLIENT_FILTERS.status
  const values = raw.split(',').map(v => v.trim()).filter(Boolean)
  if (values.length !== 1) return DEFAULT_CLIENT_FILTERS.status
  return isClientStatus(values[0]) ? values[0] : DEFAULT_CLIENT_FILTERS.status
}
