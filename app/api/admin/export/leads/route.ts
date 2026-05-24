/**
 * GET /api/admin/export/leads
 *
 * Exports leads as CSV. Includes the full firmographic surface +
 * AI score + ICP-aware reason. Used for spreadsheet review,
 * one-off exports for outreach campaigns, or migrating to another
 * tool.
 *
 * Query (all optional):
 *   ?status=new|qualifying|nurturing|promoted|archived
 *   ?source=webflow|cold_outreach|...
 *   ?minScore=N      only leads with aiScore >= N
 *   ?industry=foo    case-insensitive contains
 *   ?country=NZ      exact
 *   ?ownerId=xxx
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, gte, like } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')
  const sourceFilter = url.searchParams.get('source')
  const minScoreRaw = parseInt(url.searchParams.get('minScore') ?? '', 10)
  const industryFilter = url.searchParams.get('industry')
  const countryFilter = url.searchParams.get('country')
  const ownerIdFilter = url.searchParams.get('ownerId')

  const database = await db()

  const conditions = []
  if (statusFilter && statusFilter !== 'all') {
    conditions.push(eq(schema.leads.status, statusFilter))
  }
  if (sourceFilter) {
    conditions.push(eq(schema.leads.source, sourceFilter))
  }
  if (Number.isFinite(minScoreRaw)) {
    conditions.push(gte(schema.leads.aiScore, minScoreRaw))
  }
  if (industryFilter) {
    conditions.push(like(schema.leads.industry, `%${industryFilter}%`))
  }
  if (countryFilter) {
    conditions.push(eq(schema.leads.country, countryFilter))
  }
  if (ownerIdFilter) {
    conditions.push(eq(schema.leads.ownerId, ownerIdFilter))
  }

  const rows = await database
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      email: schema.leads.email,
      phone: schema.leads.phone,
      jobTitle: schema.leads.jobTitle,
      linkedinPersonalUrl: schema.leads.linkedinPersonalUrl,
      company: schema.leads.company,
      website: schema.leads.website,
      linkedinUrl: schema.leads.linkedinUrl,
      industry: schema.leads.industry,
      country: schema.leads.country,
      leadType: schema.leads.leadType,
      employeeCount: schema.leads.employeeCount,
      revenueBand: schema.leads.revenueBand,
      yearFounded: schema.leads.yearFounded,
      monthlyVisits: schema.leads.monthlyVisits,
      cms: schema.leads.cms,
      techStack: schema.leads.techStack,
      source: schema.leads.source,
      sourceDetail: schema.leads.sourceDetail,
      status: schema.leads.status,
      aiScore: schema.leads.aiScore,
      aiScoreReason: schema.leads.aiScoreReason,
      estimatedValue: schema.leads.estimatedValue,
      currency: schema.leads.currency,
      ownerName: schema.teamMembers.name,
      brief: schema.leads.brief,
      enrichedAt: schema.leads.enrichedAt,
      lastAiRunAt: schema.leads.lastAiRunAt,
      createdAt: schema.leads.createdAt,
      updatedAt: schema.leads.updatedAt,
    })
    .from(schema.leads)
    .leftJoin(schema.teamMembers, eq(schema.leads.ownerId, schema.teamMembers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.leads.aiScore), desc(schema.leads.createdAt))

  const columns = [
    'ID', 'Name', 'Email', 'Phone', 'Job Title', 'Personal LinkedIn',
    'Company', 'Website', 'Company LinkedIn',
    'Industry', 'Country', 'Type',
    'Employees', 'Revenue Band', 'Year Founded', 'Monthly Visits',
    'CMS', 'Tech Stack',
    'Source', 'Source Detail', 'Status',
    'AI Score', 'AI Reason',
    'Estimated Value', 'Currency',
    'Owner', 'Brief',
    'Enriched At', 'Last AI Run', 'Created', 'Updated',
  ]

  const lines: string[] = [columns.join(',')]
  for (const r of rows) {
    let techStack = ''
    if (r.techStack) {
      try {
        const arr = JSON.parse(r.techStack)
        if (Array.isArray(arr)) techStack = arr.join('; ')
      } catch { /* ignore */ }
    }
    lines.push([
      r.id,
      csvEscape(r.name),
      csvEscape(r.email ?? ''),
      csvEscape(r.phone ?? ''),
      csvEscape(r.jobTitle ?? ''),
      csvEscape(r.linkedinPersonalUrl ?? ''),
      csvEscape(r.company ?? ''),
      csvEscape(r.website ?? ''),
      csvEscape(r.linkedinUrl ?? ''),
      csvEscape(r.industry ?? ''),
      csvEscape(r.country ?? ''),
      csvEscape(r.leadType ?? ''),
      r.employeeCount != null ? String(r.employeeCount) : '',
      csvEscape(r.revenueBand ?? ''),
      r.yearFounded != null ? String(r.yearFounded) : '',
      r.monthlyVisits != null ? String(r.monthlyVisits) : '',
      csvEscape(r.cms ?? ''),
      csvEscape(techStack),
      r.source,
      csvEscape(r.sourceDetail ?? ''),
      r.status,
      r.aiScore != null ? String(r.aiScore) : '',
      csvEscape(r.aiScoreReason ?? ''),
      r.estimatedValue != null ? String(r.estimatedValue) : '',
      r.currency,
      csvEscape(r.ownerName ?? ''),
      csvEscape((r.brief ?? '').replace(/\n/g, ' ').slice(0, 500)),
      r.enrichedAt ?? '',
      r.lastAiRunAt ?? '',
      r.createdAt,
      r.updatedAt,
    ].join(','))
  }

  const csv = lines.join('\n')
  const dateStamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="leads-${dateStamp}.csv"`,
    },
  })
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
