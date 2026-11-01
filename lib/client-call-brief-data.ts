/**
 * lib/client-call-brief-data.ts
 *
 * The D1 half of the LP.4 client call brief. The rules and the shape live in
 * lib/client-call-brief.ts (pure, tested); this file only reads rows and hands
 * them over. Lives in lib/ rather than in the route because App Router route
 * files may only export HTTP methods.
 *
 * ACCESS. The route has already proven the caller may see THIS call (feature
 * 'calls' plus requireDiscoveryCallAccess). Three sections have their own
 * door and are checked here, once, from one resolvePermissions read:
 *   - requests (and the hand-offs and scope flags drawn from them): 'requests'
 *   - tasks and blockers: 'tasks'
 *   - invoices: 'invoices'
 * A section the viewer cannot see is not hidden by the UI, it is never read.
 * Nothing in this file reaches outside the call's own client: every query is
 * keyed on the one resolved org id, and a blocker whose far end belongs to a
 * different client is dropped rather than shown.
 */

import { and, desc, eq, inArray, ne, notInArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { resolveCallOrgId } from '@/lib/calls'
import { can, resolvePermissions } from '@/lib/permissions'
import { isBlockerOpen } from '@/lib/blockers'
import { REQUEST_CLOSED_STATUSES } from '@/lib/status-config'
import {
  buildClientCallBrief,
  type BriefBlockerRow,
  type BriefInvoiceRow,
  type BriefPastCallRow,
  type BriefRequestRow,
  type BriefTaskRow,
  type ClientCallBrief,
} from '@/lib/client-call-brief'

type Drizzle = Awaited<ReturnType<typeof import('@/lib/db').db>>
type Auth = { userId: string | null; orgId: string | null }

/** Read bounds. Generous for one client, but never an unbounded table scan. */
const PAST_CALL_READ = 40
const REQUEST_READ = 300
const TASK_READ = 300
const INVOICE_READ = 60
const ID_CHUNK = 90

export interface BriefSections {
  requests: boolean
  tasks: boolean
  finance: boolean
}

/** Which sections of the brief this viewer may read. The MCP service token sees all. */
export async function resolveBriefSections(database: Drizzle, auth: Auth): Promise<BriefSections> {
  if (auth.userId === 'api-service') return { requests: true, tasks: true, finance: true }
  const access = await resolvePermissions(database, auth)
  if (access.isSuperAdmin) return { requests: true, tasks: true, finance: true }
  return {
    requests: can(access, 'requests'),
    tasks: can(access, 'tasks'),
    finance: can(access, 'invoices'),
  }
}

export type LoadBriefResult =
  | { status: 'not_found' }
  | { status: 'ok'; brief: ClientCallBrief }

export async function loadClientCallBrief(
  database: Drizzle,
  callId: string,
  sections: BriefSections,
  now: Date = new Date(),
): Promise<LoadBriefResult> {
  const [call] = await database
    .select({
      id: schema.discoveryCalls.id,
      title: schema.discoveryCalls.title,
      scheduledAt: schema.discoveryCalls.scheduledAt,
      orgId: schema.discoveryCalls.orgId,
      dealId: schema.discoveryCalls.dealId,
      requestId: schema.discoveryCalls.requestId,
    })
    .from(schema.discoveryCalls)
    .where(eq(schema.discoveryCalls.id, callId))
    .limit(1)
  if (!call) return { status: 'not_found' }

  const orgId = await resolveCallOrgId(database, call)
  const [org] = orgId
    ? await database
        .select({ id: schema.organisations.id, name: schema.organisations.name })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, orgId))
        .limit(1)
    : []

  const callInput = { id: call.id, title: call.title, scheduledAt: call.scheduledAt, orgId }
  if (!org) {
    return {
      status: 'ok',
      brief: buildClientCallBrief({
        call: callInput, org: null, pastCalls: [], requests: [], tasks: [], blockers: [], invoices: null, now,
      }),
    }
  }

  // Past calls with this client. Summaries are looked up from the linked
  // transcript rows in one follow-up query.
  const pastRows = await database
    .select({
      id: schema.discoveryCalls.id,
      title: schema.discoveryCalls.title,
      scheduledAt: schema.discoveryCalls.scheduledAt,
      status: schema.discoveryCalls.status,
      summary: schema.discoveryCalls.summary,
      outcome: schema.discoveryCalls.outcome,
      outcomeNotes: schema.discoveryCalls.outcomeNotes,
      scopeNotes: schema.discoveryCalls.scopeNotes,
    })
    .from(schema.discoveryCalls)
    .where(and(eq(schema.discoveryCalls.orgId, org.id), ne(schema.discoveryCalls.id, call.id)))
    .orderBy(desc(schema.discoveryCalls.scheduledAt))
    .limit(PAST_CALL_READ)

  const transcriptSummary = new Map<string, string>()
  const pastIds = pastRows.map(r => r.id)
  for (let i = 0; i < pastIds.length; i += ID_CHUNK) {
    const rows = await database
      .select({ callId: schema.callTranscripts.callId, summary: schema.callTranscripts.summary })
      .from(schema.callTranscripts)
      .where(and(
        eq(schema.callTranscripts.callKind, 'discovery'),
        inArray(schema.callTranscripts.callId, pastIds.slice(i, i + ID_CHUNK)),
      ))
    for (const r of rows) {
      if (r.callId && r.summary && !transcriptSummary.has(r.callId)) transcriptSummary.set(r.callId, r.summary)
    }
  }
  const pastCalls: BriefPastCallRow[] = pastRows.map(r => ({
    ...r,
    transcriptSummary: transcriptSummary.get(r.id) ?? null,
  }))

  // Requests (also the source of hand-offs and scope flags).
  const requestRows = sections.requests
    ? await database
        .select({
          id: schema.requests.id,
          title: schema.requests.title,
          requestNumber: schema.requests.requestNumber,
          status: schema.requests.status,
          priority: schema.requests.priority,
          dueDate: schema.requests.dueDate,
          scopeFlagged: schema.requests.scopeFlagged,
          scopeFlagReason: schema.requests.scopeFlagReason,
          revisionCount: schema.requests.revisionCount,
          maxRevisions: schema.requests.maxRevisions,
          waitingOnContactId: schema.requests.waitingOnContactId,
          waitingOnContactName: schema.contacts.name,
          waitingReason: schema.requests.waitingReason,
          waitingSince: schema.requests.waitingSince,
          waitingDueAt: schema.requests.waitingDueAt,
          waitingNote: schema.requests.waitingNote,
        })
        .from(schema.requests)
        .leftJoin(schema.contacts, eq(schema.requests.waitingOnContactId, schema.contacts.id))
        .where(and(
          eq(schema.requests.orgId, org.id),
          notInArray(schema.requests.status, [...REQUEST_CLOSED_STATUSES, 'draft']),
        ))
        .orderBy(desc(schema.requests.createdAt))
        .limit(REQUEST_READ)
    : []
  const requests: BriefRequestRow[] = requestRows.map(r => ({ ...r, scopeFlagged: Boolean(r.scopeFlagged) }))

  const taskRows = sections.tasks
    ? await database
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
          dueDate: schema.tasks.dueDate,
          requestId: schema.tasks.requestId,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.orgId, org.id), ne(schema.tasks.status, 'done')))
        .orderBy(desc(schema.tasks.createdAt))
        .limit(TASK_READ)
    : []
  const tasks: BriefTaskRow[] = taskRows

  // Blockers: both ends must belong to this client and the blocker end must
  // still be open. A far end in another client is dropped, not redacted.
  const subjects = new Map<string, { title: string; status: string }>()
  for (const r of requestRows) subjects.set(`request:${r.id}`, { title: r.title, status: r.status })
  for (const t of taskRows) subjects.set(`task:${t.id}`, { title: t.title, status: t.status })
  const blockers: BriefBlockerRow[] = []
  const blockedSets: Array<{ type: 'task' | 'request'; ids: string[] }> = []
  if (sections.tasks) blockedSets.push({ type: 'task', ids: taskRows.map(t => t.id) })
  if (sections.requests) blockedSets.push({ type: 'request', ids: requestRows.map(r => r.id) })
  for (const set of blockedSets) {
    for (let i = 0; i < set.ids.length; i += ID_CHUNK) {
      const rows = await database
        .select({
          blockedId: schema.workBlockers.blockedId,
          blockerType: schema.workBlockers.blockerType,
          blockerId: schema.workBlockers.blockerId,
        })
        .from(schema.workBlockers)
        .where(and(
          eq(schema.workBlockers.blockedType, set.type),
          inArray(schema.workBlockers.blockedId, set.ids.slice(i, i + ID_CHUNK)),
        ))
      for (const row of rows) {
        const blocked = subjects.get(`${set.type}:${row.blockedId}`)
        const blocker = subjects.get(`${row.blockerType}:${row.blockerId}`)
        if (!blocked || !blocker) continue
        if (row.blockerType !== 'task' && row.blockerType !== 'request') continue
        if (!isBlockerOpen(row.blockerType, blocker.status)) continue
        blockers.push({
          blockedType: set.type,
          blockedId: row.blockedId,
          blockedTitle: blocked.title,
          blockerTitle: blocker.title,
        })
      }
    }
  }

  let invoices: BriefInvoiceRow[] | null = null
  if (sections.finance) {
    invoices = await database
      .select({
        id: schema.invoices.id,
        number: schema.invoices.number,
        status: schema.invoices.status,
        totalUsd: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
        dueDate: schema.invoices.dueDate,
        sentAt: schema.invoices.sentAt,
        paidAt: schema.invoices.paidAt,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.orgId, org.id))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(INVOICE_READ)
  }

  return {
    status: 'ok',
    brief: buildClientCallBrief({
      call: callInput,
      org: { id: org.id, name: org.name },
      pastCalls,
      requests,
      tasks,
      blockers,
      invoices,
      sectionsHidden: !sections.requests || !sections.tasks,
      now,
    }),
  }
}
