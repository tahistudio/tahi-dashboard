/**
 * POST /api/admin/leads/bulk-import
 *
 * Bulk-create leads from a CSV payload. Designed for Liam's "I have a
 * Google Sheet of 150 companies" workflow — pre-cron enrichment will
 * pick up the freshly-created rows on the next tick.
 *
 * Body:
 *   csv         (required) — raw CSV content as a string
 *   mapping     (required) — { name: "Column 1", email: "Column 2", ... }
 *                            keys are lead field names; values are the
 *                            exact CSV header strings to map FROM.
 *                            Only `name` is required.
 *   defaults    (optional) — { source?: string, currency?: string,
 *                              ownerId?: string, status?: string }
 *   skipDuplicates (default true) — skip rows whose email matches an
 *                                    existing lead (any status).
 *   dryRun      (default false) — parse + validate + return preview
 *                                 WITHOUT writing rows.
 *
 * Returns:
 *   {
 *     parsed:   N,   // rows read from CSV
 *     created:  N,   // rows inserted (0 in dry-run)
 *     skipped:  N,   // rows skipped due to duplicate or validation
 *     errors:   [{ row, error }]
 *     preview:  [...]    // first 10 leads that WOULD be created (dry-run)
 *   }
 *
 * Reasonable bound: 2000 rows per call. Beyond that, paginate the
 * import.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'
import { lookupOrCreatePerson } from '@/lib/people'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 2000
/** Hard per-call processing cap. D1 times out around 45s on Cloudflare
 *  Workers; ~40 row-inserts (each = lookupOrCreatePerson + lead insert
 *  + activity insert = 3 round-trips) leaves headroom. Callers that
 *  pass >50 rows in `csv` get the first 50 processed + the rest
 *  returned as `remainingCsv` so the client can re-POST in a loop. */
const PROCESS_PER_CALL = 50

type LeadField =
  | 'name'
  | 'email'
  | 'phone'
  | 'company'
  | 'jobTitle'
  | 'website'
  | 'brief'
  | 'sourceDetail'
  | 'estimatedValue'

interface BulkImportBody {
  csv?: string
  mapping?: Partial<Record<LeadField, string>>
  defaults?: {
    source?: string
    currency?: string
    ownerId?: string
    status?: string
  }
  skipDuplicates?: boolean
  dryRun?: boolean
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: BulkImportBody
  try {
    body = await req.json() as BulkImportBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.csv?.trim()) {
    return NextResponse.json({ error: 'csv is required' }, { status: 400 })
  }
  if (!body.mapping?.name) {
    return NextResponse.json({ error: 'mapping.name is required (which CSV column is the lead name)' }, { status: 400 })
  }

