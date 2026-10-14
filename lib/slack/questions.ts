import { and, asc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { publicUrl } from '@/lib/app-url'
import { can as canView, resolvePermissions } from '@/lib/permissions'
import { SERVICE_USER_ID } from '@/lib/team-identity'
import { clientMayFileRequests } from './entitlement'
import { can, SLACK_DENIED_REPLY, type SlackIdentity } from './identity'
import { slackHelpLine, type SlackQuestionIntent } from './intents'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export const MAX_QUESTION_ITEMS = 8
const OPEN_REQUEST_STATUSES = ['submitted', 'in_review', 'in_progress', 'on_hold']
const TASK_SUGGESTION_KINDS = ['create_task', 'update_task', 'complete_task', 'add_subtasks', 'note']
const REQUEST_SUGGESTION_KINDS = ['create_request', 'update_request', 'request_note', 'hand_off_request']

interface WorkItem {
  key: string
  kind: 'Task' | 'Request' | 'Approval' | 'Waiting on studio'
  title: string
  href: string
  dueDate: string | null
  status?: string
}

interface StudioScope {
  orgIds: string[] | null
  tasks: boolean
  requests: boolean
  founder: boolean
}

/** Cached Slack identity locates the person. Current dashboard grants authorise the read. */
async function studioScope(database: Drizzle, identity: SlackIdentity): Promise<StudioScope | null> {
  if (!identity.teamMemberId || (identity.level !== 'member' && identity.level !== 'founder')) return null
  const orgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!orgId) return null
  const [member] = await database.select({ clerkUserId: schema.teamMembers.clerkUserId })
    .from(schema.teamMembers).where(eq(schema.teamMembers.id, identity.teamMemberId)).limit(1)
  if (!member?.clerkUserId || member.clerkUserId === SERVICE_USER_ID) return null
  const roles = await database.select({ name: schema.roles.name }).from(schema.teamMemberRoles)
    .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
    .where(and(eq(schema.teamMemberRoles.teamMemberId, identity.teamMemberId), isNull(schema.teamMemberRoles.endedAt)))
  if (!roles.length) return null
  const access = await resolvePermissions(database, { userId: member.clerkUserId, orgId })
  const orgIds = await resolveAccessScoping(database, member.clerkUserId)
  if (orgIds !== null && orgIds.length === 0) return null
  return {
    orgIds,
    tasks: canView(access, 'tasks'),
    requests: canView(access, 'requests'),
    founder: identity.level === 'founder' && roles.some(role => role.name === 'super_admin'),
  }
}

/** Calendar boundaries use Auckland even when the worker runs in another zone. */
export function questionDateWindow(now: Date): { today: string; weekEnd: string } {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  const today = `${value('year')}-${value('month')}-${value('day')}`
  const end = new Date(`${today}T12:00:00Z`)
  end.setUTCDate(end.getUTCDate() + (7 - ((end.getUTCDay() + 6) % 7) - 1))
  return { today, weekEnd: end.toISOString().slice(0, 10) }
}

function dueCondition(column: typeof schema.tasks.dueDate | typeof schema.requests.dueDate, intent: SlackQuestionIntent, dates: ReturnType<typeof questionDateWindow>): SQL | undefined {
  const day = sql`substr(${column}, 1, 10)`
  if (intent === 'due_today') return sql`${day} = ${dates.today}`
  if (intent === 'due_week') return and(sql`${day} >= ${dates.today}`, sql`${day} <= ${dates.weekEnd}`)
  if (intent === 'overdue') return and(sql`${day} <> ''`, sql`${day} < ${dates.today}`)
  return undefined
}

function orgCondition(column: typeof schema.tasks.orgId | typeof schema.requests.orgId | typeof schema.taskSuggestions.orgId, ids: string[] | null, studio: boolean): SQL | undefined {
  if (ids === null) return undefined
  return studio ? or(isNull(column), inArray(column, ids)) : inArray(column, ids)
}

function dateOrder(column: typeof schema.tasks.dueDate | typeof schema.requests.dueDate) {
  return [sql`NULLIF(${column}, '') IS NULL`, asc(column)]
}

