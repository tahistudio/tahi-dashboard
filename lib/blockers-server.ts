/**
 * lib/blockers-server.ts
 *
 * Everything about blockers that needs the database. The rules live next
 * door in lib/blockers.ts, which is pure and tested; this file is the D1
 * plumbing plus the two access systems it has to satisfy at once.
 *
 * Access is the whole reason this is one module rather than two route
 * helpers. A task is guarded by `guardTask` (client-less studio tasks are
 * allowed for every team member); a request is guarded by
 * `requireAccessToOrg` on its owning client. A blocker link touches one of
 * each, and BOTH ends must be guarded on every write, or linking something
 * you can see to something you cannot leaks the far end's title straight back
 * through the card.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router routes
 * may only export HTTP methods and config.
 */

import { NextResponse } from 'next/server'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { guardTask } from '@/lib/task-access'
import { requireAccessToOrg } from '@/lib/require-access'
import { resolveAccessScoping } from '@/lib/access-scoping'
import {
  isBlockerOpen,
  isFamilyPair,
  rejectObviousPair,
  requestRef,
  subjectKey,
  wouldCycle,
  type BlockerRow,
  type BlockerSubject,
  type BlockerSubjectType,
} from '@/lib/blockers'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── Access ───────────────────────────────────────────────────────────────────

/** The one guard for either kind of subject. Returns a NextResponse to short
 *  circuit on, or null when the caller may proceed, which is the contract
 *  `requireAccessToOrg` and `guardTask` already use. */
export async function guardSubject(
  drizzle: Drizzle,
  userId: string | null,
  subject: BlockerSubject,
): Promise<NextResponse | null> {
  if (subject.type === 'task') return guardTask(drizzle, userId, subject.id)

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, subject.id))
    .limit(1)

  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  return requireAccessToOrg(drizzle, userId, request.orgId)
}

// ── Reads ────────────────────────────────────────────────────────────────────

interface SubjectRef {
  linkId: string
  type: BlockerSubjectType
  id: string
}

interface SubjectFacts {
  title: string
  status: string
  ref: string | null
  orgName: string | null
}

/** Two queries at most, whatever the mix of types. Order is preserved. */
async function hydrateSubjects(drizzle: Drizzle, refs: readonly SubjectRef[]): Promise<BlockerRow[]> {
  const taskIds = refs.filter(r => r.type === 'task').map(r => r.id)
  const requestIds = refs.filter(r => r.type === 'request').map(r => r.id)
  const facts = new Map<string, SubjectFacts>()

  if (taskIds.length > 0) {
    const rows = await drizzle
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        status: schema.tasks.status,
        orgName: schema.organisations.name,
      })
      .from(schema.tasks)
      .leftJoin(schema.organisations, eq(schema.tasks.orgId, schema.organisations.id))
      .where(inArray(schema.tasks.id, taskIds))
    for (const row of rows) {
      facts.set(subjectKey('task', row.id), {
        title: row.title,
        status: row.status,
        ref: null,
        orgName: row.orgName ?? null,
      })
    }
  }

  if (requestIds.length > 0) {
    const rows = await drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        requestNumber: schema.requests.requestNumber,
        orgName: schema.organisations.name,
      })
      .from(schema.requests)
      .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
      .where(inArray(schema.requests.id, requestIds))
    for (const row of rows) {
      facts.set(subjectKey('request', row.id), {
        title: row.title,
        status: row.status,
        ref: requestRef(row.requestNumber),
        orgName: row.orgName ?? null,
      })
    }
  }

  // An orphan still renders and can still be unlinked. Hiding it would leave
  // a count nobody can explain and a row nobody can remove.
  return refs.map(ref => {
    const found = facts.get(subjectKey(ref.type, ref.id))
    return {
      linkId: ref.linkId,
      otherType: ref.type,
      otherId: ref.id,
      otherTitle: found?.title ?? (ref.type === 'request' ? 'Deleted request' : 'Deleted task'),
      otherStatus: found?.status ?? 'unknown',
      otherRef: found?.ref ?? null,
      otherOrgName: found?.orgName ?? null,
    }
  })
}

