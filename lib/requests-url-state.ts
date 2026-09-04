/**
 * lib/requests-url-state.ts
 *
 * The Requests list's URL contract, as one pure function over search params.
 *
 * The request detail header links out to the list ("show me everything in this
 * category", "show me the rest of this person's work"), so the list has to be
 * able to open on a state it was told rather than only on the state the user
 * last left behind. This module is the translation layer: it reads a
 * `URLSearchParams`-shaped object and hands back a PARTIAL rail state, so the
 * caller can let a param win for one dimension and keep the stored preference
 * for every other one.
 *
 * Supported params:
 *
 *   status=<slug>       one of the request statuses. Rail filter.
 *   category=<slug>     rail filter, opaque (categories are data).
 *   client=<orgId>      rail filter, admin only. Ignored alongside `new=1`,
 *                       where `client` already means "pre-fill the dialog".
 *   priority=<slug>     not a rail dimension: returned under `narrow`.
 *   assignee=<id>       not a rail dimension: returned under `narrow`.
 *   view=<key>          list | kanban | workload | timeline (board = kanban).
 *   sort=<key>&dir=…    due | updated | created | priority | client.
 *   q=<text>            the search box.
 *
 * The flipped directions. `created` and `updated` are comparator-negated in
 * `lib/requests-views.ts`, so ASCENDING already reads as "newest first". A URL
 * says `dir=desc` for newest first in plain language, so those two keys flip
 * on the way in and the list opens on the ordering the link promised. Only
 * `created` flips today: no link names `updated`, and flipping it now would
 * silently change what an existing `?sort=updated&dir=…` URL does.
 *
 * What `assignee` means. It narrows to everyone the person is ON, not only
 * what they are the assignee of: the header's people stack links every
 * teammate bubble here, PM and follower included, and an assignee-only match
 * would land a PM on a list that excludes the very request they clicked from.
 *
 * Nothing here touches React or the DOM, so it is unit-tested directly.
 */

import { REQUEST_STATUS_CONFIG } from '@/lib/status-config'
import {
  DEFAULT_REQUEST_FILTERS,
  REQUEST_SORT_KEYS,
  REQUESTS_VIEW_KEYS,
  type RequestsFilters,
  type RequestsSort,
  type RequestsSortDir,
  type RequestsSortKey,
  type RequestsViewKey,
} from '@/lib/requests-views'

// ── Shapes ───────────────────────────────────────────────────────────────────

/** Dimensions the rail has no control for, narrowed by a link instead. */
export type RequestsNarrowKey = 'priority' | 'assignee'

export interface RequestsUrlNarrow {
  priority: string | null
  assignee: string | null
}

export interface RequestsUrlState {
  /** Only the dimensions the URL actually named. */
  filters: Partial<RequestsFilters>
  narrow: RequestsUrlNarrow
  view: RequestsViewKey | null
  sort: RequestsSort | null
  query: string | null
  /**
   * True when the URL narrowed the list at all, in which case a stored saved
   * view stands down for this load.
   *
   * A saved view is a stored pre-filter with its own opinion about the same
   * rows: "All active" hides delivered and cancelled, "Assigned to me" hides
   * everyone else's work. A link that says "see all delivered requests" would
   * land on nothing at all under the first, and one that says "see everything
   * Staci is leading" on nothing at all under the second. The link is the more
   * specific instruction, so it wins the whole narrowing and the rail shows
   * All requests. Reset to default is the way back, and it appears precisely
   * because standing the saved view down moved the rail off the default.
   *
   * `view`, `sort` and `q` do not trip this: none of them removes a row.
   */
  clearsSavedView: boolean
}

/** One narrow dimension, ready to render beside the rail's own filter chips. */
export interface RequestsNarrowChip {
  key: RequestsNarrowKey
  dimension: string
  label: string
}

/** The minimum surface of `URLSearchParams` this module needs. Next's
 *  `ReadonlyURLSearchParams` satisfies it without a cast. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

export const EMPTY_REQUESTS_URL_NARROW: RequestsUrlNarrow = { priority: null, assignee: null }

export const EMPTY_REQUESTS_URL_STATE: RequestsUrlState = {
  filters: {},
  narrow: EMPTY_REQUESTS_URL_NARROW,
  view: null,
  sort: null,
  query: null,
  clearsSavedView: false,
}

// ── Readers ──────────────────────────────────────────────────────────────────

/** Trimmed, or null for absent / blank. */
function read(params: ReadableSearchParams, name: string): string | null {
  const raw = params.get(name)
  if (raw == null) return null
  const value = raw.trim()
  return value === '' ? null : value
}

/** A filter value that is not already the default is worth carrying. */
function readFilterValue(
  params: ReadableSearchParams,
  name: keyof RequestsFilters,
): string | null {
  const value = read(params, name)
  if (value === null) return null
  return value === DEFAULT_REQUEST_FILTERS[name] ? null : value
}

function isKnownStatus(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(REQUEST_STATUS_CONFIG, value)
}

function isViewKey(value: string): value is RequestsViewKey {
  return (REQUESTS_VIEW_KEYS as readonly string[]).includes(value)
}

function isSortKey(value: string): value is RequestsSortKey {
  return REQUEST_SORT_KEYS.some(k => k.value === value)
}

function flip(dir: RequestsSortDir): RequestsSortDir {
  return dir === 'asc' ? 'desc' : 'asc'
}

/** Keys whose rail comparator is negated, so the URL's plain-language
 *  direction is the opposite of the rail's. See the module header for why
 *  `updated` is deliberately not on this list. */
