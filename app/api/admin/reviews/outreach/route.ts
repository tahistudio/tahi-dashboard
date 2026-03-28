import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql, eq, and, isNull } from 'drizzle-orm'

// POST /api/admin/reviews/outreach
// Trigger review outreach for all orgs older than N days (default 90) that
// do not already have a case study submission.
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { minAgeDays?: number }
  const minAgeDays = body.minAgeDays ?? 90

  const database = await db()

  // Find active orgs created more than minAgeDays ago
  const cutoff = new Date(Date.now() - minAgeDays * 86400000).toISOString()

  const eligibleOrgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
    .where(
      and(
        eq(schema.organisations.status, 'active'),
        sql`${schema.organisations.createdAt} <= ${cutoff}`
      )
    )

  // Get orgs that already have a submission
  const existingSubmissions = await database
    .select({ orgId: schema.caseStudySubmissions.orgId })
    .from(schema.caseStudySubmissions)

  const existingOrgIds = new Set(existingSubmissions.map(s => s.orgId))

  // Filter out orgs with neverAsk submissions
  const neverAskSubmissions = await database
    .select({ orgId: schema.caseStudySubmissions.orgId })
    .from(schema.caseStudySubmissions)
    .where(eq(schema.caseStudySubmissions.neverAsk, 1))

  const neverAskOrgIds = new Set(neverAskSubmissions.map(s => s.orgId))

  const orgsToOutreach = eligibleOrgs.filter(
    o => !existingOrgIds.has(o.id) && !neverAskOrgIds.has(o.id)
  )

  const now = new Date().toISOString()
  const tokenExpiry = new Date(Date.now() + 30 * 86400000).toISOString()
  const created: string[] = []

  for (const org of orgsToOutreach) {
    const token = crypto.randomUUID()
    await database.insert(schema.caseStudySubmissions).values({
      orgId: org.id,
      submissionToken: token,
      outreachStatus: 'not_sent',
      tokenExpiresAt: tokenExpiry,
      createdAt: now,
      updatedAt: now,
    })
    created.push(org.id)
  }

  return NextResponse.json({
    success: true,
    created: created.length,
    eligible: eligibleOrgs.length,
    skipped: eligibleOrgs.length - created.length,
  })
}
