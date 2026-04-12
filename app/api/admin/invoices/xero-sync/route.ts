import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

interface XeroContactResponse {
  Contacts: Array<{
    ContactID: string
    Name: string
    EmailAddress?: string
  }>
}

interface XeroInvoiceResponse {
  Invoices: Array<{
    InvoiceID: string
    InvoiceNumber?: string
    Status: string
  }>
}

/**
 * POST /api/admin/invoices/xero-sync
 * Push a local invoice to Xero or sync multiple invoices
 * Body: { invoiceId?: string } | { orgId?: string }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    invoiceId?: string
    orgId?: string
  }

  const database = await db()

  // Get invoices to sync
  let invoices
  if (body.invoiceId) {
    invoices = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
      .select({
        id: schema.invoices.id,
        orgId: schema.invoices.orgId,
        totalUsd: schema.invoices.totalUsd,
        dueDate: schema.invoices.dueDate,
        notes: schema.invoices.notes,
        status: schema.invoices.status,
        xeroInvoiceId: schema.invoices.xeroInvoiceId,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, body.invoiceId))
  } else if (body.orgId) {
    invoices = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
      .select({
        id: schema.invoices.id,
        orgId: schema.invoices.orgId,
        totalUsd: schema.invoices.totalUsd,
        dueDate: schema.invoices.dueDate,
        notes: schema.invoices.notes,
        status: schema.invoices.status,
        xeroInvoiceId: schema.invoices.xeroInvoiceId,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.orgId, body.orgId))
  } else {
    return NextResponse.json(
      { error: 'invoiceId or orgId required' },
      { status: 400 },
    )
  }

  const results = []

  for (const invoice of invoices) {
    try {
      // Skip if already synced to Xero
      if (invoice.xeroInvoiceId) {
        results.push({
          invoiceId: invoice.id,
          status: 'already_synced',
          xeroInvoiceId: invoice.xeroInvoiceId,
        })
        continue
      }

      // Get organization details
      const orgs = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
        .select({
          id: schema.organisations.id,
          name: schema.organisations.name,
        })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, invoice.orgId))

      if (orgs.length === 0) {
        results.push({
          invoiceId: invoice.id,
          status: 'error',
          error: 'Organization not found',
        })
        continue
      }

      const org = orgs[0]

      // Get or create contact in Xero
      const contactRes = await callXeroAPI<XeroContactResponse>(
        'GET',
        `/Contacts?where=Name=="${org.name.replace(/"/g, '\\"')}"`,
      )

      let contactId: string | null = null

      if (contactRes?.Contacts && contactRes.Contacts.length > 0) {
        contactId = contactRes.Contacts[0].ContactID
      } else {
        // Create new contact
        const createRes = await callXeroAPI<XeroContactResponse>(
          'POST',
          '/Contacts',
          {
            Name: org.name,
            EmailAddress: `info@${org.name.toLowerCase().replace(/\s+/g, '-')}.com`,
          },
        )

        if (createRes?.Contacts && createRes.Contacts.length > 0) {
          contactId = createRes.Contacts[0].ContactID
        }
      }

      if (!contactId) {
        results.push({
          invoiceId: invoice.id,
          status: 'error',
          error: 'Failed to create contact in Xero',
        })
        continue
      }

      // Get invoice items
      const items = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
        .select()
        .from(schema.invoiceItems)
        .where(eq(schema.invoiceItems.invoiceId, invoice.id))

      // Create invoice in Xero
      const invoiceRes = await callXeroAPI<XeroInvoiceResponse>(
        'POST',
        '/Invoices',
        {
          Type: 'ACCREC',
          Status: 'DRAFT',
          Contact: {
            ContactID: contactId,
          },
          InvoiceNumber: `INV-${invoice.id.slice(0, 8).toUpperCase()}`,
          DueDate: invoice.dueDate,
          LineAmountTypes: 'Exclusive',
          LineItems: items.map((item) => ({
            Description: item.description,
            Quantity: item.quantity,
            UnitAmount: item.unitPriceUsd,
            AccountCode: '200', // Default account code (may need to be configured)
          })),
          Notes: invoice.notes || undefined,
        },
      )

      if (invoiceRes?.Invoices && invoiceRes.Invoices.length > 0) {
        const xeroInvoice = invoiceRes.Invoices[0]

        // Store Xero invoice ID in local invoice
        const now = new Date().toISOString()
        await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
          .update(schema.invoices)
          .set({
            xeroInvoiceId: xeroInvoice.InvoiceID,
            updatedAt: now,
          })
          .where(eq(schema.invoices.id, invoice.id))

        results.push({
          invoiceId: invoice.id,
          status: 'synced',
          xeroInvoiceId: xeroInvoice.InvoiceID,
          xeroInvoiceNumber: xeroInvoice.InvoiceNumber,
        })
      } else {
        results.push({
          invoiceId: invoice.id,
          status: 'error',
          error: 'Failed to create invoice in Xero',
        })
      }
    } catch (err) {
      results.push({
        invoiceId: invoice.id,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return NextResponse.json({
    success: true,
    synced: results.filter((r) => r.status === 'synced').length,
    skipped: results.filter((r) => r.status === 'already_synced').length,
    failed: results.filter((r) => r.status === 'error').length,
    results,
  })
}
