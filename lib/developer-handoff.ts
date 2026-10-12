/**
 * lib/developer-handoff.ts
 *
 * "Hand off to developer": a designer working through Claude finds that a task
 * or request needs developer work and passes it to the developer in one call.
 *
 * What one handoff does, in order:
 *   1. Resolves the developer (setting first, then the single full-profile
 *      team member). No ids are hardcoded.
 *   2. Adds the developer to the subject WITHOUT removing anyone.
 *        request: an active 'assignee' participant row, unless the developer
 *                 already holds any active participant row on it.
 *        task:    tasks carry one assignee and have no follower, watcher or
 *                 participant concept, so the developer becomes the assignee
 *                 only when the task has none. An existing assignee is never
 *                 replaced; the comment and the bell carry the handoff then.
 *   3. Posts an INTERNAL note: an internal request thread message, or a task
 *      comment (studio only; a task comment on a task that has a request is
 *      mirrored into that thread as an internal message by postTaskComment).
 *   4. Rings the developer's bell, in app only.
 *
 * NO EMAIL, by construction. Nothing here passes an `email` plan to
 * createNotifications (the only door in lib/notifications.ts that sends mail
 * is `shared.email`), and the thread writers used here are plain inserts: the
 * notification and email fan-out of POST /api/admin/requests/[id]/messages
 * lives in that route, not in a lib, and is deliberately not reused.
 *
 * Lives in lib/ rather than in the route because route files may only export
 * HTTP handlers.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { resolveTeamMember } from '@/lib/team-identity'
import { notifyTeamMember } from '@/lib/notifications'
import { postTaskComment, postRequestBotMessage } from '@/lib/task-comments'
import { toPlainText, truncate } from '@/lib/notification-email'
import { TAHI_BOT } from '@/lib/tahi-bot'
import { logAudit } from '@/lib/audit'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The settings key naming the developer (a team_members.id or a Clerk id). */
export const DEVELOPER_SETTING_KEY = 'mcp.developerTeamMemberId'

/** Longest note accepted, in characters, after trimming. */
export const MAX_HANDOFF_NOTE_LENGTH = 2000

export type HandoffSubjectType = 'task' | 'request'

export interface HandoffInput {
  subjectType: HandoffSubjectType
  subjectId: string
  note: string
  /** Clerk user id of the person handing off, or 'api-service' / null. */
  actorUserId: string | null
}

export interface HandoffSuccess {
  ok: true
  developerTeamMemberId: string
  developerName: string
  /** True when this call added the developer to the subject. */
  addedAsAssignee: boolean
  /** The message or task comment id carrying the note. */
  noteId: string
  /** True when a bell row was inserted for the developer. */
  notified: boolean
}

export type HandoffErrorCode = 'invalid' | 'not_found' | 'no_developer'

export interface HandoffFailure {
  ok: false
  code: HandoffErrorCode
  message: string
  status: 400 | 404 | 409
}

export type HandoffResult = HandoffSuccess | HandoffFailure

interface Developer {
  id: string
  name: string
  clerkUserId: string | null
}

const NO_DEVELOPER_MESSAGE =
  `No developer is configured. Set the ${DEVELOPER_SETTING_KEY} setting to the developer's team member id or Clerk user id.`

function fail(code: HandoffErrorCode, message: string, status: HandoffFailure['status']): HandoffFailure {
  return { ok: false, code, message, status }
}

/**
 * Plain text safe to store on either thread. Tags are stripped (the request
 * thread renders rich text), any stray angle bracket is dropped, and runs of
 * whitespace collapse so a pasted block cannot stretch the note.
 */
export function sanitiseHandoffNote(note: string): string {
  return toPlainText(note).replace(/[<>]/g, '').trim()
}

async function findMember(database: Drizzle, value: string): Promise<Developer | null> {
  const [row] = await database
    .select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      clerkUserId: schema.teamMembers.clerkUserId,
    })
    .from(schema.teamMembers)
    .where(or(eq(schema.teamMembers.id, value), eq(schema.teamMembers.clerkUserId, value)))
    .limit(1)
  return row ? { id: row.id, name: row.name, clerkUserId: row.clerkUserId ?? null } : null
}

/**
 * The developer, or a 409 saying how to configure one.
 *
 * The setting wins when present and accepts a team_members.id or a Clerk user
 * id (the tolerant pattern of resolveOwnerSetting). A setting that names
 * nobody is an error, not a silent fall through to the profile fallback.
 * Without the setting, the one team member whose mcp_profile is 'full' is the
 * developer; zero or several such rows is ambiguous and answers 409. The
 * mcp_profile column is added by migration 0112 and is not in db/schema.ts, so
 * it is read with raw SQL and a missing column counts as no match.
 */
export async function resolveDeveloper(database: Drizzle): Promise<Developer | HandoffFailure> {
  const [setting] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, DEVELOPER_SETTING_KEY))
    .limit(1)

  const configured = setting?.value?.trim()
  if (configured) {
    const member = await findMember(database, configured)
    if (member) return member
    return fail(
      'no_developer',
      `The ${DEVELOPER_SETTING_KEY} setting does not match any team member. Set it to the developer's team member id or Clerk user id.`,
      409,
    )
  }

  let fullProfileIds: string[] = []
  try {
    const rows = await database.all<{ id: string }>(
      sql`SELECT id FROM team_members WHERE mcp_profile = 'full'`,
    )
    fullProfileIds = (rows ?? []).map(r => r.id)
  } catch {
    fullProfileIds = []
  }

  if (fullProfileIds.length === 1) {
    const member = await findMember(database, fullProfileIds[0])
    if (member) return member
  }
  return fail('no_developer', NO_DEVELOPER_MESSAGE, 409)
}

