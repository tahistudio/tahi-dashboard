import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

/**
 * GET /api/portal/review-outreach
 * Checks if the current org has a pending outreach.
 */
export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const database = await db()

  // Find contact to get their orgId
  const contactRows = await database
    .select({ orgId: schema.contacts.orgId })
    .from(schema.contacts)
    .where(eq(schema.contacts.clerkUserId, userId))
    .limit(1)

  const contactOrgId = contactRows.length > 0 ? contactRows[0].orgId : orgId

  // Check for pending case study outreach
  const submissions = await database
    .select()
    .from(schema.caseStudySubmissions)
    .where(
      and(
        eq(schema.caseStudySubmissions.orgId, contactOrgId),
        eq(schema.caseStudySubmissions.outreachStatus, 'asked')
      )
    )
    .limit(1)

  // Also check if neverAsk is set
  const neverAskRows = await database
    .select()
    .from(schema.caseStudySubmissions)
    .where(
      and(
        eq(schema.caseStudySubmissions.orgId, contactOrgId),
        eq(schema.caseStudySubmissions.neverAsk, 1)
      )
    )
    .limit(1)

  const pending = submissions.length > 0 && neverAskRows.length === 0

  return NextResponse.json({ pending })
}

/**
 * POST /api/portal/review-outreach
 * Body: { action: 'yes' | 'defer' | 'no' }
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { action?: string }
  const { action } = body

  if (!action || !['yes', 'defer', 'no'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const database = await db()

  // Find contact org
  const contactRows = await database
    .select({ orgId: schema.contacts.orgId })
    .from(schema.contacts)
    .where(eq(schema.contacts.clerkUserId, userId))
    .limit(1)

  const contactOrgId = contactRows.length > 0 ? contactRows[0].orgId : orgId

  // Find the submission
  const submissions = await database
    .select()
    .from(schema.caseStudySubmissions)
    .where(eq(schema.caseStudySubmissions.orgId, contactOrgId))
    .limit(1)

  if (submissions.length === 0) {
    return NextResponse.json({ success: true })
  }

  const sub = submissions[0]
  const now = new Date().toISOString()

  if (action === 'yes') {
    await database
      .update(schema.caseStudySubmissions)
      .set({ outreachStatus: 'in_progress', updatedAt: now })
      .where(eq(schema.caseStudySubmissions.id, sub.id))
  } else if (action === 'defer') {
    // Defer for 7 days
    const nextAsk = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await database
      .update(schema.caseStudySubmissions)
      .set({ outreachStatus: 'deferred', nextAskAt: nextAsk, updatedAt: now })
      .where(eq(schema.caseStudySubmissions.id, sub.id))
  } else if (action === 'no') {
    await database
      .update(schema.caseStudySubmissions)
      .set({ outreachStatus: 'declined', neverAsk: 1, updatedAt: now })
      .where(eq(schema.caseStudySubmissions.id, sub.id))
  }

  return NextResponse.json({ success: true })
}
