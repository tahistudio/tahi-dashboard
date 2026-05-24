/**
 * POST /api/admin/leads/backfill-fields
 *
 * One-shot parser that walks every lead with a `brief` blob matching
 * the WordPress / Julia CSV export pattern and extracts the structured
 * fields into the new 0047 columns. Idempotent: skips leads whose
 * columns are already populated, and only consumes parts of the brief
 * that actually match — non-matching prose stays in `brief` untouched.
 *
 * Pattern (from the WordPress export):
 *   "Industry: Financial Services · Vertical: Financial Services ·
 *    Employees: 372 · Revenue: $50M - $100M · Page views: 899988 ·
 *    Type: Prospect · LinkedIn: https://www.linkedin.com/company/foo"
 *
 * Recognised labels (case-insensitive, allow either "·" or "|" or
 * newline separators):
 *   Industry, Vertical, Employees, Revenue, Page views, Type, LinkedIn,
 *   Country, Year founded, Personal LinkedIn
 *
 * Vertical merges into Industry when Industry is missing (we collapsed
 * the two into one column).
 *
 * Query:
 *   ?dryRun=1   — parse + report, don't write
 *   ?limit=N    — cap rows processed this call (default 200, max 500)
 *
 * Returns:
 *   { scanned, updated, skipped, errors, sample: [...first 5 diffs] }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { isNotNull, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

interface ParsedFields {
  industry?: string
  employeeCount?: number
  revenueBand?: string
  monthlyVisits?: number
  leadType?: string
  linkedinUrl?: string
  linkedinPersonalUrl?: string
  country?: string
  yearFounded?: number
  cms?: string
  /** What was actually consumed from the brief blob — these segments
   *  get stripped from the residual brief that goes back into the row. */
  consumedSegments: string[]
}

/** Known CMS names — when the brief mentions one in passing, capture
 *  it. These match the sniffer's pattern catalogue (lib/tech-stack-sniffer.ts)
 *  so manual and automated detection agree on canonical spelling. */
const KNOWN_CMS = [
  'Webflow', 'WordPress', 'Squarespace', 'Wix', 'Framer', 'Ghost',
  'HubSpot CMS', 'Drupal', 'Joomla', 'Notion', 'Shopify', 'WooCommerce',
  'BigCommerce',
]
function detectCmsInText(text: string): string | undefined {
  const lower = text.toLowerCase()
  for (const cms of KNOWN_CMS) {
    // Word-boundary match so "wordpress" matches but "framerusercontent" doesn't false-positive on "framer"
    const re = new RegExp(`\\b${cms.toLowerCase().replace(/\s+/g, '\\s+')}\\b`)
    if (re.test(lower)) return cms
  }
  return undefined
}