  const parsed = parseCsv(body.csv)
  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: 'CSV had a header but no data rows' }, { status: 400 })
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (${parsed.rows.length}). Cap is ${MAX_ROWS} per request.` }, { status: 400 })
  }

  const headers = parsed.headers
  const mapping = body.mapping
  const skipDuplicates = body.skipDuplicates !== false  // default true
  const dryRun = body.dryRun === true

  const defaults = body.defaults ?? {}
  const defaultSource = defaults.source || 'cold_outreach'
  const defaultCurrency = defaults.currency || 'NZD'
  const defaultStatus = defaults.status || 'new'

  // Resolve column indices for each mapped field.
  const fieldIndex: Partial<Record<LeadField, number>> = {}
  for (const [field, header] of Object.entries(mapping) as Array<[LeadField, string]>) {
    const idx = headers.indexOf(header)
    if (idx >= 0) fieldIndex[field] = idx
  }
  if (fieldIndex.name == null) {
    return NextResponse.json({
      error: `mapping.name "${mapping.name}" not found in CSV headers. Headers: ${headers.join(', ')}`,
    }, { status: 400 })
  }

  const database = await db()

  // Resolve default owner if not supplied: use the lead default
  // owner setting, then fall back to caller's team_member id.
  let resolvedOwnerId = defaults.ownerId ?? null
  if (!resolvedOwnerId) {
    const [setting] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
      .limit(1)
    if (setting?.value) resolvedOwnerId = setting.value
  }
  if (!resolvedOwnerId) {
    const tm = await database
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    if (tm.length > 0) resolvedOwnerId = tm[0].id
  }

  // Pre-fetch existing lead emails for duplicate detection (one query
  // instead of one per row). Lower-cased + trimmed.
  const candidateEmails = parsed.rows
    .map(row => valueFor(row, fieldIndex.email))
    .filter((e): e is string => !!e && e.trim().length > 0)
    .map(e => e.trim().toLowerCase())
  const existingEmails = new Set<string>()
  if (candidateEmails.length > 0 && skipDuplicates) {
    const rows = await database
      .select({ email: schema.leads.email })
      .from(schema.leads)
      .where(inArray(schema.leads.email, candidateEmails))
    for (const r of rows) {
      if (r.email) existingEmails.add(r.email.toLowerCase())
    }
  }

  // Name+source dedupe for contact-less rows (e.g. cold-outreach lists
  // where every lead is a company with no email). Without this, re-
  // running an import on the same CSV would duplicate every row.
  // Lower-cased name match, scoped to the same source value.
  const candidateNames = parsed.rows
    .map(row => valueFor(row, fieldIndex.name))
    .filter((n): n is string => !!n && n.trim().length > 0)
    .map(n => n.trim().toLowerCase())
  const existingNamesForSource = new Set<string>()
  if (candidateNames.length > 0 && skipDuplicates) {
    const rows = await database
      .select({ name: schema.leads.name })
      .from(schema.leads)
      .where(eq(schema.leads.source, defaultSource))
    for (const r of rows) {
      if (r.name) existingNamesForSource.add(r.name.trim().toLowerCase())
    }
  }

  interface PreparedLead {
    rowIndex: number
    name: string
    email: string | null
    phone: string | null
    company: string | null
    jobTitle: string | null
    website: string | null
    brief: string | null
    sourceDetail: string | null
    estimatedValue: number | null
  }

  const prepared: PreparedLead[] = []
  const errors: Array<{ row: number; error: string }> = []
  let skipped = 0

  parsed.rows.forEach((row, i) => {
    const name = valueFor(row, fieldIndex.name)?.trim()
    if (!name) {
      errors.push({ row: i + 2, error: 'name is empty' })  // +2 for header + 1-indexed
      return
    }
    const email = valueFor(row, fieldIndex.email)?.trim() || null
    if (email && existingEmails.has(email.toLowerCase())) {
      skipped++
      return
    }
    // Contact-less rows: dedupe by lower-cased name within the same
    // source. Catches re-runs of cold-outreach CSVs cleanly.
    if (!email && skipDuplicates && existingNamesForSource.has(name.toLowerCase())) {
      skipped++
      return
    }
    const phone = valueFor(row, fieldIndex.phone)?.trim() || null
    const company = valueFor(row, fieldIndex.company)?.trim() || null
    const jobTitle = valueFor(row, fieldIndex.jobTitle)?.trim() || null
    const website = valueFor(row, fieldIndex.website)?.trim() || null
    const brief = valueFor(row, fieldIndex.brief)?.trim() || null
    const sourceDetail = valueFor(row, fieldIndex.sourceDetail)?.trim() || null
    const evRaw = valueFor(row, fieldIndex.estimatedValue)?.trim()
    const estimatedValue = evRaw ? parseInt(evRaw.replace(/[^0-9-]/g, ''), 10) : null

    prepared.push({
      rowIndex: i + 2,
      name,
      email,
      phone,
      company,
      jobTitle,
      website,
      brief,
      sourceDetail,
      estimatedValue: Number.isFinite(estimatedValue ?? NaN) ? estimatedValue : null,
    })
  })

  if (dryRun) {
    return NextResponse.json({
      parsed: parsed.rows.length,
      created: 0,
      skipped,
      errors,
      preview: prepared.slice(0, 10),
      headers,
    })
  }

  // Cap this call to PROCESS_PER_CALL rows. Anything beyond gets
  // returned as remainingCsv so the client can re-POST in a loop
  // without hitting the 45s D1 timeout. The header row + the
  // unprocessed source lines (de-quoted from the original CSV via
  // the parser-reassembled slice) are concatenated for the caller.
  const totalPrepared = prepared.length
  const overBudget = totalPrepared > PROCESS_PER_CALL
  const toWrite = overBudget ? prepared.slice(0, PROCESS_PER_CALL) : prepared
  const deferred = overBudget ? prepared.slice(PROCESS_PER_CALL) : []

  // Write loop. Each lead gets a person via lookup-or-create on email.
  let created = 0
  for (const p of toWrite) {
    try {
      const personId = await lookupOrCreatePerson(database, {
        fullName: p.name,
        email: p.email,
        phone: p.phone,
      })
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      await database.insert(schema.leads).values({
        id,
        personId,
        name: p.name,
        email: p.email,
        phone: p.phone,
        company: p.company,
        jobTitle: p.jobTitle,
        website: p.website,
        source: defaultSource,
        sourceDetail: p.sourceDetail,
        brief: p.brief,
        estimatedValue: p.estimatedValue,
        currency: defaultCurrency,
        status: defaultStatus,
        ownerId: resolvedOwnerId,
        createdAt: now,
        updatedAt: now,
      })
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'lead_created',
        title: `Lead imported: ${p.name}`,
        description: 'Created via bulk CSV import',
        leadId: id,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      })
      created++
    } catch (err) {
      errors.push({
        row: p.rowIndex,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // When over-budget, hand the deferred rows back as a new CSV blob
  // the client can POST again with the same mapping/defaults.
  let remainingCsv: string | undefined
  if (deferred.length > 0) {
    const csvEscape = (v: string | null) => {
      if (v == null) return ''
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    }
    const lines: string[] = []
    lines.push(['name','email','phone','company','jobTitle','website','brief','sourceDetail','estimatedValue'].join(','))
    for (const p of deferred) {
      lines.push([
        csvEscape(p.name),
        csvEscape(p.email),
        csvEscape(p.phone),
        csvEscape(p.company),
        csvEscape(p.jobTitle),
        csvEscape(p.website),
        csvEscape(p.brief),
        csvEscape(p.sourceDetail),
        p.estimatedValue != null ? String(p.estimatedValue) : '',
      ].join(','))
    }
    remainingCsv = lines.join('\n')
  }

  return NextResponse.json({
    parsed: parsed.rows.length,
    created,
    skipped,
    errors,
    headers,
    // Continuation payload — the client loops POSTing remainingCsv +
    // the mapping below until the field is absent.
    remainingCount: deferred.length,
    remainingCsv,
    remainingMapping: deferred.length > 0 ? {
      name: 'name', email: 'email', phone: 'phone', company: 'company',
      jobTitle: 'jobTitle', website: 'website', brief: 'brief',
      sourceDetail: 'sourceDetail', estimatedValue: 'estimatedValue',
    } : undefined,
  })
}

// ── CSV parser ────────────────────────────────────────────────────────────
// Minimal CSV parser: handles quoted fields, escaped quotes ("" → "),
// and CRLF / LF line endings. Sufficient for hand-exported spreadsheets.

function parseCsv(raw: string): { headers: string[]; rows: string[][] } {
  const normalised = raw.replace(/\r\n?/g, '\n').trim()
  if (!normalised) return { headers: [], rows: [] }

  const lines: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i]
    if (inQuotes) {
      if (ch === '"') {
        if (normalised[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        current.push(field)
        field = ''
      } else if (ch === '\n') {
        current.push(field)
        lines.push(current)
        current = []
        field = ''
      } else {
        field += ch
      }
    }
  }
  // Flush the last field/line.
  if (field.length > 0 || current.length > 0) {
    current.push(field)
    lines.push(current)
  }

  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].map(h => h.trim())
  const rows = lines.slice(1).filter(r => r.some(cell => cell.trim().length > 0))
  return { headers, rows }
}

function valueFor(row: string[], index: number | undefined): string | undefined {
  if (index == null) return undefined
  const v = row[index]
  return v == null ? undefined : v
}
