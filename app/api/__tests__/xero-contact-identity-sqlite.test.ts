import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { callXeroAPI, callXeroAPIOrThrow } from '@/lib/xero'
import { POST as pushInvoice } from '@/app/api/admin/invoices/xero-sync/route'
import { PATCH as confirmContact } from '@/app/api/admin/integrations/xero/match-contacts/route'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user-admin', orgId: 'org-tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org-tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/xero', () => ({
  callXeroAPI: vi.fn(), callXeroAPIOrThrow: vi.fn(),
  XeroAPIError: class XeroAPIError extends Error {},
}))

let fixture: ReturnType<typeof permissionSqlite>

function request(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/admin/${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture = permissionSqlite([schema.organisations, schema.invoices, schema.invoiceItems])
  fixture.insert(schema.organisations, { id: 'unlinked', name: 'Other client', status: 'active', xero_contact_id: null })
  fixture.insert(schema.organisations, { id: 'linked', name: 'Other client', status: 'active', xero_contact_id: 'contact-existing' })
  fixture.insert(schema.invoices, { id: 'invoice-unlinked', org_id: 'unlinked', status: 'draft' })
  vi.mocked(db).mockResolvedValue(fixture.database as unknown as Awaited<ReturnType<typeof db>>)
  vi.mocked(callXeroAPI).mockResolvedValue({ Contacts: [{ ContactID: 'contact-existing', Name: 'Other client' }] } as never)
  vi.mocked(callXeroAPIOrThrow).mockResolvedValue({ Contacts: [{ ContactID: 'contact-existing', Name: 'Other client' }] } as never)
})
afterEach(() => fixture.close())

describe('Xero invoice push requires a confirmed identity over SQLite', () => {
  it.each(['Other client', 'Other "client"'])('refuses the unlinked display name %j without calling Xero or stamping any link', async name => {
    fixture.sqlite.prepare('UPDATE organisations SET name = ? WHERE id = ?').run(name, 'unlinked')
    const organisationsBefore = fixture.rows(schema.organisations)
    const invoicesBefore = fixture.rows(schema.invoices)

    const response = await pushInvoice(request('invoices/xero-sync', 'POST', { invoiceId: 'invoice-unlinked' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      success: false, synced: 0, updated: 0, failed: 1,
      results: [{
        invoiceId: 'invoice-unlinked', status: 'error',
        error: 'Link this client to a Xero contact first',
        matchContactsUrl: '/api/admin/integrations/xero/match-contacts',
      }],
    })
    expect(callXeroAPI).not.toHaveBeenCalled()
    expect(callXeroAPIOrThrow).not.toHaveBeenCalled()
    expect(fixture.rows(schema.organisations)).toEqual(organisationsBefore)
    expect(fixture.rows(schema.invoices)).toEqual(invoicesBefore)
    expect(fixture.queries.filter(query => /^(insert|update|delete)\b/i.test(query))).toEqual([])
    expect(fixture.errors).toEqual([])
  })
})

describe('Xero contact confirmation claims a unique client link over SQLite', () => {
  it('refuses a contact that another client already linked', async () => {
    const before = fixture.rows(schema.organisations)
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'unlinked', xeroContactId: 'contact-existing',
    }))

    expect(response.status).toBe(409)
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.errors).toEqual([])
  })

  it('refuses a missing client without reporting success', async () => {
    const before = fixture.rows(schema.organisations)
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'missing', xeroContactId: 'contact-new',
    }))

    expect(response.status).toBe(404)
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.queries.filter(query => /^update\b/i.test(query))).toEqual([])
  })

  it('links an available contact and accepts confirmation of its existing client', async () => {
    for (let pass = 0; pass < 2; pass++) {
      const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
        orgId: 'unlinked', xeroContactId: 'contact-new',
      }))
      expect(response.status).toBe(200)
    }
    expect(fixture.rows(schema.organisations)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'unlinked', xero_contact_id: 'contact-new' }),
      expect.objectContaining({ id: 'linked', xero_contact_id: 'contact-existing' }),
    ]))
    expect(fixture.errors).toEqual([])
  })

  it('lets only one client claim the same contact in concurrent confirmations', async () => {
    const responses = await Promise.all(['unlinked', 'linked'].map(orgId =>
      confirmContact(request('integrations/xero/match-contacts', 'PATCH', { orgId, xeroContactId: 'contact-race' })),
    ))

    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(fixture.rows(schema.organisations).filter(org => org.xero_contact_id === 'contact-race')).toHaveLength(1)
    expect(fixture.errors).toEqual([])
  })
})
