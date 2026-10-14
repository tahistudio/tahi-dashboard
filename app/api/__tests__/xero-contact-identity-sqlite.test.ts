import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { callXeroAPI, callXeroAPIOrThrow } from '@/lib/xero'
import { POST as pushInvoice } from '@/app/api/admin/invoices/xero-sync/route'
import { GET as matchContacts, PATCH as confirmContact } from '@/app/api/admin/integrations/xero/match-contacts/route'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'api-service', orgId: 'org-tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org-tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/xero', () => ({
  callXeroAPI: vi.fn(), callXeroAPIOrThrow: vi.fn(),
  XeroAPIError: class XeroAPIError extends Error {},
}))

let fixture: ReturnType<typeof permissionSqlite>
const existingContactId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const newContactId = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890'
const raceContactId = 'c1b2c3d4-e5f6-7890-abcd-ef1234567890'

function request(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/admin/${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture = permissionSqlite([schema.organisations, schema.invoices, schema.invoiceItems])
  fixture.insert(schema.organisations, { id: 'unlinked', name: 'Other client', status: 'active', xero_contact_id: null })
  fixture.insert(schema.organisations, { id: 'linked', name: 'Other client', status: 'active', xero_contact_id: existingContactId })
  fixture.insert(schema.invoices, { id: 'invoice-unlinked', org_id: 'unlinked', status: 'draft' })
  vi.mocked(db).mockResolvedValue(fixture.database as unknown as Awaited<ReturnType<typeof db>>)
  vi.mocked(callXeroAPI).mockResolvedValue({ Contacts: [{ ContactID: existingContactId, Name: 'Other client' }] } as never)
  vi.mocked(callXeroAPIOrThrow).mockResolvedValue({ Contacts: [{ ContactID: existingContactId, Name: 'Other client' }] } as never)
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
      orgId: 'unlinked', xeroContactId: existingContactId,
    }))

    expect(response.status).toBe(409)
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.errors).toEqual([])
  })

  it('refuses an uppercase copy of a contact already linked elsewhere', async () => {
    fixture.sqlite.prepare('UPDATE organisations SET xero_contact_id = ? WHERE id = ?').run(existingContactId.toUpperCase(), 'linked')
    const before = fixture.rows(schema.organisations)
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'unlinked', xeroContactId: ` ${existingContactId.toUpperCase()} `,
    }))

    expect(response.status).toBe(409)
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.errors).toEqual([])
  })

  it('refuses an invalid ContactID before querying or updating a client', async () => {
    const before = fixture.rows(schema.organisations)
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'unlinked', xeroContactId: 'abc',
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'xeroContactId must be a valid UUID.' })
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.queries).toEqual([])
  })

  it('shows a linked contact even when Xero and the stored id have different casing', async () => {
    vi.mocked(callXeroAPI).mockResolvedValue({ Contacts: [{ ContactID: existingContactId.toUpperCase(), Name: 'Changed name' }] } as never)
    const response = await matchContacts(new NextRequest('http://localhost:3000/api/admin/integrations/xero/match-contacts'))
    expect(await response.json()).toMatchObject({ matches: [{ confidence: 'linked', matchedOrgId: 'linked' }] })
  })

  it('refuses a missing client without reporting success', async () => {
    const before = fixture.rows(schema.organisations)
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'missing', xeroContactId: newContactId,
    }))

    expect(response.status).toBe(404)
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.queries.filter(query => /^update\b/i.test(query))).toEqual([])
  })

  it('links an available contact and accepts confirmation of its existing client', async () => {
    for (let pass = 0; pass < 2; pass++) {
      const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
        orgId: 'unlinked', xeroContactId: ` ${newContactId.toUpperCase()} `,
      }))
      expect(response.status).toBe(200)
    }
    expect(fixture.rows(schema.organisations)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'unlinked', xero_contact_id: newContactId }),
      expect.objectContaining({ id: 'linked', xero_contact_id: existingContactId }),
    ]))
    expect(fixture.errors).toEqual([])
  })

  it.each([undefined, false, 'true', 1])('requires explicit replacement when replace is %j', async replace => {
    const before = fixture.rows(schema.organisations)
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'linked', xeroContactId: newContactId, replace,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'This client already has a different Xero contact. Confirm replacing the current link and send replace: true.' })
    expect(fixture.rows(schema.organisations)).toEqual(before)
    expect(fixture.queries.filter(query => /^update\b/i.test(query))).toEqual([])
  })

  it('replaces the current contact only with explicit approval', async () => {
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'linked', xeroContactId: newContactId.toUpperCase(), replace: true,
    }))

    expect(response.status).toBe(200)
    expect(fixture.rows(schema.organisations)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'linked', xero_contact_id: newContactId }),
    ]))
    expect(fixture.errors).toEqual([])
  })

  it('still refuses a duplicate contact when replacement is approved', async () => {
    fixture.sqlite.prepare('UPDATE organisations SET xero_contact_id = ? WHERE id = ?').run(newContactId, 'unlinked')
    const before = fixture.rows(schema.organisations)
    const response = await confirmContact(request('integrations/xero/match-contacts', 'PATCH', {
      orgId: 'linked', xeroContactId: newContactId.toUpperCase(), replace: true,
    }))

    expect(response.status).toBe(409)
    expect(fixture.rows(schema.organisations)).toEqual(before)
  })

  it('lets only one client claim the same contact in concurrent confirmations', async () => {
    const responses = await Promise.all(['unlinked', 'linked'].map(orgId =>
      confirmContact(request('integrations/xero/match-contacts', 'PATCH', { orgId, xeroContactId: raceContactId, replace: true })),
    ))

    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(fixture.rows(schema.organisations).filter(org => org.xero_contact_id === raceContactId)).toHaveLength(1)
    expect(fixture.errors).toEqual([])
  })

  it.each(['unlinked', 'linked'])('does not overwrite a concurrently changed link for %s', async orgId => {
    const responses = await Promise.all([newContactId, raceContactId].map(xeroContactId =>
      confirmContact(request('integrations/xero/match-contacts', 'PATCH', { orgId, xeroContactId, ...(orgId === 'linked' ? { replace: true } : {}) })),
    ))

    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const conflict = responses.find(response => response.status === 409)
    expect(await conflict?.json()).toEqual({ error: 'The current Xero contact link changed. Reload the client and confirm the link again.' })
    expect(fixture.errors).toEqual([])
  })
})
