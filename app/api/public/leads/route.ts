/**
 * POST /api/public/leads
 *
 * Public endpoint for Webflow form submissions + other external lead
 * intake. Lives under /api/public/ which the middleware lets through
 * without Clerk auth.
 *
 * Security: requires a Bearer token matching the PUBLIC_LEAD_SECRET
 * env var (set on Webflow Cloud + as an Authorization header in the
 * Webflow form webhook configuration). Without this, any rando on the
 * internet could create leads.
 *
 * Body shape: same as the admin POST, plus UTM fields that are folded
 * into sourceDetail as a structured string. Recognised UTM keys:
 *   utmSource, utmMedium, utmCampaign, utmTerm, utmContent
 *
 * source defaults to 'webflow' if not provided. ownerId defaults to
 * leads.defaultLeadOwnerId setting (typically Liam).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { lookupOrCreatePerson } from '@/lib/people'

export const dynamic = 'force-dynamic'

interface PublicLeadBody {
  name?: string
  email?: string | null
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  website?: string | null
  brief?: string | null
  source?: string                  // defaults to 'webflow'
  sourceDetail?: string | null
  affiliateCode?: string | null
  estimatedValue?: number | null
  currency?: string
  // UTM fields (Webflow form fields + JS-captured query params)
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmTerm?: string | null
  utmContent?: string | null
  // Free-form referer (captured client-side)
  referer?: string | null
}

function buildSourceDetail(body: PublicLeadBody): string | null {
  const parts: string[] = []
  if (body.sourceDetail?.trim()) parts.push(body.sourceDetail.trim())
  const utm: Array<[string, string | null | undefined]> = [
    ['utm_source', body.utmSource],
    ['utm_medium', body.utmMedium],
    ['utm_campaign', body.utmCampaign],
    ['utm_term', body.utmTerm],
    ['utm_content', body.utmContent],
  ]
  for (const [key, val] of utm) {
    if (val?.trim()) parts.push(`${key}:${val.trim()}`)
  }
  if (body.referer?.trim()) parts.push(`referer:${body.referer.trim().slice(0, 200)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export async function POST(req: NextRequest) {
  // Bearer secret check — prevents the public endpoint from accepting
  // arbitrary lead spam.
  const expected = process.env.PUBLIC_LEAD_SECRET
  if (!expected) {
    return NextResponse.json({
      error: 'PUBLIC_LEAD_SECRET not configured. Add it as an env var first.',
    }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: PublicLeadBody
  try {
    body = await req.json() as PublicLeadBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const database = await db()

  // Resolve default owner from settings
  let ownerId: string | null = null
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

  // Canonical person lookup-or-create
  const personId = await lookupOrCreatePerson(database, {
    fullName: body.name.trim(),
    email: body.email,
    phone: body.phone,
  })

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  // If the lead source is unspecified, default to 'webflow' (the most
  // common origin for this endpoint). If utmSource is set, surface it
  // as the source value too so the leads list filterable by it.
  const resolvedSource = body.source?.trim() || (body.utmSource?.trim() || 'webflow')

  await database.insert(schema.leads).values({
    id,
    personId,
    name: body.name.trim(),
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    company: body.company?.trim() || null,
    jobTitle: body.jobTitle?.trim() || null,
    website: body.website?.trim() || null,
    source: resolvedSource,
    sourceDetail: buildSourceDetail(body),
    affiliateCode: body.affiliateCode?.trim() || null,
    brief: body.brief?.trim() || null,
    estimatedValue: body.estimatedValue ?? null,
    currency: body.currency || 'NZD',
    status: 'new',
    ownerId,
    createdAt: now,
    updatedAt: now,
  })

  // Activity stamp
  await database.insert(schema.activities).values({
    id: crypto.randomUUID(),
    type: 'lead_created',
    title: `Lead captured (public): ${body.name.trim()}`,
    description: body.brief?.trim() || null,
    leadId: id,
    createdById: 'system',
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id, personId }, { status: 201 })
}
