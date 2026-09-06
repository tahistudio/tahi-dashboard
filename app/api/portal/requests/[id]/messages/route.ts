import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import {
  actingByline,
  actingIdentity,
  authorFor,
  recordActingWrite,
  refusePreviewWrite,
} from '@/lib/acting-as'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import {
  messageSummary,
  threadReplyEmailPlan,
  toPlainText,
  truncate,
} from '@/lib/notification-email'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

type Params = { params: Promise<{ id: string }> }

// ── POST /api/portal/requests/[id]/messages ──────────────────────────────────
// Clients post messages to a request thread (always external : isInternal: false).
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await getPortalAuth(req)
    const { orgId, userId, clerkOrgId } = auth

    const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')

    if (featureDenied) return featureDenied

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // OPEN in act mode. The message lands as the STUDIO member, not as the
    // client: db/schema.ts already types author_type as 'team_member' |
    // 'contact', and the thread projection in ../route.ts already left-joins
    // team_members on it, so the client reads it as the studio with no change
    // to the reader and no migration.
    const previewDenied = refusePreviewWrite(auth, { allowActing: true })
    if (previewDenied) return previewDenied
    const acting = actingIdentity(auth)

    const { id } = await params

    let body: { body?: string }
    try {
      body = await req.json() as { body?: string }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.body?.trim()) {
      return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
    }

    // Client HTML rendered to admins via dangerouslySetInnerHTML: sanitise here.
    const safeBody = sanitizeRichText(body.body)
    if (!safeBody.trim()) {
      return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
    }

    const database = await db()
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

    // Verify this request belongs to the client's org. The same read carries
    // the title, assignee and per-org number the studio notification and its
    // subject prefix need.
    const [request] = await drizzle
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        requestNumber: schema.requests.requestNumber,
        assigneeId: schema.requests.assigneeId,
      })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.id, id),
        eq(schema.requests.orgId, orgId),
        eq(schema.requests.isInternal, false),
      ))
      .limit(1)

    if (!request) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Look up contact record by Clerk user ID. The name signs the email.
    const [contact] = await drizzle
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(eq(schema.contacts.clerkUserId, userId))
      .limit(1)

    const author = authorFor(acting, contact?.id ?? userId)

    const msgId = crypto.randomUUID()

    // The record FIRST, against the id the insert below is about to use.
    // Awaited and allowed to throw, and deliberately ahead of the write rather
    // than behind it: a message posted into a client's thread by the studio
    // must never exist without the row that says who did it, and ordering it
    // last only guaranteed a loud failure AFTER the message had landed, which
    // then invited a retry and a duplicate. This way a failed record leaves
    // the thread untouched. No-op on the ordinary client path.
    await recordActingWrite(drizzle as unknown as DB, acting, {
      verb: 'message.posted',
      entityType: 'request',
      entityId: id,
      route: 'POST /api/portal/requests/[id]/messages',
      extra: { messageId: msgId, requestNumber: request.requestNumber },
    })

    await drizzle.insert(schema.messages).values({
      id: msgId,
      requestId: id,
      orgId,
      authorId: author.id,
      authorType: author.type,
      body: safeBody,
      isInternal: false,
    })

    await drizzle
      .update(schema.requests)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.requests.id, id))

    // Tell the studio, in the bell and in the inbox, off one resolved audience.
    // Fan out to the assignee, every team participant and the client's PM,
    // falling back to the whole team when the request has not been triaged yet
    // (which is exactly when a first message tends to arrive).
    //
    // A two person studio works out of email, so a client question that only
    // lit a bell nobody had open is a question that waits a day. The email is
    // the same event, so it rides the same payload: this route used to resolve
    // the studio a second time for itself, on a second fallback rule, and the
    // two channels could disagree about who the studio side of a request is.
    // The send still happens off the response path, so the client's composer
    // does not wait on Resend to clear.
    //
    // The quote is the client's own message, which is external by construction
    // on this route: an internal note can never be reached from here.
    await notifyRequestTeam(
      drizzle,
      { requestId: id, orgId, assigneeId: request.assigneeId ?? null },
      {
        type: 'new_message',
        title: acting
          ? `Studio reply on "${request.title}" (sent as the client's workspace)`
          : `New client message on "${request.title}"`,
        body: messageSummary(safeBody) + actingByline(acting, 'sent'),
        entityType: 'request',
        entityId: id,
        email: threadReplyEmailPlan({
          audience: 'studio',
          requestId: id,
          requestTitle: request.title,
          requestNumber: request.requestNumber,
          fromName: acting
            ? `${acting.adminName} at Tahi Studio`
            : (contact?.name?.trim() || 'A client'),
          message: truncate(toPlainText(safeBody), 900),
        }),
      },
    )

    return NextResponse.json({ id: msgId }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/requests/[id]/messages]', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
