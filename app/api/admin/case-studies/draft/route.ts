import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// POST /api/admin/case-studies/draft
// Accepts a submissionId and generates a placeholder case study draft.
// TODO: Wire to Claude API for actual AI-generated drafts.
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { submissionId?: string }

  if (!body.submissionId) {
    return NextResponse.json({ error: 'submissionId is required' }, { status: 400 })
  }

  const database = await db()

  const submissions = await database
    .select()
    .from(schema.caseStudySubmissions)
    .where(eq(schema.caseStudySubmissions.id, body.submissionId))
    .limit(1)

  if (submissions.length === 0) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
  }

  const submission = submissions[0]

  // Get org info
  const orgs = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, submission.orgId))
    .limit(1)

  const orgName = orgs.length > 0 ? orgs[0].name : 'Client'

  // Generate placeholder draft
  const draftContent = `# Case Study: ${orgName}

## Overview

${orgName} partnered with Tahi Studio to ${submission.projectName ? `deliver "${submission.projectName}"` : 'enhance their digital presence'}.

## The Challenge

[To be written based on client context]

## The Solution

[To be written based on project details]

## Results

${submission.writtenTestimonial ? `> "${submission.writtenTestimonial}"` : '[Client testimonial to be added]'}

${submission.npsScore !== null ? `**Net Promoter Score:** ${submission.npsScore}/10` : ''}

## About ${orgName}

[Client description to be added]

---

*This is a placeholder draft. Connect the Claude API to generate a full AI-powered case study.*`

  const now = new Date().toISOString()

  // Check if a case study already exists for this submission
  const existing = await database
    .select()
    .from(schema.caseStudies)
    .where(eq(schema.caseStudies.submissionId, body.submissionId))
    .limit(1)

  if (existing.length > 0) {
    // Update existing
    await database
      .update(schema.caseStudies)
      .set({
        contentMd: draftContent,
        draftGeneratedByAi: true,
        updatedAt: now,
      })
      .where(eq(schema.caseStudies.id, existing[0].id))

    return NextResponse.json({ success: true, caseStudyId: existing[0].id, draft: draftContent })
  }

  // Create new
  const id = crypto.randomUUID()
  await database.insert(schema.caseStudies).values({
    id,
    orgId: submission.orgId,
    submissionId: body.submissionId,
    title: `Case Study: ${orgName}`,
    contentMd: draftContent,
    draftGeneratedByAi: true,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ success: true, caseStudyId: id, draft: draftContent })
}
