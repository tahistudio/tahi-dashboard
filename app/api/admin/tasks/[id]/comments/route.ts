import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { inArray } from 'drizzle-orm'
import { guardTask } from '@/lib/task-access'
import { resolveTeamMember } from '@/lib/team-identity'
import { listTaskComments, postTaskComment } from '@/lib/task-comments'
import { TAHI_BOT } from '@/lib/tahi-bot'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface CommentView {
  id: string
  authorType: string
  authorId: string | null
  authorName: string
  body: string
  quote: string | null
  sourceRef: string | null
  createdAt: string
}

/** Batch-resolves comment authors to a display name. Mirrors the name
 *  lookups lib/messages-store.ts#loadNames does for the request thread, kept
 *  local because this thread's rows are a different table and a much shorter
 *  list. */
async function resolveAuthorNames(
  drizzle: Drizzle,
  comments: readonly { authorType: string; authorId: string | null }[],
): Promise<Map<string, string>> {
  const teamIds = [...new Set(
    comments.filter(c => c.authorType === 'team_member' && c.authorId).map(c => c.authorId as string),
  )]
  const contactIds = [...new Set(
    comments.filter(c => c.authorType === 'contact' && c.authorId).map(c => c.authorId as string),
  )]

  const names = new Map<string, string>()
  names.set(TAHI_BOT.id, TAHI_BOT.name)

  if (teamIds.length > 0) {
    const rows = await drizzle
      .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
      .from(schema.teamMembers)
      .where(inArray(schema.teamMembers.id, teamIds))
    for (const r of rows) names.set(r.id, r.name)
  }
  if (contactIds.length > 0) {
    const rows = await drizzle
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(inArray(schema.contacts.id, contactIds))
    for (const r of rows) names.set(r.id, r.name)
  }
  return names
}

// ── GET /api/admin/tasks/[id]/comments ────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId } = await params

  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardTask(drizzle, userId, taskId)
  if (denied) return denied

  const rows = await listTaskComments(drizzle, taskId)
  const names = await resolveAuthorNames(drizzle, rows)

  const comments: CommentView[] = rows.map(c => ({
    id: c.id,
    authorType: c.authorType,
    authorId: c.authorId,
    // A name that never resolved (a deleted teammate, a deleted contact)
    // still reads as something rather than an empty label.
    authorName: c.authorType === 'bot'
      ? TAHI_BOT.name
      : (c.authorId ? names.get(c.authorId) ?? 'Unknown' : 'Unknown'),
    body: c.body,
    quote: c.quote,
    sourceRef: c.sourceRef,
    createdAt: c.createdAt,
  }))

  return NextResponse.json({ comments })
}

// ── POST /api/admin/tasks/[id]/comments ───────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId } = await params

  const body = await req.json() as { body?: string; asBot?: boolean }
  const text = body.body?.trim()
  if (!text) {
    return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardTask(drizzle, userId, taskId)
  if (denied) return denied

  // `asBot` is for automations calling through the MCP tool
  // (post_task_comment's as_bot), not a choice the dashboard composer offers
  // a person: the checkbox does not exist in the UI, only the field on the
  // wire. A human posting normally resolves to their own roster identity, the
  // same lookup the request thread's POST uses.
  const author = body.asBot
    ? { authorType: 'bot' as const, authorId: null }
    : await (async () => {
        const member = await resolveTeamMember(drizzle, userId)
        return { authorType: 'team_member' as const, authorId: member?.id ?? userId ?? 'unknown' }
      })()

  const comment = await postTaskComment(drizzle, {
    taskId,
    author,
    body: text,
  })

  return NextResponse.json({ comment }, { status: 201 })
}
