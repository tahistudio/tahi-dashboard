import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, isNotNull } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

interface XeroInvoiceData {
  InvoiceID: string
  InvoiceNumber: string
  Status: string
  Type: string
  Total: number
  UpdatedDateUTC: string
  HasAttachments: boolean
}

interface XeroInvoicesResponse {
  Invoices: XeroInvoiceData[]
}

/**
 * POST /api/admin/integrations/xero/sync-payments
 * Sync payment statuses from Xero back to local invoices
 * Fetches all invoices from Xero that have been synced locally
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Get all invoices that have been synced to Xero
  const syncedInvoices = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .select({
      id: schema.invoices.id,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      status: schema.invoices.status,
    })
    .from(schema.invoices)
    .where(isNotNull(schema.invoices.xeroInvoiceId))

  if (syncedInvoices.length === 0) {
    return NextResponse.json({
      success: true,
      synced: 0,
      updated: 0,
      results: [],
    })
  }

  // Fetch invoice details from Xero
  const xeroRes = await callXeroAPI<XeroInvoicesResponse>(
    'GET',
    '/Invoices?ApiKey=',
  )

  if (!xeroRes?.Invoices) {
    return NextResponse.json(
      { error: 'Failed to fetch invoices from Xero' },
      { status: 500 },
    )
  }

  const xeroInvoiceMap = new Map(
    xeroRes.Invoices.map((inv) => [inv.InvoiceID, inv]),
  )

  const results = []
  let updated = 0
  const now = new Date().toISOString()

  // Update local invoice statuses based on Xero data
  for (const localInvoice of syncedInvoices) {
    const xeroInvoice = xeroInvoiceMap.get(localInvoice.xeroInvoiceId ?? '')

    if (!xeroInvoice) {
      results.push({
        invoiceId: localInvoice.id,
        status: 'not_found_in_xero',
      })
      continue
    }

    // Map Xero status to local status
    let newStatus = localInvoice.status
    let paidAt: string | null = null

    if (xeroInvoice.Status === 'AUTHORISED') {
      newStatus = 'sent'
    } else if (xeroInvoice.Status === 'SUBMITTED') {
      newStatus = 'viewed'
    } else if (xeroInvoice.Status === 'PAID') {
      newStatus = 'paid'
      paidAt = now
    }

    // Update if status changed
    if (newStatus !== localInvoice.status) {
      const updates: Record<string, unknown> = {
        status: newStatus,
        updatedAt: now,
      }

      if (paidAt) {
        updates.paidAt = paidAt
      }

      await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
        .update(schema.invoices)
        .set(updates)
        .where(eq(schema.invoices.id, localInvoice.id))

      updated++

      results.push({
        invoiceId: localInvoice.id,
        xeroInvoiceId: localInvoice.xeroInvoiceId,
        previousStatus: localInvoice.status,
        newStatus,
      })
    } else {
      results.push({
        invoiceId: localInvoice.id,
        xeroInvoiceId: localInvoice.xeroInvoiceId,
        status: 'no_change',
        xeroStatus: xeroInvoice.Status,
      })
    }
  }

  return NextResponse.json({
    success: true,
    synced: syncedInvoices.length,
    updated,
    results,
  })
}
