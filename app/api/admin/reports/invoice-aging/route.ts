import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

interface AgingInvoice {
  id: string
  orgName: string | null
  totalUsd: number
  currency: string
  dueDate: string | null
  daysPastDue: number
}

interface AgingBucket {
  count: number
  totalUsd: number
  invoices: AgingInvoice[]
}

// ── GET /api/admin/reports/invoice-aging ────────────────────────────────────
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Query all sent invoices with org name
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
    .where(eq(schema.invoices.status, 'sent'))

  const now = new Date()

  const makeBucket = (): AgingBucket => ({ count: 0, totalUsd: 0, invoices: [] })

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

    const invoice: AgingInvoice = {
      id: row.id,
      orgName: row.orgName ?? null,
      totalUsd: row.totalUsd,
      currency: row.currency ?? 'USD',
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
    bucket.invoices.push(invoice)

    totalOutstanding += row.totalUsd
    if (daysPastDue > oldestDaysPastDue) {
      oldestDaysPastDue = daysPastDue
    }
  }

  return NextResponse.json({
    aging,
    summary: {
      totalOutstanding,
      invoiceCount: rows.length,
      oldestDaysPastDue,
    },
  })
}
