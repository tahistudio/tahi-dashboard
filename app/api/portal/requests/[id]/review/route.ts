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
    const auth = await getPortalAuth(req)
    const { orgId, userId, clerkOrgId } = auth

    const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')

    if (featureDenied) return featureDenied

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // OPEN in act mode, and the decision message is signed by the studio. This
    // is the one opened route where the wrong attribution would be a real lie:
    // "the client approved this" has to mean the client, so an acting approval
    // reads as the studio closing it out on their behalf.
    const previewDenied = refusePreviewWrite(auth, { allowActing: true })
    if (previewDenied) return previewDenied
    const acting = actingIdentity(auth)

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

    const author = authorFor(acting, contact?.id ?? userId)

    const messageId = crypto.randomUUID()
    await drizzle.insert(schema.messages).values({
      id: messageId,
      requestId: id,
      orgId,
      authorId: author.id,
      authorType: author.type,
      body: buildReviewMessageHtml(decision, note),
      isInternal: false,
    })

    // Before the response and outside the best-effort block below: the status
    // has already moved, so the record of who moved it is not optional.
    await recordActingWrite(drizzle as unknown as DB, acting, {
      verb: 'review.submitted',
      entityType: 'request',
      entityId: id,
      route: 'POST /api/portal/requests/[id]/review',
      extra: { decision, nextStatus, messageId, note: note?.trim() || null },
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
          body: (decision === 'approve'
            ? 'The client approved this delivery. It is now marked delivered.'
            : 'The client asked for changes. It is back in progress.')
            + actingByline(acting, 'recorded'),
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
          // `source` keeps its historical value so any automation condition
          // reading it is untouched; the acting flag rides beside it.
          source: 'portal_review',
          actingAs: acting ? acting.adminTeamMemberId : null,
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
