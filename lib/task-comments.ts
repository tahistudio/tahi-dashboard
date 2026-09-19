/**
 * lib/task-comments.ts
 *
 * The task thread: `task_comments` rows, and the one writer, `postTaskComment`,
 * every route and every automation goes through.
 *
 * A task has no conversation row of its own (see the Batch 1 messaging note
 * in db/schema.ts): a task with a `requestId` can reach that request's
 * thread, a task without one had nowhere to post before this table existed.
 * `postTaskComment` closes that gap AND keeps the studio's one place for
 * client-facing history in sync: when the task carries a `requestId`, the
 * same line is mirrored into that request's thread as an internal `messages`
 * row, so the studio sees automation and hand-off notes where the
 * client-facing work actually lives, rather than in a second place nobody
 * but the task page ever opens.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router routes
 * may only export HTTP methods and config.
 */

import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { TAHI_BOT } from '@/lib/tahi-bot'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface TaskCommentAuthor {
  /** team_member | contact | bot. 'bot' never carries a real authorId. */
  authorType: 'team_member' | 'contact' | 'bot'
  authorId: string | null
}

export interface TaskCommentRow {
  id: string
  taskId: string
  authorType: string
  authorId: string | null
  body: string
  quote: string | null
  sourceRef: string | null
  createdAt: string
}

/** The current timestamp, in the same shape every other writer in this repo
 *  stamps: no milliseconds, so it sorts and compares against rows written by
 *  `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` the same way. */
function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * The text mirrored into the request thread. A quote is rendered above the
 * line it justified rather than folded into the sentence, so a reader who
 * only skims the request thread still sees what the comment rests on.
 */
function mirrorBody(body: string, quote: string | null | undefined): string {
  return quote ? `"${quote}"\n\n${body}` : body
}

/**
 * One internal `messages` row on a request's thread.
 *
 * The single insert both thread writers in this file share: the task comment
 * mirror below, and `postRequestBotMessage`, which applying a REQUEST
 * suggestion uses (lib/task-suggestions.ts). Shared rather than typed twice
 * because the two have to agree on four things that are easy to get subtly
 * different: the bot's stand-in author id, the quote-above-body layout, the
 * isInternal flag, and the fact that this is never client-visible.
 */
async function insertRequestThreadMessage(
  drizzle: Drizzle,
  input: {
    requestId: string
    orgId: string
    author: TaskCommentAuthor
    body: string
    quote: string | null
  },
): Promise<string> {
  const id = crypto.randomUUID()
  await drizzle.insert(schema.messages).values({
    id,
    requestId: input.requestId,
    orgId: input.orgId,
    // The bot has no roster row; TAHI_BOT.id stands in for authorId so the
    // row still carries a stable, non-empty value.
    authorId: input.author.authorType === 'bot' ? TAHI_BOT.id : (input.author.authorId ?? 'unknown'),
    authorType: input.author.authorType,
    body: mirrorBody(input.body, input.quote),
    // Always internal: this is the studio's own record of what changed, not a
    // line the client asked for or should see.
    isInternal: true,
  })
  return id
}

/**
 * Post one line on a request's thread as the Tahi bot.
 *
 * What applying a request suggestion leaves behind, and the exact twin of the
 * line a task suggestion leaves on its task (which is mirrored here too when
 * the task carries a requestId). One helper so the two cannot drift: a reader
 * scrolling a request thread sees the same voice, the same quote treatment
 * and the same internal-only rule whichever door the automation came in by.
 *
 * NO sourceRef. `messages` has no source_ref column, only task_comments does,
 * and adding one to the request thread is not in this slice; the suggestion
 * id lives on the audit row instead.
 *
 * Throws when the request does not exist, so a caller cannot write a line
 * onto a row that was deleted underneath it and have it silently vanish.
 */
export async function postRequestBotMessage(
  drizzle: Drizzle,
  requestId: string,
  input: { body: string; quote?: string | null },
): Promise<string> {
  const [request] = await drizzle
    .select({ id: schema.requests.id, orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)

  if (!request) throw new Error('Request not found')

  return insertRequestThreadMessage(drizzle, {
    requestId,
    orgId: request.orgId,
    author: { authorType: TAHI_BOT.authorType, authorId: null },
    body: input.body,
    quote: input.quote?.trim() ? input.quote.trim() : null,
  })
}

/**
 * Insert one task_comments row and, when the task has a requestId, mirror it
 * into that request's thread.
 *
 * Throws when the task does not exist, so a caller cannot write a comment
 * onto a row that was deleted underneath it and have it silently vanish.
 */
export async function postTaskComment(
  drizzle: Drizzle,
  input: {
    taskId: string
    author: TaskCommentAuthor
    body: string
    quote?: string | null
    sourceRef?: string | null
  },
): Promise<TaskCommentRow> {
  const [task] = await drizzle
    .select({ id: schema.tasks.id, requestId: schema.tasks.requestId, orgId: schema.tasks.orgId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, input.taskId))
    .limit(1)

  if (!task) throw new Error('Task not found')

  const createdAt = now()
  const id = crypto.randomUUID()
  const quote = input.quote?.trim() ? input.quote.trim() : null
  const sourceRef = input.sourceRef?.trim() ? input.sourceRef.trim() : null

  await drizzle.insert(schema.taskComments).values({
    id,
    taskId: input.taskId,
    authorType: input.author.authorType,
    authorId: input.author.authorId,
    body: input.body,
    quote,
    sourceRef,
    createdAt,
  })

  // A task without a request has nowhere else this line belongs; a task
  // without an org (tahi_internal) is studio housekeeping with no client
  // thread to mirror into either.
  if (task.requestId && task.orgId) {
    await insertRequestThreadMessage(drizzle, {
      requestId: task.requestId,
      orgId: task.orgId,
      author: input.author,
      body: input.body,
      quote,
    })
  }

  return { id, taskId: input.taskId, authorType: input.author.authorType, authorId: input.author.authorId, body: input.body, quote, sourceRef, createdAt }
}

/** Every comment on one task, oldest first: the order the thread reads in. */
export async function listTaskComments(drizzle: Drizzle, taskId: string): Promise<TaskCommentRow[]> {
  const rows = await drizzle
    .select({
      id: schema.taskComments.id,
      taskId: schema.taskComments.taskId,
      authorType: schema.taskComments.authorType,
      authorId: schema.taskComments.authorId,
      body: schema.taskComments.body,
      quote: schema.taskComments.quote,
      sourceRef: schema.taskComments.sourceRef,
      createdAt: schema.taskComments.createdAt,
    })
    .from(schema.taskComments)
    .where(eq(schema.taskComments.taskId, taskId))

  return [...rows].sort((a, b) => {
    const at = a.createdAt ?? ''
    const bt = b.createdAt ?? ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
}
