import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface XeroContactResponse {
  Contacts: Array<{ ContactID: string; Name: string; EmailAddress?: string }>
}

interface XeroInvoiceResponse {
  Invoices: Array<{ InvoiceID: string; InvoiceNumber?: string; Status: string }>
}

interface XeroBrandingTheme {
  BrandingThemeID: string
  Name: string
}

/**
 * POST /api/admin/invoices/xero-sync
 * Push local invoice(s) to Xero as DRAFT, or update existing Xero invoices.
 * Now supports: CurrencyCode, BrandingThemeID (matched by currency name),
 * xeroContactId from org, and re-sync of already-linked invoices.
 *
 * Body: { invoiceIds?: string[] } | { invoiceId?: string } | { orgId?: string }
 */
export async function POST(req: NextRequest) {
  const { orgId: authOrgId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    invoiceId?: string
    invoiceIds?: string[]
    orgId?: string
  }

  const database = await db() as unknown as D1

  // Determine which invoices to sync
  let invoiceIds: string[] = []
  if (body.invoiceIds?.length) {
    invoiceIds = body.invoiceIds
  } else if (body.invoiceId) {
    invoiceIds = [body.invoiceId]
  } else if (body.orgId) {
    const orgInvoices = await database
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.orgId, body.orgId))
    invoiceIds = orgInvoices.map(i => i.id)
  } else {
    return NextResponse.json({ error: 'invoiceId, invoiceIds, or orgId required' }, { status: 400 })
  }

  // Fetch branding themes from Xero (for currency matching)
  const themesRes = await callXeroAPI<{ BrandingThemes: XeroBrandingTheme[] }>('GET', '/BrandingThemes')
  const themes = themesRes?.BrandingThemes ?? []

  // Match branding theme by currency in name (e.g. "NZD Invoice", "GBP Template")
  function findThemeForCurrency(currency: string): string | undefined {
    const cur = currency.toUpperCase()
    const match = themes.find(t => t.Name.toUpperCase().includes(cur))
    return match?.BrandingThemeID
  }

  const results = []
  const now = new Date().toISOString()

  for (const invId of invoiceIds) {
    try {
      // Fetch full invoice with org and line items
      const [invoice] = await database
        .select({
          id: schema.invoices.id,
          orgId: schema.invoices.orgId,
          totalUsd: schema.invoices.totalUsd,
          currency: schema.invoices.currency,
          dueDate: schema.invoices.dueDate,
          notes: schema.invoices.notes,
          status: schema.invoices.status,
          xeroInvoiceId: schema.invoices.xeroInvoiceId,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invId))
        .limit(1)

      if (!invoice) {
        results.push({ invoiceId: invId, status: 'error', error: 'Invoice not found' })
        continue
      }

      // Get org details (including xeroContactId)
      const [org] = await database
        .select({
          id: schema.organisations.id,
          name: schema.organisations.name,
          xeroContactId: schema.organisations.xeroContactId,
        })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, invoice.orgId))
        .limit(1)

      if (!org) {
        results.push({ invoiceId: invId, status: 'error', error: 'Organisation not found' })
        continue
      }

      // Resolve Xero contact: use stored xeroContactId, or search/create
      let contactId = org.xeroContactId ?? null

      if (!contactId) {
        // Search by name
        const contactRes = await callXeroAPI<XeroContactResponse>(
          'GET',
          `/Contacts?where=Name=="${encodeURIComponent(org.name)}"`,
        )

        if (contactRes?.Contacts?.length) {
          contactId = contactRes.Contacts[0].ContactID
        } else {
          // Get real email from contacts table
          const [contact] = await database
            .select({ email: schema.contacts.email })
            .from(schema.contacts)
            .where(eq(schema.contacts.orgId, org.id))
            .limit(1)

          const createRes = await callXeroAPI<XeroContactResponse>('POST', '/Contacts', {
            Name: org.name,
            EmailAddress: contact?.email ?? undefined,
          })
          contactId = createRes?.Contacts?.[0]?.ContactID ?? null
        }

        // Store xeroContactId for future use
        if (contactId) {
          try {
            await database.update(schema.organisations).set({
              xeroContactId: contactId,
              updatedAt: now,
            }).where(eq(schema.organisations.id, org.id))
          } catch { /* column may not exist */ }
        }
      }

      if (!contactId) {
        results.push({ invoiceId: invId, status: 'error', error: 'Failed to resolve Xero contact' })
        continue
      }

      // Get line items
      const items = await database
        .select()
        .from(schema.invoiceItems)
        .where(eq(schema.invoiceItems.invoiceId, invId))

      const currency = invoice.currency ?? 'NZD'
      const brandingThemeId = findThemeForCurrency(currency)

      // Build Xero invoice payload
      const xeroPayload: Record<string, unknown> = {
        Type: 'ACCREC',
        Status: 'DRAFT',
        Contact: { ContactID: contactId },
        CurrencyCode: currency,
        DueDate: invoice.dueDate ?? undefined,
        LineAmountTypes: 'Exclusive',
        LineItems: items.map(item => ({
          Description: item.description,
          Quantity: item.quantity ?? 1,
          UnitAmount: item.unitPriceUsd,
          AccountCode: '200',
        })),
        Notes: invoice.notes ?? undefined,
      }

      if (brandingThemeId) {
        xeroPayload.BrandingThemeID = brandingThemeId
      }

      // Create or update in Xero
      let xeroInvoiceId = invoice.xeroInvoiceId
      let method: string
      let endpoint: string

      if (xeroInvoiceId) {
        // Update existing Xero invoice
        method = 'POST'
        endpoint = `/Invoices/${xeroInvoiceId}`
      } else {
        // Create new
        method = 'POST'
        endpoint = '/Invoices'
        xeroPayload.InvoiceNumber = `INV-${invId.slice(0, 8).toUpperCase()}`
      }

      const invoiceRes = await callXeroAPI<XeroInvoiceResponse>(method, endpoint, xeroInvoiceId ? xeroPayload : { Invoices: [xeroPayload] })

      const createdInv = invoiceRes?.Invoices?.[0]
      if (createdInv) {
        await database.update(schema.invoices).set({
          xeroInvoiceId: createdInv.InvoiceID,
          source: 'xero',
          updatedAt: now,
        }).where(eq(schema.invoices.id, invId))

        results.push({
          invoiceId: invId,
          status: xeroInvoiceId ? 'updated' : 'synced',
          xeroInvoiceId: createdInv.InvoiceID,
          xeroInvoiceNumber: createdInv.InvoiceNumber,
        })
      } else {
        results.push({ invoiceId: invId, status: 'error', error: 'Xero API returned no invoice' })
      }
    } catch (err) {
      results.push({
        invoiceId: invId,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return NextResponse.json({
    success: true,
    synced: results.filter(r => r.status === 'synced').length,
    updated: results.filter(r => r.status === 'updated').length,
    failed: results.filter(r => r.status === 'error').length,
    results,
  })
}