async function ownTasks(database: Drizzle, memberId: string, scope: StudioScope, intent: SlackQuestionIntent, dates: ReturnType<typeof questionDateWindow>): Promise<WorkItem[]> {
  if (!scope.tasks || intent === 'approvals') return []
  const rows = await database.select({ id: schema.tasks.id, title: schema.tasks.title, dueDate: schema.tasks.dueDate })
    .from(schema.tasks).where(and(
      eq(schema.tasks.assigneeId, memberId),
      or(eq(schema.tasks.assigneeType, 'team_member'), isNull(schema.tasks.assigneeType)),
      notInArray(schema.tasks.status, ['done', 'cancelled', 'archived']),
      orgCondition(schema.tasks.orgId, scope.orgIds, true),
      dueCondition(schema.tasks.dueDate, intent, dates),
    )).orderBy(...dateOrder(schema.tasks.dueDate), asc(schema.tasks.id)).limit(MAX_QUESTION_ITEMS)
  return rows.map(row => ({ key: `task:${row.id}`, kind: 'Task', title: row.title, dueDate: row.dueDate || null, href: `/tasks?task=${encodeURIComponent(row.id)}` }))
}

async function actionRequests(database: Drizzle, memberId: string, scope: StudioScope, intent: SlackQuestionIntent, dates: ReturnType<typeof questionDateWindow>): Promise<WorkItem[]> {
  if (!scope.requests || intent === 'my_tasks' || intent === 'approvals') return []
  const assigned = or(eq(schema.requests.assigneeId, memberId), sql`EXISTS (
    SELECT 1 FROM request_participants AS rp WHERE rp.request_id = ${schema.requests.id}
    AND rp.participant_id = ${memberId} AND rp.participant_type = 'team_member'
    AND rp.role = 'assignee' AND rp.removed_at IS NULL
  )`)
  const rows = await database.select({ id: schema.requests.id, title: schema.requests.title, dueDate: schema.requests.dueDate, status: schema.requests.status, assigneeId: schema.requests.assigneeId })
    .from(schema.requests).where(and(
      scope.founder ? undefined : assigned,
      isNull(schema.requests.waitingOnContactId),
      inArray(schema.requests.status, OPEN_REQUEST_STATUSES),
      orgCondition(schema.requests.orgId, scope.orgIds, false),
      dueCondition(schema.requests.dueDate, intent, dates),
    )).orderBy(...dateOrder(schema.requests.dueDate), asc(schema.requests.id)).limit(MAX_QUESTION_ITEMS)
  return rows.map(row => ({
    key: `request:${row.id}`, kind: scope.founder && row.assigneeId !== memberId ? 'Waiting on studio' : 'Request',
    title: row.title, dueDate: row.dueDate || null, status: row.status.replace(/_/g, ' '), href: `/requests/${encodeURIComponent(row.id)}`,
  }))
}

function proposalTitle(proposal: string): string {
  try {
    const parsed: unknown = JSON.parse(proposal)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.title === 'string' && record.title.trim()) return record.title
    }
  } catch { /* A malformed proposal still links to its approval inbox. */ }
  return 'Review suggestion'
}

async function approvals(database: Drizzle, memberId: string, scope: StudioScope, intent: SlackQuestionIntent): Promise<WorkItem[]> {
  // Every approval link opens the Tasks inbox, including request proposals.
  if (!scope.tasks || !['work_today', 'waiting_on_me', 'approvals'].includes(intent)) return []
  const kinds = [...TASK_SUGGESTION_KINDS, ...(scope.requests ? REQUEST_SUGGESTION_KINDS : [])]
  const own = and(eq(schema.taskSuggestions.approverType, 'member'), eq(schema.taskSuggestions.approverId, memberId))
  const rows = await database.select({ id: schema.taskSuggestions.id, proposal: schema.taskSuggestions.proposal })
    .from(schema.taskSuggestions).where(and(
      eq(schema.taskSuggestions.status, 'pending'),
      scope.founder ? or(own, eq(schema.taskSuggestions.approverType, 'founders')) : own,
      inArray(schema.taskSuggestions.kind, kinds), orgCondition(schema.taskSuggestions.orgId, scope.orgIds, true),
    )).orderBy(asc(schema.taskSuggestions.createdAt), asc(schema.taskSuggestions.id)).limit(MAX_QUESTION_ITEMS)
  return rows.map(row => ({ key: `approval:${row.id}`, kind: 'Approval', title: proposalTitle(row.proposal), dueDate: null, href: `/tasks?view=suggestions&focus=${encodeURIComponent(row.id)}` }))
}