/** Splits on the common separators (·, |, newline) into trimmed pieces. */
function splitSegments(brief: string): string[] {
  return brief
    .split(/[·|]|\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

function parseBrief(brief: string): ParsedFields {
  const out: ParsedFields = { consumedSegments: [] }
  const segments = splitSegments(brief)
  for (const seg of segments) {
    const m = seg.match(/^([A-Za-z][A-Za-z \-_/]*?):\s*(.+)$/)
    if (!m) continue
    const labelRaw = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
    const value = m[2].trim()
    if (!value) continue

    let consumed = false
    switch (labelRaw) {
      case 'industry':
        if (!out.industry) { out.industry = value; consumed = true }
        break
      case 'vertical':
        // Vertical only wins if Industry is still absent — we merged
        // the two into a single `industry` column.
        if (!out.industry) { out.industry = value; consumed = true }
        else { consumed = true } // strip duplicate vertical anyway
        break
      case 'employees':
      case 'employee count':
      case 'team size':
      case 'headcount': {
        const n = parseInt(value.replace(/[^0-9]/g, ''), 10)
        if (Number.isFinite(n) && n > 0) { out.employeeCount = n; consumed = true }
        break
      }
      case 'revenue':
      case 'annual revenue':
      case 'arr':
        if (!out.revenueBand) { out.revenueBand = value; consumed = true }
        break
      case 'page views':
      case 'monthly visits':
      case 'traffic':
      case 'monthly traffic': {
        const n = parseInt(value.replace(/[^0-9]/g, ''), 10)
        if (Number.isFinite(n) && n > 0) { out.monthlyVisits = n; consumed = true }
        break
      }
      case 'type':
      case 'lead type':
      case 'segment':
        if (!out.leadType) { out.leadType = value; consumed = true }
        break
      case 'linkedin':
      case 'company linkedin':
        if (!out.linkedinUrl) { out.linkedinUrl = value; consumed = true }
        break
      case 'personal linkedin':
      case 'contact linkedin':
        if (!out.linkedinPersonalUrl) { out.linkedinPersonalUrl = value; consumed = true }
        break
      case 'country':
      case 'hq':
      case 'hq country':
      case 'headquarters':
        if (!out.country) { out.country = value; consumed = true }
        break
      case 'year founded':
      case 'founded':
      case 'founded year': {
        const n = parseInt(value.replace(/[^0-9]/g, ''), 10)
        if (Number.isFinite(n) && n > 1800 && n < 2100) { out.yearFounded = n; consumed = true }
        break
      }
      case 'cms':
      case 'platform':
      case 'site platform':
      case 'website builder':
      case 'builder':
        if (!out.cms) { out.cms = value; consumed = true }
        break
    }
    if (consumed) out.consumedSegments.push(seg)
  }
  // CMS may be mentioned in free prose (not as "CMS: X"). Sweep the
  // brief once for known CMS names if we haven't found one yet.
  if (!out.cms) {
    const hit = detectCmsInText(brief)
    if (hit) out.cms = hit
  }
  return out
}

/** Rebuild the brief blob minus the segments we consumed. If nothing
 *  remains, returns null so the column clears. */
function residualBrief(brief: string, consumed: string[]): string | null {
  if (consumed.length === 0) return brief
  const consumedSet = new Set(consumed.map(s => s.trim()))
  const remaining = splitSegments(brief).filter(s => !consumedSet.has(s.trim()))
  const joined = remaining.join(' · ').trim()
  return joined.length > 0 ? joined : null
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT

  const database = await db()
  const rows = await database
    .select()
    .from(schema.leads)
    .where(isNotNull(schema.leads.brief))
    .limit(limit)

  let scanned = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ id: string; error: string }> = []
  const sample: Array<{ id: string; name: string; diff: Record<string, unknown>; residualBrief: string | null }> = []

  for (const lead of rows) {
    scanned++
    if (!lead.brief) { skipped++; continue }

    let parsed: ParsedFields
    try {
      parsed = parseBrief(lead.brief)
    } catch (err) {
      errors.push({ id: lead.id, error: err instanceof Error ? err.message : String(err) })
      continue
    }

    if (parsed.consumedSegments.length === 0) {
      skipped++
      continue
    }

    // Only write fields the lead doesn't already have populated.
    const diff: Record<string, string | number | null> = {}
    if (parsed.industry && !lead.industry) diff.industry = parsed.industry
    if (parsed.employeeCount && !lead.employeeCount) diff.employeeCount = parsed.employeeCount
    if (parsed.revenueBand && !lead.revenueBand) diff.revenueBand = parsed.revenueBand
    if (parsed.monthlyVisits && !lead.monthlyVisits) diff.monthlyVisits = parsed.monthlyVisits
    if (parsed.leadType && !lead.leadType) diff.leadType = parsed.leadType
    if (parsed.linkedinUrl && !lead.linkedinUrl) diff.linkedinUrl = parsed.linkedinUrl
    if (parsed.linkedinPersonalUrl && !lead.linkedinPersonalUrl) diff.linkedinPersonalUrl = parsed.linkedinPersonalUrl
    if (parsed.country && !lead.country) diff.country = parsed.country
    if (parsed.yearFounded && !lead.yearFounded) diff.yearFounded = parsed.yearFounded
    if (parsed.cms && !lead.cms) diff.cms = parsed.cms

    const newBrief = residualBrief(lead.brief, parsed.consumedSegments)
    const briefChanged = newBrief !== lead.brief
    if (Object.keys(diff).length === 0 && !briefChanged) {
      skipped++
      continue
    }

    if (sample.length < 5) {
      sample.push({ id: lead.id, name: lead.name, diff, residualBrief: newBrief })
    }

    if (!dryRun) {
      try {
        await database
          .update(schema.leads)
          .set({ ...diff, brief: newBrief, updatedAt: new Date().toISOString() })
          .where(eq(schema.leads.id, lead.id))
        updated++
      } catch (err) {
        errors.push({ id: lead.id, error: err instanceof Error ? err.message : String(err) })
      }
    } else {
      updated++
    }
  }

  return NextResponse.json({
    dryRun,
    scanned,
    updated,
    skipped,
    errors,
    sample,
    hint: dryRun
      ? 'Dry run — no writes. Re-call without ?dryRun=1 to commit. Loop until updated=0.'
      : 'Re-call until updated=0 to process the full backlog (limit per call).',
  })
}
