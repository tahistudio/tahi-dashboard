import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

// ── GET /api/admin/reviews ─────────────────────────────────────────────────
// List all orgs with their outreach status.
// If no caseStudySubmission exists for an org, show as 'not_sent'.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Get all organisations
  const orgs = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      planType: schema.organisations.planType,
      status: schema.organisations.status,
    })
    .from(schema.organisations)
    .orderBy(desc(schema.organisations.updatedAt))

  // Get all case study submissions
  const submissions = await database
    .select()
    .from(schema.caseStudySubmissions)

  // Map submissions by orgId
  const submissionsByOrg = new Map<string, typeof submissions[number]>()
  for (const s of submissions) {
    // Keep the most recent submission per org
    if (!submissionsByOrg.has(s.orgId) || (s.createdAt > (submissionsByOrg.get(s.orgId)?.createdAt ?? ''))) {
      submissionsByOrg.set(s.orgId, s)
    }
  }

  const reviews = orgs.map(org => {
    const submission = submissionsByOrg.get(org.id)
    return {
      orgId: org.id,
      orgName: org.name,
      planType: org.planType,
      orgStatus: org.status,
      outreachStatus: submission?.outreachStatus ?? 'not_sent',
      submissionId: submission?.id ?? null,
      npsScore: submission?.npsScore ?? null,
      writtenTestimonial: submission?.writtenTestimonial ?? null,
      videoUrl: submission?.videoUrl ?? null,
      marketingPermission: submission?.marketingPermission ?? null,
      logoPermission: submission?.logoPermission ?? null,
      caseStudyPermission: submission?.caseStudyPermission ?? null,
      clutchReviewUrl: submission?.clutchReviewUrl ?? null,
      submittedAt: submission?.submittedAt ?? null,
      nextAskAt: submission?.nextAskAt ?? null,
      neverAsk: submission?.neverAsk ?? 0,
      submissionToken: submission?.submissionToken ?? null,
      lovedMost: submission?.lovedMost ?? null,
      improve: submission?.improve ?? null,
      projectName: submission?.projectName ?? null,
    }
  })

  return NextResponse.json({ reviews })
}

// ── POST /api/admin/reviews ────────────────────────────────────────────────
// Create or update outreach for an org.
// Body: { orgId, outreachStatus, nextAskAt? }
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    orgId?: string
    outreachStatus?: string
    nextAskAt?: string
  }

  if (!body.orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const validStatuses = ['not_sent', 'asked', 'declined', 'deferred', 'in_progress', 'completed']
  if (body.outreachStatus && !validStatuses.includes(body.outreachStatus)) {
    return NextResponse.json({ error: 'Invalid outreachStatus' }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()

  // Check if a submission exists for this org
  const existing = await database
    .select({ id: schema.caseStudySubmissions.id })
    .from(schema.caseStudySubmissions)
    .where(eq(schema.caseStudySubmissions.orgId, body.orgId))
    .limit(1)

  if (existing.length > 0) {
    // Update existing submission
    const updates: Record<string, unknown> = { updatedAt: now }
    if (body.outreachStatus) updates.outreachStatus = body.outreachStatus
    if (body.nextAskAt !== undefined) updates.nextAskAt = body.nextAskAt
    if (body.outreachStatus === 'declined') updates.neverAsk = 1

    await database
      .update(schema.caseStudySubmissions)
      .set(updates)
      .where(eq(schema.caseStudySubmissions.id, existing[0].id))

    return NextResponse.json({ id: existing[0].id, updated: true })
  } else {
    // Create new submission record
    const id = crypto.randomUUID()
    const token = crypto.randomUUID()

    await database.insert(schema.caseStudySubmissions).values({
      id,
      orgId: body.orgId,
      submissionToken: token,
      outreachStatus: body.outreachStatus ?? 'asked',
      nextAskAt: body.nextAskAt ?? null,
      neverAsk: body.outreachStatus === 'declined' ? 1 : 0,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })

    return NextResponse.json({ id, token, created: true }, { status: 201 })
  }
}
