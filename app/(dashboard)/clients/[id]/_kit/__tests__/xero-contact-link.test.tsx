import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionsProvider } from '@/components/tahi/permissions-context'
import { confirmXeroContact, XeroContactChoices, XeroContactLink, type XeroContactMatch } from '../xero-contact-link'
import type { Organisation } from '../types'

const contactId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const org: Organisation = {
  id: 'org-1', name: 'Renamed client', website: null, industry: null, planType: null,
  status: 'active', healthStatus: null, healthNote: null, internalNotes: null,
  brands: null, tags: null, preferredCurrency: 'NZD', customMrr: null,
  customMrrCurrency: null, billingModel: null, defaultHourlyRate: null,
  retainerStartDate: null, retainerEndDate: null,
  createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
}
const contacts = [{ name: 'Michael', email: 'michael@client.test' }]
const match: XeroContactMatch = {
  xeroContactId: contactId, xeroName: 'Old company name', xeroEmail: 'billing@old-company.test',
  matchedOrgId: org.id, matchedOrgName: org.name, confidence: 'suggested',
}

function card(isAdmin = true, integrations = true, client = org) {
  return renderToStaticMarkup(
    <PermissionsProvider value={{ level: isAdmin ? 'admin' : 'team_member', isAdmin, isSuperAdmin: false, canManagePermissions: false, features: { 'settings.integrations': integrations } }}>
      <XeroContactLink org={client} contacts={contacts} onUpdated={() => undefined} />
    </PermissionsProvider>,
  )
}

beforeEach(() => vi.unstubAllGlobals())

describe('Xero contact billing card', () => {
  it('offers the link to admins with the route permission, with a touch target', () => {
    const html = card()
    expect(html).toContain('Link Xero contact')
    expect(html).toContain('Connect an existing Xero contact before pushing invoices.')
    expect(html).toContain('min-height:2.75rem')
  })
  it('is absent when admin or integrations access is denied', () => {
    expect(card(false)).toBe('')
    expect(card(true, false)).toBe('')
  })
  it('shows the current mapping and disables archived clients', () => {
    expect(card(true, true, { ...org, xeroContactId: contactId })).toContain(`Linked to ${contactId}`)
    expect(card(true, true, { ...org, status: 'archived' })).toContain('disabled=""')
  })
  it('shows both identities and emails and requires explicit candidate selection', () => {
    const html = renderToStaticMarkup(<XeroContactChoices org={org} contacts={contacts} matches={[match]} selectedId="" onSelect={() => undefined} />)
    for (const identity of [org.name, contacts[0].email, match.xeroName, match.xeroEmail!, contactId]) expect(html).toContain(identity)
    expect(html).toContain('Suggested by name. Check the emails before confirming.')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('grid-cols-1 md:grid-cols-2')
  })
  it('clearly blocks a candidate already linked to another company', () => {
    const html = renderToStaticMarkup(<XeroContactChoices org={org} contacts={contacts} matches={[{ ...match, confidence: 'linked', matchedOrgId: 'org-2', matchedOrgName: 'Another company' }]} selectedId="" onSelect={() => undefined} />)
    expect(html).toContain('Already linked to another client: Another company')
    expect(html).toContain('disabled=""')
  })
  it('explains absent contacts and the direct ContactID fallback', () => {
    const html = renderToStaticMarkup(<XeroContactChoices org={org} contacts={[]} matches={[]} selectedId="" onSelect={() => undefined} />)
    expect(html).toContain('No contacts on this client')
    expect(html).toContain('Paste a ContactID below to link it directly.')
  })
  it('confirms the client and ContactID through the existing PATCH', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    await confirmXeroContact(org.id, contactId)
    expect(fetch).toHaveBeenCalledWith('/api/admin/integrations/xero/match-contacts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: org.id, xeroContactId: contactId }),
    })
  })
  it('preserves the server conflict message on a 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'This Xero contact is already linked to another client.' }, { status: 409 })))
    await expect(confirmXeroContact(org.id, contactId)).rejects.toThrow('This Xero contact is already linked to another client.')
  })
})
