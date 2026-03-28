import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// ── GET /api/public/review?token=xxx ───────────────────────────────────────
// Validate token and return org info for the review form.
// No auth required - token-authenticated.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }

  const database = await db()

  const submissions = await database
    .select()
    .from(schema.caseStudySubmissions)
    .where(eq(schema.caseStudySubmissions.submissionToken, token))
    .limit(1)

  if (submissions.length === 0) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
  }

  const submission = submissions[0]

  // Check if token has expired
  if (submission.tokenExpiresAt && new Date(submission.tokenExpiresAt) < new Date()) {
    return NextResponse.json({ error: 'Token has expired' }, { status: 410 })
  }

  // Check if already completed
  if (submission.outreachStatus === 'completed') {
    return NextResponse.json({ error: 'Review already submitted', alreadyCompleted: true }, { status: 409 })
  }

  // Get org info
  const orgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, submission.orgId))
    .limit(1)

  const orgName = orgs.length > 0 ? orgs[0].name : 'Unknown'

  return NextResponse.json({
    orgId: submission.orgId,
    orgName,
    submissionId: submission.id,
    projectName: submission.projectName,
    hasExistingReview: !!(submission.writtenTestimonial || submission.npsScore),
  })
}

// ── POST /api/public/review ────────────────────────────────────────────────
// Submit a review. Token-authenticated, no Clerk login required.
// Body: { token, npsScore?, writtenReview?, logoPermission?, marketingPermission? }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    token?: string
    npsScore?: number
    writtenReview?: string
    logoPermission?: boolean
    marketingPermission?: boolean
    projectName?: string
    lovedMost?: string
    improve?: string
  }

  if (!body.token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }

  const database = await db()

  const submissions = await database
    .select()
    .from(schema.caseStudySubmissions)
    .where(eq(schema.caseStudySubmissions.submissionToken, body.token))
    .limit(1)

  if (submissions.length === 0) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
  }

  const submission = submissions[0]

  // Check if token has expired
  if (submission.tokenExpiresAt && new Date(submission.tokenExpiresAt) < new Date()) {
    return NextResponse.json({ error: 'Token has expired' }, { status: 410 })
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    updatedAt: now,
    submittedAt: now,
    outreachStatus: 'completed',
    status: 'pending',
  }

  if (body.npsScore !== undefined) {
    if (body.npsScore < 0 || body.npsScore > 10) {
      return NextResponse.json({ error: 'npsScore must be between 0 and 10' }, { status: 400 })
    }
    updates.npsScore = body.npsScore
  }

  if (body.writtenReview !== undefined) {
    updates.writtenTestimonial = body.writtenReview
  }

  if (body.logoPermission !== undefined) {
    updates.logoPermission = body.logoPermission
  }

  if (body.marketingPermission !== undefined) {
    updates.marketingPermission = body.marketingPermission
  }

  if (body.projectName !== undefined) {
    updates.projectName = body.projectName
  }

  if (body.lovedMost !== undefined) {
    updates.lovedMost = body.lovedMost
  }

  if (body.improve !== undefined) {
    updates.improve = body.improve
  }

  await database
    .update(schema.caseStudySubmissions)
    .set(updates)
    .where(eq(schema.caseStudySubmissions.id, submission.id))

  return NextResponse.json({ success: true, submissionId: submission.id })
}
