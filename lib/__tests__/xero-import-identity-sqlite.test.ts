import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '@/db/d1'
import { callXeroAPI } from '@/lib/xero'
import { importXeroInvoices } from '@/lib/xero-sync'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'

vi.mock('@/lib/xero', () => ({
  callXeroAPI: vi.fn(), callXeroAPIOrThrow: vi.fn(),
  XeroAPIError: class XeroAPIError extends Error {},
}))

let fixture: ReturnType<typeof permissionSqlite>
function invoice(contactId: string | null, name: string) {
  return {
    InvoiceID: 'xero-invoice', InvoiceNumber: 'XERO-001', Status: 'DRAFT',
    Contact: { ContactID: contactId, Name: name },
    SubTotal: 100, Total: 115, CurrencyCode: 'NZD', AmountDue: 115,
    DateString: '2026-10-13T00:00:00Z', LineItems: [{ Description: 'Design', Quantity: 1, UnitAmount: 100, LineAmount: 100 }],
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture = permissionSqlite([schema.organisations, schema.invoices, schema.invoiceItems])
  fixture.insert(schema.organisations, { id: 'unlinked', name: 'Kowhai', xero_contact_id: null })
  fixture.insert(schema.organisations, { id: 'linked', name: 'Different display name', xero_contact_id: 'contact-linked' })
})
afterEach(() => fixture.close())

describe('Xero importer identity matching over SQLite', () => {
  it.each(['Kowhai', 'Kowhai Ltd', 'Kow', 'New client', ''])('skips unlinked name %j without creating or changing a client', async name => {
    vi.mocked(callXeroAPI).mockResolvedValue({ Invoices: [invoice('contact-unknown', name)] } as never)
    const before = fixture.rows(schema.organisations)
    for (let pass = 0; pass < 2; pass++) {
      const outcome = await importXeroInvoices(fixture.database, 1)
      expect(outcome).toMatchObject({ ok: true, count: 0, body: {
        imported: 0, skipped: 1, results: [{ status: 'no_client_linked', orgMatch: expect.stringContaining('contact-unknown') }],
      } })
    }
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.rows(schema.invoices)).toEqual([])
    expect(fixture.rows(schema.invoiceItems)).toEqual([])
    expect(fixture.queries.filter(query => /^(insert|update|delete)\b/i.test(query))).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it.each([null, ''])('never matches a missing contact id %j to an unlinked client', async contactId => {
    vi.mocked(callXeroAPI).mockResolvedValue({ Invoices: [invoice(contactId, 'Kowhai')] } as never)
    expect(await importXeroInvoices(fixture.database, 1)).toMatchObject({ body: { imported: 0, skipped: 1 } })
    expect(fixture.rows(schema.invoices)).toEqual([])
    expect(fixture.rows(schema.organisations)).toHaveLength(2)
  })

  it('imports under the exact linked id regardless of contact display name', async () => {
    vi.mocked(callXeroAPI).mockResolvedValue({ Invoices: [invoice('contact-linked', 'Kowhai Ltd')] } as never)
    const before = fixture.rows(schema.organisations)
    expect(await importXeroInvoices(fixture.database, 1)).toMatchObject({ ok: true, count: 1, body: { imported: 1, skipped: 0 } })
    expect(fixture.rows(schema.invoices)).toEqual([expect.objectContaining({ org_id: 'linked', xero_invoice_id: 'xero-invoice' })])
    expect(fixture.rows(schema.invoiceItems)).toHaveLength(1)
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.errors).toEqual([])
  })
})