export interface BlockerLists {
  /** What this subject is waiting on. */
  blockedBy: BlockerRow[]
  /** What is waiting on this subject. */
  blocks: BlockerRow[]
}

export async function listBlockers(drizzle: Drizzle, subject: BlockerSubject): Promise<BlockerLists> {
  const blockedByLinks = await drizzle
    .select({
      id: schema.workBlockers.id,
      type: schema.workBlockers.blockerType,
      subjectId: schema.workBlockers.blockerId,
    })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockedType, subject.type),
      eq(schema.workBlockers.blockedId, subject.id),
    ))

  const blocksLinks = await drizzle
    .select({
      id: schema.workBlockers.id,
      type: schema.workBlockers.blockedType,
      subjectId: schema.workBlockers.blockedId,
    })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockerType, subject.type),
      eq(schema.workBlockers.blockerId, subject.id),
    ))

  const toRefs = (rows: Array<{ id: string; type: string; subjectId: string }>): SubjectRef[] =>
    rows
      .filter(r => r.type === 'task' || r.type === 'request')
      .map(r => ({ linkId: r.id, type: r.type as BlockerSubjectType, id: r.subjectId }))

  return {
    blockedBy: await hydrateSubjects(drizzle, toRefs(blockedByLinks)),
    blocks: await hydrateSubjects(drizzle, toRefs(blocksLinks)),
  }
}

/**
 * Open blocker counts for a batch of subjects of one type.
 *
 * Both list routes call this rather than writing a correlated subquery,
 * because the closed-status vocabulary differs per type and putting either
 * list into SQL is how the old `dependsOnStatus !== 'done'` literal drifted
 * away from every other reader in the first place.
 */
export async function openBlockerCounts(
  drizzle: Drizzle,
  type: BlockerSubjectType,
  ids: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  if (ids.length === 0) return counts

  const links = await drizzle
    .select({
      blockedId: schema.workBlockers.blockedId,
      blockerType: schema.workBlockers.blockerType,
      blockerId: schema.workBlockers.blockerId,
    })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockedType, type),
      inArray(schema.workBlockers.blockedId, [...ids]),
    ))

  if (links.length === 0) return counts

  const statuses = new Map<string, string>()
  const blockerTaskIds = links.filter(l => l.blockerType === 'task').map(l => l.blockerId)
  const blockerRequestIds = links.filter(l => l.blockerType === 'request').map(l => l.blockerId)

  if (blockerTaskIds.length > 0) {
    const rows = await drizzle
      .select({ id: schema.tasks.id, status: schema.tasks.status })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, blockerTaskIds))
    for (const row of rows) statuses.set(subjectKey('task', row.id), row.status)
  }
  if (blockerRequestIds.length > 0) {
    const rows = await drizzle
      .select({ id: schema.requests.id, status: schema.requests.status })
      .from(schema.requests)
      .where(inArray(schema.requests.id, blockerRequestIds))
    for (const row of rows) statuses.set(subjectKey('request', row.id), row.status)
  }

  for (const link of links) {
    if (link.blockerType !== 'task' && link.blockerType !== 'request') continue
    const blockerType = link.blockerType as BlockerSubjectType
    const status = statuses.get(subjectKey(blockerType, link.blockerId)) ?? null
    if (!isBlockerOpen(blockerType, status)) continue
    counts[link.blockedId] = (counts[link.blockedId] ?? 0) + 1
  }

  return counts
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Add "blocked is blocked by blocker". Returns the response to send, so both
 * surfaces answer identically and neither route re-states a rule.
 *
 * Order matters: cheap pure rejections, then both access guards, then the two
 * reads (family pair, cycle), then the insert. Nothing that costs a query
 * runs before the caller has proved it may see both ends.
 */
