/**
 * lib/blockers.ts
 *
 * One vocabulary for "this cannot start until that finishes", across both
 * work surfaces. A blocker is a directed edge between two subjects, and a
 * subject is either a task or a request.
 *
 * Everything here is pure so it runs in the node Vitest environment. The
 * drizzle half lives in lib/blockers-server.ts, and the graph walk takes its
 * adjacency as an injected loader so the same BFS is exercised by a Map in a
 * test and by D1 in production.
 *
 * The one rule worth stating twice: a task is closed on 'done', a request is
 * closed on 'delivered', 'cancelled' or 'archived'. Two vocabularies, one
 * question ("is this still holding anything up"), and it is answered here
 * rather than in SQL so both list routes cannot drift apart.
 */

// Both closed-status lists come from status-config, not one from here and one
// from lib/requests-views (which exports the same array as CLOSED_STATUSES).
// One idea, one module, and no dependency from this pure file onto the rail.
import { REQUEST_CLOSED_STATUSES, TASK_CLOSED_STATUSES } from '@/lib/status-config'

export type BlockerSubjectType = 'task' | 'request'

export const BLOCKER_SUBJECT_TYPES: readonly BlockerSubjectType[] = ['task', 'request']

export interface BlockerSubject {
  type: BlockerSubjectType
  id: string
}

/** One row of a Waiting on / Blocked by card. `other` is always the far end
 *  of the edge from the reader's point of view, whichever direction was
 *  asked for. */
export interface BlockerRow {
  linkId: string
  otherType: BlockerSubjectType
  otherId: string
  otherTitle: string
  otherStatus: string
  /** '#042' for a request, null for a task. */
  otherRef: string | null
  otherOrgName: string | null
}

/**
 * One option in the blocker picker, as GET /api/admin/blockers/search returns
 * it.
 *
 * Declared here rather than beside the query that builds it because the
 * picker lives in a 'use client' component, and lib/blockers-server.ts pulls
 * in next/server, drizzle and the schema. A type-only import would be erased,
 * but the honest split is that a wire shape both ends read belongs in the
 * module neither end has to be careful about.
 */
export interface BlockerCandidate {
  type: BlockerSubjectType
  id: string
  label: string
  /** '#042' for a request, null for a task. */
  ref: string | null
  status: string
  orgName: string | null
}

export function isBlockerSubjectType(value: unknown): value is BlockerSubjectType {
  return value === 'task' || value === 'request'
}

/** 'task:abc'. Used as the visited-set key in the graph walk and as a React
 *  key wherever both types sit in one list. */
export function subjectKey(type: BlockerSubjectType, id: string): string {
  return `${type}:${id}`
}

/** The inverse. Null for anything that is not a key this module wrote. An id
 *  may itself contain a colon, so only the FIRST colon separates. */
export function parseSubjectKey(key: string): BlockerSubject | null {
  const cut = key.indexOf(':')
  if (cut < 1) return null
  const type = key.slice(0, cut)
  const id = key.slice(cut + 1)
  if (!isBlockerSubjectType(type) || !id) return null
  return { type, id }
}

/**
 * The status a hydrated row carries when its subject is gone.
 *
 * There are no foreign keys on a polymorphic edge, so a link can outlive the
 * thing it points at. The server sees that as a status lookup returning null;
 * the card sees the string this module substitutes. They are the same fact, so
 * `isBlockerOpen` closes on both and the two counters cannot disagree.
 */
export const ORPHAN_STATUS = 'unknown'

/** Is this blocker still holding anything up? A missing status means the row
 *  is gone (there are no foreign keys on a polymorphic edge), and a subject
 *  that no longer exists blocks nothing. */
export function isBlockerOpen(type: BlockerSubjectType, status: string | null | undefined): boolean {
  if (!status || status === ORPHAN_STATUS) return false
  return type === 'task'
    ? !TASK_CLOSED_STATUSES.includes(status)
    : !REQUEST_CLOSED_STATUSES.includes(status)
}

/** The repo's reference for a request, everywhere: #042, never TR-0042. */
export function requestRef(requestNumber: number | null | undefined): string | null {
  return requestNumber != null ? `#${String(requestNumber).padStart(3, '0')}` : null
}

/**
 * The single `warning` string a board card has room for.
 *
 * BoardItem.warning is one slot and the requests board already spends it on
 * the scope flag, so a request that is both blocked and flagged would
 * silently lose one signal. Merging is honest and costs no primitive change.
 */
export function blockedWarningLabel(openBlockers: number, scopeFlagged: boolean): string | undefined {
  const blocked = openBlockers > 0
    ? `Blocked by ${openBlockers} item${openBlockers === 1 ? '' : 's'}`
    : null
  if (blocked && scopeFlagged) return `${blocked}, and flagged for scope creep`
  if (blocked) return blocked
  if (scopeFlagged) return 'Flagged for scope creep'
  return undefined
}

export type BlockerRejection = 'self'

/** The rejections that need no database read. The same id under two types is
 *  two different rows, so it is allowed. */
export function rejectObviousPair(
  blocked: BlockerSubject,
  blocker: BlockerSubject,
): BlockerRejection | null {
  if (blocked.type === blocker.type && blocked.id === blocker.id) return 'self'
  return null
}

/**
 * A parent request and its own sub-request.
 *
 * The parent already renders "done of total" over its children, so letting it
 * also be blocked by one of them models the same fact twice and produces two
 * cards that can disagree. Rejected in both directions. Siblings are fine:
 * two sub-requests really can wait on each other.
 */
export function isFamilyPair(
  a: BlockerSubject,
  b: BlockerSubject,
  parentOf: Readonly<Record<string, string | null>>,
): boolean {
  if (a.type !== 'request' || b.type !== 'request') return false
  return parentOf[a.id] === b.id || parentOf[b.id] === a.id
}

/**
 * Would adding "blocked is blocked by blocker" close a loop?
 *
 * Walk forward from the proposed BLOCKER through what it is already blocked
 * by. If that walk reaches the subject being blocked, the new edge completes
 * a cycle. Cross-type loops (request A waits on task B waits on request A)
 * only became reachable when the model went polymorphic, so this check is not
 * optional.
 *
 * `loadBlockers` takes a whole level and returns everything that level is
 * blocked by, so the walk costs one query per level rather than one per node.
 */
export async function wouldCycle(
  blocked: BlockerSubject,
  blocker: BlockerSubject,
  loadBlockers: (batch: readonly BlockerSubject[]) => Promise<BlockerSubject[]>,
): Promise<boolean> {
  const targetKey = subjectKey(blocked.type, blocked.id)
  const startKey = subjectKey(blocker.type, blocker.id)
  if (startKey === targetKey) return true

  const visited = new Set<string>([startKey])
  let frontier: BlockerSubject[] = [blocker]

  while (frontier.length > 0) {
    const found = await loadBlockers(frontier)
    const next: BlockerSubject[] = []
    for (const node of found) {
      const key = subjectKey(node.type, node.id)
      if (key === targetKey) return true
      if (visited.has(key)) continue
      visited.add(key)
      next.push(node)
    }
    frontier = next
  }

  return false
}
