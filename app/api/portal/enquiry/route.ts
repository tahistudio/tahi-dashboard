import { getRequestAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createElement } from 'react'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { lookupOrCreatePerson } from '@/lib/people'
import { sendEmail } from '@/lib/email'
import ProjectEnquiryEmail from '@/emails/project-enquiry'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/enquiry
 *
 * A self-serve visitor's one-off project enquiry (the "tell us about the
 * project" path in onboarding). Records a lead (source = portal_enquiry,
 * assigned to the default lead owner) and emails business@tahi.studio so the
 * studio can follow up directly. Custom-project billing is handled off-platform,
 * so this just captures who they are and what they want.
 */
export async function POST(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    company?: string
    website?: string
    brief?: string
    budget?: string
    disciplines?: string
  }

  // Required fields.
  const company = (body.company ?? '').trim()
  const brief = (body.brief ?? '').trim()
  if (!company) return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  if (!brief) return NextResponse.json({ error: 'Tell us a little about the project' }, { status: 400 })

  // Identify the enquirer from their Clerk account.
  let contactName = 'Enquirer'
  let contactEmail = ''
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    contactName =
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
      (user.emailAddresses[0]?.emailAddress?.split('@')[0] ?? 'Enquirer')
    contactEmail = user.emailAddresses[0]?.emailAddress ?? ''
  } catch {
    // non-fatal: still record the enquiry
  }

  const database = await db()
  const now = new Date().toISOString()

  // Default lead owner from settings, validated to a real team member.
  let ownerId: string | null = null
  try {
    const [setting] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
      .limit(1)
    if (setting?.value) {
      const [member] = await database
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.id, setting.value))
        .limit(1)
      if (member) ownerId = member.id
    }
  } catch {
    // non-fatal
  }

  const detailParts: string[] = []
  if (body.disciplines?.trim()) detailParts.push(`Wants: ${body.disciplines.trim()}`)
  if (body.budget?.trim()) detailParts.push(`Budget: ${body.budget.trim()}`)
  const sourceDetail = detailParts.length ? detailParts.join(' | ') : null

  const id = crypto.randomUUID()
  try {
    const personId = await lookupOrCreatePerson(database, {
      fullName: contactName,
      email: contactEmail || undefined,
    })
    await database.insert(schema.leads).values({
      id,
      personId,
      name: contactName,
      email: contactEmail || null,
      company,
      website: body.website?.trim() || null,
      brief,
      source: 'portal_enquiry',
      sourceDetail,
      status: 'new',
      currency: 'USD',
      ownerId,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: 'lead_created',
      title: `Project enquiry: ${contactName}`,
      description: brief,
      leadId: id,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    })
  } catch (err) {
    console.error('[enquiry] failed to record lead', err)
    return NextResponse.json({ error: 'Could not record your enquiry' }, { status: 500 })
  }

  // Notify the studio directly. Non-fatal if Resend is not configured.
  try {
    await sendEmail(
      'business@tahi.studio',
      `New project enquiry from ${contactName}${company ? ` at ${company}` : ''}`,
      createElement(ProjectEnquiryEmail, {
        contactName,
        contactEmail,
        company,
        website: body.website?.trim() || null,
        brief,
        budget: body.budget?.trim() || null,
        disciplines: body.disciplines?.trim() || null,
      }),
    )
  } catch (err) {
    console.error('[enquiry] notification email failed', err)
  }

  return NextResponse.json({ ok: true, leadId: id })
}