export async function addBlocker(
  drizzle: Drizzle,
  userId: string | null,
  blocked: BlockerSubject,
  blocker: BlockerSubject,
): Promise<NextResponse> {
  if (rejectObviousPair(blocked, blocker) === 'self') {
    return NextResponse.json({ error: 'Something cannot wait on itself' }, { status: 400 })
  }

  const blockedDenied = await guardSubject(drizzle, userId, blocked)
  if (blockedDenied) return blockedDenied
  const blockerDenied = await guardSubject(drizzle, userId, blocker)
  if (blockerDenied) return blockerDenied

  if (blocked.type === 'request' && blocker.type === 'request') {
    const rows = await drizzle
      .select({ id: schema.requests.id, parentRequestId: schema.requests.parentRequestId })
      .from(schema.requests)
      .where(inArray(schema.requests.id, [blocked.id, blocker.id]))
    const parentOf: Record<string, string | null> = {}
    for (const row of rows) parentOf[row.id] = row.parentRequestId ?? null
    if (isFamilyPair(blocked, blocker, parentOf)) {
      return NextResponse.json(
        { error: 'A request and its own sub-request already track each other. Use the sub-request list instead.' },
        { status: 400 },
      )
    }
  }

  const loadBlockers = async (batch: readonly BlockerSubject[]): Promise<BlockerSubject[]> => {
    const conditions = batch.map(s => and(
      eq(schema.workBlockers.blockedType, s.type),
      eq(schema.workBlockers.blockedId, s.id),
    ))
    const rows = await drizzle
      .select({
        type: schema.workBlockers.blockerType,
        id: schema.workBlockers.blockerId,
      })
      .from(schema.workBlockers)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    return rows
      .filter(r => r.type === 'task' || r.type === 'request')
      .map(r => ({ type: r.type as BlockerSubjectType, id: r.id }))
  }

  if (await wouldCycle(blocked, blocker, loadBlockers)) {
    return NextResponse.json({ error: 'That would make a loop' }, { status: 400 })
  }

  const [existing] = await drizzle
    .select({ id: schema.workBlockers.id })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.blockedType, blocked.type),
      eq(schema.workBlockers.blockedId, blocked.id),
      eq(schema.workBlockers.blockerType, blocker.type),
      eq(schema.workBlockers.blockerId, blocker.id),
    ))
    .limit(1)
  if (existing) {
    return NextResponse.json({ error: 'That link already exists' }, { status: 409 })
  }

  const id = crypto.randomUUID()
  await drizzle.insert(schema.workBlockers).values({
    id,
    blockedType: blocked.type,
    blockedId: blocked.id,
    blockerType: blocker.type,
    blockerId: blocker.id,
    createdById: userId ?? null,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  })

  return NextResponse.json({ id }, { status: 201 })
}

/** Remove one link, having proved it belongs to the subject that asked. */
export async function removeBlocker(
  drizzle: Drizzle,
  userId: string | null,
  blocked: BlockerSubject,
  linkId: string,
): Promise<NextResponse> {
  const denied = await guardSubject(drizzle, userId, blocked)
  if (denied) return denied

  const [link] = await drizzle
    .select({ id: schema.workBlockers.id })
    .from(schema.workBlockers)
    .where(and(
      eq(schema.workBlockers.id, linkId),
      eq(schema.workBlockers.blockedType, blocked.type),
      eq(schema.workBlockers.blockedId, blocked.id),
    ))
    .limit(1)

  if (!link) return NextResponse.json({ error: 'Blocker not found' }, { status: 404 })

  await drizzle.delete(schema.workBlockers).where(eq(schema.workBlockers.id, linkId))
  return NextResponse.json({ success: true })
}

/**
 * Delete every edge touching a subject, in both directions.
 *
 * There is exactly one caller: DELETE /api/admin/tasks/[id], the only hard
 * delete in the codebase. Requests are soft-deleted to 'archived', which
 * isBlockerOpen already treats as closed, so they need no sweep. If a hard
 * delete is ever added for requests, it calls this too.
 */