interface Author {
  /** team_members.id of the person handing off, or null when unknown. */
  teamMemberId: string | null
  name: string | null
}

async function resolveAuthor(database: Drizzle, actorUserId: string | null): Promise<Author> {
  const member = await resolveTeamMember(database, actorUserId)
  return { teamMemberId: member?.id ?? null, name: member?.name ?? null }
}

/**
 * One internal row on a request's thread. Mirrors the insert the messages
 * route makes for an internal note, without that route's notification and
 * email fan-out.
 */
async function postInternalRequestNote(
  database: Drizzle,
  request: { id: string; orgId: string },
  author: Author,
  body: string,
): Promise<string> {
  if (!author.teamMemberId) {
    // Unknown author: the Tahi bot, the voice the request thread already uses
    // for lines nobody typed.
    return postRequestBotMessage(database, request.id, { body })
  }
  const id = crypto.randomUUID()
  await database.insert(schema.messages).values({
    id,
    requestId: request.id,
    orgId: request.orgId,
    authorId: author.teamMemberId,
    authorType: 'team_member',
    body,
    isInternal: true,
  })
  await database
    .update(schema.requests)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.requests.id, request.id))
  return id
}

export async function handOffToDeveloper(
  database: Drizzle,
  input: HandoffInput,
): Promise<HandoffResult> {
  if (input.subjectType !== 'task' && input.subjectType !== 'request') {
    return fail('invalid', 'subjectType must be "task" or "request".', 400)
  }
  const subjectId = input.subjectId.trim()
  if (!subjectId) return fail('invalid', 'subjectId is required.', 400)
  const note = sanitiseHandoffNote(input.note)
  if (!note) return fail('invalid', 'A note saying what developer work is needed is required.', 400)
  if (note.length > MAX_HANDOFF_NOTE_LENGTH) {
    return fail('invalid', `The note must be at most ${MAX_HANDOFF_NOTE_LENGTH} characters.`, 400)
  }

  const developerOrFailure = await resolveDeveloper(database)
  if ('ok' in developerOrFailure) return developerOrFailure
  const developer = developerOrFailure

  const author = await resolveAuthor(database, input.actorUserId)
  const body = `Developer handoff: ${note}`
  const isSelf = author.teamMemberId === developer.id

  let addedAsAssignee = false
  let noteId: string
  let subjectTitle: string

  if (input.subjectType === 'request') {
    const [request] = await database
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        assigneeId: schema.requests.assigneeId,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, subjectId))
      .limit(1)
    if (!request) return fail('not_found', 'Request not found.', 404)
    subjectTitle = request.title

    const [held] = await database
      .select({ id: schema.requestParticipants.id })
      .from(schema.requestParticipants)
      .where(and(
        eq(schema.requestParticipants.requestId, request.id),
        eq(schema.requestParticipants.participantId, developer.id),
        eq(schema.requestParticipants.participantType, 'team_member'),
        isNull(schema.requestParticipants.removedAt),
      ))
      .limit(1)
    if (!held) {
      await database.insert(schema.requestParticipants).values({
        id: crypto.randomUUID(),
        requestId: request.id,
        participantId: developer.id,
        participantType: 'team_member',
        role: 'assignee',
        addedById: input.actorUserId,
        addedByType: 'team_member',
        addedAt: new Date().toISOString(),
        removedAt: null,
      })
      addedAsAssignee = true
    }

    // The UI keeps requests.assigneeId in step with the participant row, so
    // fill it when empty. An existing assignee is never overwritten.
    if (!request.assigneeId) {
      await database
        .update(schema.requests)
        .set({ assigneeId: developer.id, updatedAt: new Date().toISOString() })
        .where(eq(schema.requests.id, request.id))
      addedAsAssignee = true
    }

    noteId = await postInternalRequestNote(database, request, author, body)
  } else {
    const [task] = await database
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        assigneeId: schema.tasks.assigneeId,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, subjectId))
      .limit(1)
    if (!task) return fail('not_found', 'Task not found.', 404)
    subjectTitle = task.title

    // A task has one assignee and no follower concept, so an existing
    // assignee stays and the comment plus the bell carry the handoff.
    if (!task.assigneeId) {
      await database
        .update(schema.tasks)
        .set({
          assigneeId: developer.id,
          assigneeType: 'team_member',
          updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        })
        .where(eq(schema.tasks.id, task.id))
      addedAsAssignee = true
    }

    const comment = await postTaskComment(database, {
      taskId: task.id,
      author: author.teamMemberId
        ? { authorType: 'team_member', authorId: author.teamMemberId }
        : { authorType: TAHI_BOT.authorType, authorId: null },
      body,
    })
    noteId = comment.id
  }

  let notified = false
  if (!isSelf) {
    const byline = author.name ? `${author.name} handed off` : 'Developer handoff'
    const result = await notifyTeamMember(database, developer.id, {
      type: input.subjectType === 'request' ? 'request_assigned' : 'task_assigned',
      title: `${byline}: ${truncate(subjectTitle, 120)}`,
      body: truncate(note, 280),
      entityType: input.subjectType,
      entityId: subjectId,
    })
    notified = result.delivered > 0
  }

  // One audit row per handoff, so a task assignment made here (a direct
  // update, not updateTaskRecord, to avoid a second bell and a Slack sync)
  // still leaves a trail. logAudit never throws.
  await logAudit(database as Parameters<typeof logAudit>[0], {
    action: 'developer_handoff',
    userId: input.actorUserId,
    userType: 'team_member',
    entityType: input.subjectType,
    entityId: subjectId,
    metadata: { developerTeamMemberId: developer.id, addedAsAssignee, noteId },
  })

  return {
    ok: true,
    developerTeamMemberId: developer.id,
    developerName: developer.name,
    addedAsAssignee,
    noteId,
    notified,
  }
}
