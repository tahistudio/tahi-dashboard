/**
 * POST /api/portal/requests/[id]/review
 *
 * Body : { decision: 'approve' | 'changes', note?: string }
 *
 * The client's review verdict on a delivery. Approving closes the request
 * (client_review -> delivered); asking for changes hands it back to the
 * studio (client_review -> in_progress). Either way the client's note is
 * posted to the thread as a message from them, so the studio reads the
 * decision and the reason in one place.
 *
 * This is deliberately separate from the PATCH on /api/portal/requests/[id],
 * which stays a single-purpose approve endpoint. Both are org-scoped to the
 * caller, refuse the Tahi org, refuse client-view impersonation, and only
 * act on a non-internal request already sitting in client review.
 */

import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import { dispatchDomainEvent } from '@/lib/events'
import {
  buildReviewMessageHtml,
  canReview,
  isReviewDecision,
  reviewDecisionLabel,
  reviewDecisionToStatus,
  type ReviewDecision,
} from '@/lib/request-review'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { orgId, userId, impersonating } = await getPortalAuth(req)

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (impersonating) {
      return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
    }

    const { id } = await params

    let body: { decision?: unknown; note?: unknown }
    try {
      body = await req.json() as { decision?: unknown; note?: unknown }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!isReviewDecision(body.decision)) {
      return NextResponse.json({ error: 'decision must be "approve" or "changes"' }, { status: 400 })
    }
    const decision: ReviewDecision = body.decision
    const note = typeof body.note === 'string' ? body.note : null

    const database = await db()
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

    // Scoped to the caller's own, non-internal request.
    const [request] = await drizzle
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        status: schema.requests.status,
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

    if (!canReview(request.status)) {
      return NextResponse.json(
        { error: 'Only a request in client review can be reviewed' },
        { status: 400 },
      )
    }

    const nextStatus = reviewDecisionToStatus(decision)
    const now = new Date().toISOString()

    await drizzle
      .update(schema.requests)
      .set({
        status: nextStatus,
        // deliveredAt only makes sense on an approval; a change request must
        // not stamp (or clear) it.
        ...(nextStatus === 'delivered' ? { deliveredAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(schema.requests.id, id))

    // Post the decision to the thread as the client. The body is built from
    // escaped text, never raw client HTML, so nothing needs sanitising here.
    const [contact] = await drizzle
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.clerkUserId, userId))
      .limit(1)

    const messageId = crypto.randomUUID()
    await drizzle.insert(schema.messages).values({
      id: messageId,
      requestId: id,
      orgId,
      authorId: contact?.id ?? userId,
      authorType: 'contact',
      body: buildReviewMessageHtml(decision, note),
      isInternal: false,
    })

    // Best-effort side effects. Neither may fail the review itself.
    try {
      // Fan the verdict out to the assignee, the request's team participants
      // and the client's PM, with the whole studio as the fallback: a delivery
      // can be reviewed on a request whose assignee was cleared.
      await notifyRequestTeam(
        drizzle,
        { requestId: id, orgId: request.orgId, assigneeId: request.assigneeId },
        {
          type: 'request_status_changed',
          title: `${reviewDecisionLabel(decision)}: "${request.title}"`,
          body: decision === 'approve'
            ? 'The client approved this delivery. It is now marked delivered.'
            : 'The client asked for changes. It is back in progress.',
          entityType: 'request',
          entityId: id,
        },
      )
      await dispatchDomainEvent(drizzle, {
        type: 'request_status_changed',
        entityId: id,
        entityType: 'request',
        orgId: request.orgId,
        data: {
          status: nextStatus,
          title: request.title,
          assigneeId: request.assigneeId ?? null,
          source: 'portal_review',
          decision,
        },
      })
    } catch {
      // Notification / event failures never fail the review.
    }

    return NextResponse.json({ success: true, status: nextStatus, messageId })
  } catch {
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