export async function sweepBlockers(drizzle: Drizzle, subject: BlockerSubject): Promise<void> {
  await drizzle.delete(schema.workBlockers).where(and(
    eq(schema.workBlockers.blockedType, subject.type),
    eq(schema.workBlockers.blockedId, subject.id),
  ))
  await drizzle.delete(schema.workBlockers).where(and(
    eq(schema.workBlockers.blockerType, subject.type),
    eq(schema.workBlockers.blockerId, subject.id),
  ))
}

// ── Picker search ────────────────────────────────────────────────────────────

export interface BlockerCandidate {
  type: BlockerSubjectType
  id: string
  label: string
  ref: string | null
  status: string
  orgName: string | null
}

/**
 * Open tasks and requests the caller may actually reach.
 *
 * Deliberately NOT GET /api/admin/search, which gates on isTahiAdmin only and
 * applies no team-member scoping, so a scoped teammate would be offered
 * clients they cannot open. Closed subjects are excluded: a finished thing
 * cannot hold anything up, and offering it would create a link that is
 * already satisfied at birth.
 */
export async function searchBlockerCandidates(
  drizzle: Drizzle,
  userId: string | null,
  query: string,
  exclude: BlockerSubject | null,
  perType = 8,
): Promise<BlockerCandidate[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const pattern = `%${trimmed.toLowerCase()}%`
  const scopedOrgIds = await resolveAccessScoping(drizzle, userId)

  // Tasks. A client-less task is the studio's own list, which every team
  // member on this surface may reach, matching the tasks list route.
  const taskConditions = [
    sql`lower(${schema.tasks.title}) LIKE ${pattern}`,
    sql`${schema.tasks.status} NOT IN ('done')`,
  ]
  if (scopedOrgIds !== null) {
    taskConditions.push(
      scopedOrgIds.length === 0
        ? isNull(schema.tasks.orgId)
        : or(inArray(schema.tasks.orgId, scopedOrgIds), isNull(schema.tasks.orgId))!,
    )
  }
  if (exclude?.type === 'task') {
    taskConditions.push(sql`${schema.tasks.id} <> ${exclude.id}`)
  }

  const taskRows = await drizzle
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      status: schema.tasks.status,
      orgName: schema.organisations.name,
    })
    .from(schema.tasks)
    .leftJoin(schema.organisations, eq(schema.tasks.orgId, schema.organisations.id))
    .where(and(...taskConditions))
    .limit(perType)

  // Requests. No null-org case: every request has a client.
  const numeric = Number.parseInt(trimmed.replace(/^#/, ''), 10)
  const requestMatch = Number.isFinite(numeric)
    ? or(
        sql`lower(${schema.requests.title}) LIKE ${pattern}`,
        eq(schema.requests.requestNumber, numeric),
      )!
    : sql`lower(${schema.requests.title}) LIKE ${pattern}`

  const requestConditions = [
    requestMatch,
    sql`${schema.requests.status} NOT IN ('delivered', 'cancelled', 'archived')`,
  ]
  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) return mapTasks(taskRows)
    requestConditions.push(inArray(schema.requests.orgId, scopedOrgIds))
  }
  if (exclude?.type === 'request') {
    requestConditions.push(sql`${schema.requests.id} <> ${exclude.id}`)
  }

  const requestRows = await drizzle
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      requestNumber: schema.requests.requestNumber,
      orgName: schema.organisations.name,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .where(and(...requestConditions))
    .limit(perType)

  return [
    ...mapTasks(taskRows),
    ...requestRows.map((row): BlockerCandidate => ({
      type: 'request',
      id: row.id,
      label: row.title,
      ref: requestRef(row.requestNumber),
      status: row.status,
      orgName: row.orgName ?? null,
    })),
  ]
}

function mapTasks(
  rows: Array<{ id: string; title: string; status: string; orgName: string | null }>,
): BlockerCandidate[] {
  return rows.map(row => ({
    type: 'task',
    id: row.id,
    label: row.title,
    ref: null,
    status: row.status,
    orgName: row.orgName ?? null,
  }))
}