async function clientRequests(database: Drizzle, identity: SlackIdentity, intent: SlackQuestionIntent, dates: ReturnType<typeof questionDateWindow>): Promise<WorkItem[] | null> {
  if (!identity.contactId || !identity.orgId || !await clientMayFileRequests(database, identity.contactId, identity.orgId)) return null
  const brands = await database.select({ id: schema.brandContacts.brandId }).from(schema.brandContacts)
    .where(eq(schema.brandContacts.contactId, identity.contactId))
  const rows = await database.select({ id: schema.requests.id, title: schema.requests.title, dueDate: schema.requests.dueDate, status: schema.requests.status })
    .from(schema.requests).where(and(
      eq(schema.requests.orgId, identity.orgId), eq(schema.requests.isInternal, false),
      or(
        and(eq(schema.requests.submittedById, identity.contactId), eq(schema.requests.submittedByType, 'contact')),
        eq(schema.requests.waitingOnContactId, identity.contactId),
        sql`EXISTS (SELECT 1 FROM task_suggestions AS own_draft
          WHERE own_draft.applied_request_id = ${schema.requests.id}
          AND own_draft.approver_type = 'contact' AND own_draft.approver_id = ${identity.contactId}
          AND own_draft.org_id = ${identity.orgId} AND own_draft.kind = 'create_request'
          AND own_draft.status = 'applied')`,
      ),
      intent === 'waiting_on_me' || intent === 'approvals' ? eq(schema.requests.waitingOnContactId, identity.contactId) : undefined,
      intent === 'approvals' ? eq(schema.requests.waitingReason, 'approval') : undefined,
      brands.length ? inArray(schema.requests.brandId, brands.map(brand => brand.id)) : undefined,
      notInArray(schema.requests.status, ['draft', 'archived', 'cancelled']),
      ['due_today', 'due_week', 'overdue'].includes(intent) ? notInArray(schema.requests.status, ['delivered']) : undefined,
      dueCondition(schema.requests.dueDate, intent, dates),
    )).orderBy(...dateOrder(schema.requests.dueDate), asc(schema.requests.id)).limit(MAX_QUESTION_ITEMS)
  return rows.map(row => ({ key: `request:${row.id}`, kind: 'Request', title: row.title, dueDate: row.dueDate || null, status: row.status.replace(/_/g, ' '), href: `/requests/${encodeURIComponent(row.id)}` }))
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[|\r\n]/g, ' ').slice(0, 180)
}

function formatDue(date: string, today: string): string {
  const day = date.slice(0, 10)
  const parsed = new Date(`${day}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime())) return 'Due date needs review'
  const label = new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parsed)
  return `${day < today ? 'Overdue, due' : 'Due'} ${label}`
}

const QUESTION_HEADINGS: Record<SlackQuestionIntent, string> = {
  work_today: 'Your work to pick up', waiting_on_me: 'Waiting on you', due_today: 'Due today', due_week: 'Due this week',
  overdue: 'Overdue', my_tasks: 'Your open tasks', approvals: 'Waiting for your approval', unknown_question: '',
}

/** Reads only. No suggestion, model, task write or request write is reachable here. */
export async function answerSlackQuestion(input: {
  database: Drizzle
  identity: SlackIdentity | null
  intent: SlackQuestionIntent
  now?: Date
}): Promise<string> {
  const { database, identity, intent } = input
  if (!identity || !can(identity, 'read_own_work')) return SLACK_DENIED_REPLY
  if (intent === 'unknown_question') return slackHelpLine(identity.level)
  try {
    const dates = questionDateWindow(input.now ?? new Date())
    let items: WorkItem[]
    if (identity.level === 'client') {
      const requests = await clientRequests(database, identity, intent, dates)
      if (!requests) return SLACK_DENIED_REPLY
      items = requests
    } else {
      const scope = await studioScope(database, identity)
      if (!scope || (!scope.tasks && !scope.requests) || !identity.teamMemberId) return SLACK_DENIED_REPLY
      if ((intent === 'approvals' || intent === 'my_tasks') && !scope.tasks) return SLACK_DENIED_REPLY
      const lists = await Promise.all([
        ownTasks(database, identity.teamMemberId, scope, intent, dates),
        actionRequests(database, identity.teamMemberId, scope, intent, dates),
        approvals(database, identity.teamMemberId, scope, intent),
      ])
      items = lists.flat()
    }
    const sorted = items.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.key.localeCompare(b.key)).slice(0, MAX_QUESTION_ITEMS)
    const lines = sorted.map(item => {
      const detail = [item.dueDate ? formatDue(item.dueDate, dates.today) : null, item.status].filter(Boolean).join(', ')
      return `• ${item.kind}: <${publicUrl(item.href)}|${escapeText(item.title)}>${detail ? ` (${detail})` : ''}`
    })
    const seeAll = identity.level === 'client' ? '/requests' : intent === 'approvals' ? '/tasks?view=suggestions' : intent === 'my_tasks' ? '/tasks' : '/overview'
    const heading = identity.level === 'client' && intent === 'my_tasks' ? 'Your requests' : QUESTION_HEADINGS[intent]
    return `${heading}\n${lines.length ? lines.join('\n') : 'Nothing matching that is waiting on you.'}\n<${publicUrl(seeAll)}|See all>`
  } catch {
    return SLACK_DENIED_REPLY
  }
}
