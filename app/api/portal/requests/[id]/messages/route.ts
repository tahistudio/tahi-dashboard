import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import { notifyRequestTeam, resolveRequestTeamMemberIds } from '@/lib/notify-request-team'
import {
  allStudioEmailTargets,
  dispatchNotificationEmails,
  messageSummary,
  resolveEmailTargets,
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
    const { orgId, userId, impersonating, clerkOrgId } = await getPortalAuth(req)

    const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')

    if (featureDenied) return featureDenied

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (impersonating) {
      return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
    }

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

    const msgId = crypto.randomUUID()
    await drizzle.insert(schema.messages).values({
      id: msgId,
      requestId: id,
      orgId,
      authorId: contact?.id ?? userId,
      authorType: 'contact',
      body: safeBody,
      isInternal: false,
    })

    await drizzle
      .update(schema.requests)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.requests.id, id))

    // Tell the studio. Fan out to the assignee, every team participant and the
    // client's PM, falling back to the whole team when the request has not been
    // triaged yet (which is exactly when a first message tends to arrive).
    const target = { requestId: id, orgId, assigneeId: request.assigneeId ?? null }

    await notifyRequestTeam(drizzle, target, {
      type: 'new_message',
      title: `New client message on "${request.title}"`,
      body: messageSummary(safeBody),
      entityType: 'request',
      entityId: id,
    })

    // And put it in their inbox. A two person studio works out of email, so a
    // client question that only lit a bell nobody had open is a question that
    // waits a day.
    //
    // The audience comes from the same resolver notifyRequestTeam uses, so the
    // two channels cannot drift. It is dispatched separately only because
    // RequestTeamPayload has no email slot; the studio-wide fallback is the
    // same one, for the same reason (an untriaged request still has to reach a
    // human).
    //
    // The quote is the client's own message, which is external by construction
    // on this route: an internal note can never be reached from here.
    const memberIds = await resolveRequestTeamMemberIds(drizzle, target)
    const specific = memberIds.length > 0
      ? await resolveEmailTargets(drizzle, memberIds.map((teamMemberId) => ({ teamMemberId })))
      : []
    const studio = specific.length > 0 ? specific : await allStudioEmailTargets(drizzle)

    await dispatchNotificationEmails(
      drizzle,
      studio,
      'new_message',
      threadReplyEmailPlan({
        audience: 'studio',
        requestId: id,
        requestTitle: request.title,
        requestNumber: request.requestNumber,
        fromName: contact?.name?.trim() || 'A client',
        message: truncate(toPlainText(safeBody), 900),
      }),
    )

    return NextResponse.json({ id: msgId }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/requests/[id]/messages]', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
