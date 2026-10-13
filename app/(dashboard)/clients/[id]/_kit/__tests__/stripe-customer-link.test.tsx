import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionsProvider } from '@/components/tahi/permissions-context'
import { StripeCustomerLink, StripeLinkPreviewDetails, type StripeLinkPreview } from '../stripe-customer-link'
import type { Organisation } from '../types'

const org: Organisation = {
  id: 'org-1', name: 'Giant Group', website: null, industry: null, planType: null,
  status: 'active', healthStatus: null, healthNote: null, internalNotes: null,
  brands: null, tags: null, preferredCurrency: 'NZD', customMrr: null,
  customMrrCurrency: null, billingModel: null, defaultHourlyRate: null,
  retainerStartDate: null, retainerEndDate: null,
  createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
}

const preview: StripeLinkPreview = {
  canApply: true,
  conflicts: [],
  previewKey: 'signed-preview',
  client: { id: org.id, name: org.name, stripeCustomerId: null, contacts: [{ name: 'Michael', email: 'michael@example.com' }] },
  customer: { id: 'cus_live123', name: 'Giant Group Billing', email: 'billing@example.com', livemode: true },
  linkedClients: [],
  alreadyLinked: false,
}

function renderCard(isSuperAdmin: boolean, client = org) {
  return renderToStaticMarkup(
    <PermissionsProvider value={{ level: isSuperAdmin ? 'super_admin' : 'admin', isAdmin: true, isSuperAdmin, canManagePermissions: isSuperAdmin, features: {} }}>
      <StripeCustomerLink org={client} onUpdated={() => undefined} />
    </PermissionsProvider>,
  )
}

describe('Stripe customer link billing action', () => {
  it('is absent for a seat that is not a super admin', () => {
    expect(renderCard(false)).toBe('')
  })

  it('offers the existing customer link action for a super admin', () => {
    const html = renderCard(true)
    expect(html).toContain('Link Stripe customer')
    expect(html).toContain('Connect an existing live customer')
    expect(html).toContain('min-height:2.75rem')
  })

  it('shows the current customer mapping', () => {
    expect(renderCard(true, { ...org, stripeCustomerId: 'cus_current' })).toContain('Linked to cus_current')
  })

  it('disables the action for an archived client', () => {
    expect(renderCard(true, { ...org, status: 'archived' })).toContain('disabled=""')
  })
})

describe('Stripe customer link preview', () => {
  it('shows both sides and live customer details before confirmation', () => {
    const html = renderToStaticMarkup(<StripeLinkPreviewDetails preview={preview} />)
    for (const detail of ['Giant Group', 'Not linked', 'Michael', 'michael@example.com', 'cus_live123', 'Giant Group Billing', 'billing@example.com', 'Live', 'No clients linked yet']) {
      expect(html).toContain(detail)
    }
    expect(html).toContain('then confirm this link')
  })

  it('renders mapping conflicts without asking for confirmation', () => {
    const html = renderToStaticMarkup(<StripeLinkPreviewDetails preview={{ ...preview, canApply: false, conflicts: ['This Stripe customer is linked to another client.'], linkedClients: [{ id: 'org-2', name: 'Another client' }] }} />)
    expect(html).toContain('Link blocked')
    expect(html).toContain('role="alert"')
    expect(html).toContain('This Stripe customer is linked to another client.')
    expect(html).toContain('Another client')
    expect(html).not.toContain('then confirm this link')
  })

  it('explains an existing link without asking to apply again', () => {
    const html = renderToStaticMarkup(<StripeLinkPreviewDetails preview={{ ...preview, alreadyLinked: true }} />)
    expect(html).toContain('Already linked')
    expect(html).not.toContain('then confirm this link')
  })

  it('has clear empty states when Stripe and the client have no contact details', () => {
    const html = renderToStaticMarkup(<StripeLinkPreviewDetails preview={{ ...preview, client: { ...preview.client, contacts: [] }, customer: { ...preview.customer, name: null, email: null } }} />)
    expect(html).toContain('No contacts on this client')
    expect(html).toContain('No name on this customer')
    expect(html).toContain('No email on this customer')
  })
})
