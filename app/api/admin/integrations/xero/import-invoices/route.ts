import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface XeroInvoice {
  InvoiceID: string
  InvoiceNumber: string
  Type: string
  Status: string
  Contact: { ContactID: string; Name: string }
  DateString: string
  DueDateString: string
  SubTotal: number
  Total: number
  CurrencyCode: string
  AmountDue: number
  AmountPaid: number
  FullyPaidOnDate?: string
  LineItems?: Array<{
    Description: string
    Quantity: number
    UnitAmount: number
    LineAmount: number
    AccountCode: string
  }>
}

interface XeroInvoicesResponse {
  Invoices: XeroInvoice[]
}

function mapXeroStatus(xeroStatus: string): string {
  switch (xeroStatus) {
    case 'DRAFT': return 'draft'
    case 'SUBMITTED':
    case 'AUTHORISED': return 'sent'
    case 'PAID': return 'paid'
    case 'VOIDED':
    case 'DELETED': return 'written_off'
    default: return 'draft'
  }
}

// POST /api/admin/integrations/xero/import-invoices
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db() as unknown as D1

  // Fetch ACCREC invoices from Xero (paginated, summaries only for speed)
  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') ?? '1')

  const data = await callXeroAPI<XeroInvoicesResponse>(
    'GET',
    `/Invoices?where=Type%3D%3D%22ACCREC%22&order=DateString%20DESC&page=${page}&summaryOnly=false`,
  )

  if (!data?.Invoices) {
    return NextResponse.json({ error: 'Failed to fetch invoices from Xero' }, { status: 502 })
  }

  // Get existing xeroInvoiceIds to skip duplicates
  const existing = await database
    .select({ xeroInvoiceId: schema.invoices.xeroInvoiceId })
    .from(schema.invoices)
    .where(sql`${schema.invoices.xeroInvoiceId} IS NOT NULL`)

  const existingIds = new Set(existing.map(e => e.xeroInvoiceId))

  // Get all orgs for contact matching
  const allOrgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name, xeroContactId: schema.organisations.xeroContactId })
    .from(schema.organisations)

  const now = new Date().toISOString()
  let imported = 0
  let skipped = 0
  const results: Array<{ invoiceNumber: string; status: string; orgMatch?: string }> = []

  for (const inv of data.Invoices) {
    if (existingIds.has(inv.InvoiceID)) {
      skipped++
      results.push({ invoiceNumber: inv.InvoiceNumber, status: 'already_exists' })
      continue
    }

    // Match Xero contact to dashboard org
    let matchedOrgId: string | null = null
    const xeroContactName = inv.Contact?.Name?.toLowerCase() ?? ''

    // First: exact xeroContactId match
    const exactMatch = allOrgs.find(o => o.xeroContactId === inv.Contact?.ContactID)
    if (exactMatch) {
      matchedOrgId = exactMatch.id
    } else {
      // Fuzzy name match
      const nameMatch = allOrgs.find(o =>
        o.name.toLowerCase() === xeroContactName ||
        xeroContactName.includes(o.name.toLowerCase()) ||
        o.name.toLowerCase().includes(xeroContactName)
      )
      if (nameMatch) {
        matchedOrgId = nameMatch.id
        // Auto-link the xeroContactId for future matches
        await database.update(schema.organisations).set({
          xeroContactId: inv.Contact.ContactID,
          updatedAt: now,
        }).where(eq(schema.organisations.id, nameMatch.id))
      }
    }

    const localStatus = mapXeroStatus(inv.Status)
    const invoiceId = crypto.randomUUID()

    await database.insert(schema.invoices).values({
      id: invoiceId,
      orgId: matchedOrgId ?? '',
      xeroInvoiceId: inv.InvoiceID,
      source: 'xero',
      status: localStatus,
      amountUsd: inv.SubTotal,
      totalUsd: inv.Total,
      currency: inv.CurrencyCode ?? 'NZD',
      dueDate: inv.DueDateString?.split('T')[0] ?? null,
      paidAt: inv.FullyPaidOnDate ?? null,
      notes: `Imported from Xero: ${inv.InvoiceNumber}`,
      createdAt: inv.DateString ?? now,
      updatedAt: now,
    })

    // Import line items if available
    if (inv.LineItems?.length) {
      for (const line of inv.LineItems) {
        await database.insert(schema.invoiceItems).values({
          id: crypto.randomUUID(),
          invoiceId,
          description: line.Description ?? 'Line item',
          quantity: line.Quantity ?? 1,
          unitPriceUsd: line.UnitAmount ?? 0,
          totalUsd: line.LineAmount ?? 0,
        })
      }
    }

    imported++
    results.push({
      invoiceNumber: inv.InvoiceNumber,
      status: 'imported',
      orgMatch: matchedOrgId ? allOrgs.find(o => o.id === matchedOrgId)?.name : undefined,
    })
  }

  return NextResponse.json({
    success: true,
    imported,
    skipped,
    total: data.Invoices.length,
    page,
    hasMore: data.Invoices.length >= 100, // Xero returns max 100 per page
    results,
  })
}
