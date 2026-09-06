import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'
import { resolvePermissions, can } from '@/lib/permissions'
import { draftStatusList, owedStatusList } from '@/lib/invoice-status'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

async function getRateMap(database: D1): Promise<RateMap> {
  const rates = await database.select().from(schema.exchangeRates)
  return buildRateMap(rates)
}

interface AgingInvoice {
  id: string
  orgName: string | null
  totalUsd: number
  totalNzd: number
  currency: string
  dueDate: string | null
  daysPastDue: number
}

interface AgingBucket {
  count: number
  totalUsd: number
  totalNzd: number
  invoices: AgingInvoice[]
}

// ── GET /api/admin/reports/invoice-aging ────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId: auth.userId, orgId: auth.orgId }, 'financial_reports')
  if (denied) return denied

  const database = await db()
  const drizzle = database as D1

  // Receivables are gated behind the invoices feature so a scoped team member
  // without it cannot read aging totals by hitting the endpoint directly.
  const access = await resolvePermissions(drizzle, auth)
  if (!can(access, 'invoices')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateMap = await getRateMap(drizzle)

  // Every OWED invoice: issued and unpaid, which is the whole of a receivables
  // book. This read used to be `status = 'sent'` alone, which dropped an
  // invoice the moment a client opened it ('viewed'). Drafts are excluded by
  // construction: nobody has been asked to pay one, so it cannot age.
  const rows = await drizzle
    .select({
      id: schema.invoices.id,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      dueDate: schema.invoices.dueDate,
      orgName: schema.organisations.name,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .where(inArray(schema.invoices.status, owedStatusList()))

  // Drafts, reported beside the buckets rather than inside one. The studio
  // still wants to see the placeholders it has raised in Xero; they are simply
  // not receivable, so they get their own line.
  const draftRows = await drizzle
    .select({
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
    })
    .from(schema.invoices)
    .where(inArray(schema.invoices.status, draftStatusList()))

  const drafts = {
    count: draftRows.length,
    totalNzd: Math.round(
      draftRows.reduce((sum, r) => sum + toNzd(r.totalUsd, r.currency ?? 'USD', rateMap), 0),
    ),
  }

  const now = new Date()

  const makeBucket = (): AgingBucket => ({ count: 0, totalUsd: 0, totalNzd: 0, invoices: [] })

  const aging = {
    current: makeBucket(),
    thirtyDays: makeBucket(),
    sixtyDays: makeBucket(),
    ninetyPlus: makeBucket(),
  }

  let totalOutstanding = 0
  let oldestDaysPastDue = 0

  for (const row of rows) {
    let daysPastDue = 0
    if (row.dueDate) {
      const due = new Date(row.dueDate)
      const diffMs = now.getTime() - due.getTime()
      daysPastDue = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    }

    const currency = row.currency ?? 'USD'
    const nzdAmount = toNzd(row.totalUsd, currency, rateMap)

    const invoice: AgingInvoice = {
      id: row.id,
      orgName: row.orgName ?? null,
      totalUsd: row.totalUsd,
      totalNzd: Math.round(nzdAmount),
      currency,
      dueDate: row.dueDate ?? null,
      daysPastDue,
    }

    let bucket: AgingBucket
    if (daysPastDue <= 30) {
      bucket = aging.current
    } else if (daysPastDue <= 60) {
      bucket = aging.thirtyDays
    } else if (daysPastDue <= 90) {
      bucket = aging.sixtyDays
    } else {
      bucket = aging.ninetyPlus
    }

    bucket.count += 1
    bucket.totalUsd += row.totalUsd
    bucket.totalNzd += nzdAmount
    bucket.invoices.push(invoice)

    totalOutstanding += nzdAmount
    if (daysPastDue > oldestDaysPastDue) {
      oldestDaysPastDue = daysPastDue
    }
  }

  return NextResponse.json({
    aging,
    // `drafts` is additive: `aging` and `summary` keep the exact shape they
    // had, and neither has ever included a draft.
    drafts,
    summary: {
      totalOutstanding,
      invoiceCount: rows.length,
      oldestDaysPastDue,
    },
  })
}