const FLIPPED_SORT_KEYS: readonly string[] = ['created']

export function readRequestsUrlView(params: ReadableSearchParams): RequestsViewKey | null {
  const raw = read(params, 'view')
  if (raw === null) return null
  // The pre-rail preference and the round-one prototype both said "board".
  const value = raw === 'board' ? 'kanban' : raw
  return isViewKey(value) ? value : null
}

export function readRequestsUrlSort(params: ReadableSearchParams): RequestsSort | null {
  const raw = read(params, 'sort')
  if (raw === null) return null
  const dirRaw = read(params, 'dir')
  const dir: RequestsSortDir = dirRaw === 'desc' ? 'desc' : 'asc'
  if (!isSortKey(raw)) return null
  return { key: raw, dir: FLIPPED_SORT_KEYS.includes(raw) ? flip(dir) : dir }
}

/**
 * The whole contract in one read. Every field is independently optional, so a
 * caller merges `filters` over the stored preference rather than replacing it.
 */
export function readRequestsUrlState(params: ReadableSearchParams): RequestsUrlState {
  const filters: Partial<RequestsFilters> = {}

  const status = readFilterValue(params, 'status')
  if (status !== null && isKnownStatus(status)) filters.status = status

  const category = readFilterValue(params, 'category')
  if (category !== null) filters.category = category

  // `?new=1&client=<id>` already means "open the dialog on this client", and
  // has since long before the rail. Narrowing the list behind the dialog too
  // would quietly change what that link does, so the filter stands down.
  const creatingRequest = read(params, 'new') === '1'
  const client = readFilterValue(params, 'client')
  if (client !== null && !creatingRequest) filters.client = client

  const type = readFilterValue(params, 'type')
  if (type !== null) filters.type = type

  const narrow: RequestsUrlNarrow = {
    priority: read(params, 'priority'),
    assignee: read(params, 'assignee'),
  }

  return {
    filters,
    narrow,
    view: readRequestsUrlView(params),
    sort: readRequestsUrlSort(params),
    query: read(params, 'q'),
    clearsSavedView: Object.keys(filters).length > 0 || hasRequestsUrlNarrow(narrow),
  }
}

// ── Narrow dimensions ────────────────────────────────────────────────────────

/** One person on a request, as both list APIs return them. */
export interface NarrowableParticipant {
  id: string
  type: string
}

/** The row shape the narrow dimensions read. A list row is a superset. */
export interface NarrowableRow {
  priority?: string | null
  assigneeId?: string | null
  /** The pm / assignee / follower cast, when the row carries it. */
  participants?: readonly NarrowableParticipant[] | null
}

export function hasRequestsUrlNarrow(narrow: RequestsUrlNarrow): boolean {
  return narrow.priority !== null || narrow.assignee !== null
}

/**
 * Is any URL-derived narrowing still on screen, across both halves of it: the
 * rail dimensions the URL overrode, and the link-only ones?
 *
 * The saved-view stand-down (`clearsSavedView`) lasts exactly as long as this
 * is true. Once the user has cleared the last chip the link raised, their
 * stored saved view is the only opinion left, so it comes back rather than
 * staying quietly suppressed with nothing on screen to explain it.
 */
export function requestsUrlStillNarrows(
  filters: Partial<RequestsFilters>,
  narrow: RequestsUrlNarrow,
): boolean {
  return Object.keys(filters).length > 0 || hasRequestsUrlNarrow(narrow)
}

/**
 * True when this teammate is on the request at all: its assignee, or any of
 * pm / assignee / follower in the participant cast. The assignee column is
 * still checked on its own, because a request whose cast was never filled in
 * still has one.
 */
function isOnRequest(row: NarrowableRow, teamMemberId: string): boolean {
  if ((row.assigneeId ?? '') === teamMemberId) return true
  return (row.participants ?? []).some(p => p.type === 'team_member' && p.id === teamMemberId)
}

/** True when the row survives every narrow dimension the URL named. */
export function matchesRequestsUrlNarrow(row: NarrowableRow, narrow: RequestsUrlNarrow): boolean {
  if (narrow.priority !== null && (row.priority ?? '') !== narrow.priority) return false
  if (narrow.assignee !== null && !isOnRequest(row, narrow.assignee)) return false
  return true
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
}

/**
 * The clearable chips for the narrow dimensions. `teamMemberNames` maps a team
 * member id to their name; an id with no name still gets a chip, because a
 * filter the user cannot see is a filter they cannot clear.
 *
 * The person chip says "Person", not "Assignee": the dimension matches anyone
 * on the request, so naming it after one of the three roles would describe a
 * narrower cut than the rows on screen.
 */
export function buildRequestsNarrowChips(
  narrow: RequestsUrlNarrow,
  teamMemberNames: Readonly<Record<string, string>> = {},
): RequestsNarrowChip[] {
  const chips: RequestsNarrowChip[] = []
  if (narrow.priority !== null) {
    chips.push({ key: 'priority', dimension: 'Priority', label: titleCase(narrow.priority) })
  }
  if (narrow.assignee !== null) {
    chips.push({
      key: 'assignee',
      dimension: 'Person',
      label: teamMemberNames[narrow.assignee] ?? 'Selected teammate',
    })
  }
  return chips
}

/** Drop one narrow dimension, keeping the other. */
export function clearRequestsNarrow(
  narrow: RequestsUrlNarrow,
  key: RequestsNarrowKey,
): RequestsUrlNarrow {
  return { ...narrow, [key]: null }
}
