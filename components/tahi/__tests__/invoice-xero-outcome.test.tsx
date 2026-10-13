import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps, ReactNode } from 'react'
import { isValidElement } from 'react'
import { ClientBillingLink, xeroSyncError } from '@/app/(dashboard)/invoices/xero-sync-result'
import { InvoiceDetail } from '@/app/(dashboard)/invoices/[id]/invoice-detail'
import { CreateInvoiceSlideOver } from '@/app/(dashboard)/invoices/invoice-list'
import { XeroLinkDialog } from '@/app/(dashboard)/clients/[id]/_kit/xero-contact-link'
import type { Organisation } from '@/app/(dashboard)/clients/[id]/_kit/types'

const captured = vi.hoisted(() => ({
  stateIndex: 0, stateCount: 0, states: new Map<number, unknown>(),
  buttons: new Map<string, () => void>(),
  submit: null as ((event: { preventDefault: () => void }) => Promise<void>) | null,
  confirmReplacement: null as (() => Promise<void> | void) | null,
  cancelReplacement: null as (() => void) | null,
  toast: vi.fn(), mutate: vi.fn(),
  xeroLoading: false,
  xeroError: undefined as unknown,
}))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual, useState: (initial: unknown) => {
    const index = captured.stateIndex++
    if (index >= captured.stateCount) return actual.useState(initial)
    const value = captured.states.has(index) ? captured.states.get(index) : initial
    return [value, (next: unknown) => captured.states.set(index, typeof next === 'function' ? next(value) : next)]
  } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/invoices' }))
vi.mock('@/components/tahi/toast', () => ({ useToast: () => ({ showToast: captured.toast }) }))
vi.mock('@/components/tahi/impersonation-banner', () => ({ useImpersonation: () => ({ isImpersonatingClient: false }) }))
vi.mock('swr', () => ({ default: (key: string | null) => ({
  data: key === '/api/admin/integrations/xero/match-contacts' ? { matches: [{ xeroContactId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', xeroName: 'Old client name', xeroEmail: 'billing@client.test', matchedOrgId: 'org-1', matchedOrgName: 'Client', confidence: 'suggested' }] }
    : key === '/api/admin/invoices/inv-1' ? { invoice: { id: 'inv-1', orgId: 'org-1', orgName: 'Client', status: 'draft', currency: 'NZD', totalUsd: 100, amountUsd: 100, source: 'xero', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' }, items: [] }
    : key === '/api/admin/clients' ? { organisations: [{ id: 'org-1', name: 'Client', invoiceChannel: 'xero' }] }
    : key === '/api/admin/settings' ? { settings: {} } : { contacts: [] },
  isLoading: key === '/api/admin/integrations/xero/match-contacts' && captured.xeroLoading,
  error: key === '/api/admin/integrations/xero/match-contacts' ? captured.xeroError : undefined, mutate: captured.mutate,
}) }))
vi.mock('@/components/tahi/tahi-button', async original => {
  const actual = await original<typeof import('@/components/tahi/tahi-button')>()
  return { ...actual, TahiButton: (props: ComponentProps<typeof actual.TahiButton>) => {
    if (typeof props.children === 'string' && props.onClick) captured.buttons.set(props.children, props.onClick as () => void)
    return <actual.TahiButton {...props} />
  } }
})
vi.mock('@/components/tahi/confirm-dialog', async original => {
  const actual = await original<typeof import('@/components/tahi/confirm-dialog')>()
  return { ...actual, ConfirmDialog: (props: ComponentProps<typeof actual.ConfirmDialog>) => {
    captured.confirmReplacement = props.open ? props.onConfirm : null
    captured.cancelReplacement = props.open ? props.onCancel : null
    return <actual.ConfirmDialog {...props} />
  } }
})
vi.mock('@/components/tahi/slide-over', async original => {
  const actual = await original<typeof import('@/components/tahi/slide-over')>()
  const OriginalBody = actual.SlideOver.Body
  function captureForm(node: ReactNode): void {
    if (Array.isArray(node)) { node.forEach(captureForm); return }
    if (!isValidElement<{ children?: ReactNode; onSubmit?: typeof captured.submit }>(node)) return
    if (node.type === 'form' && node.props.onSubmit) captured.submit = node.props.onSubmit
    captureForm(node.props.children)
  }
  const Body = (props: ComponentProps<typeof OriginalBody>) => { captureForm(props.children); return <OriginalBody {...props} /> }
  return { ...actual, SlideOver: Object.assign(actual.SlideOver, { Body }) }
})

const reason = 'Link this client to a Xero contact first'
const failure = { success: false, failed: 1, results: [{ invoiceId: 'inv-1', status: 'error', error: reason }] }
function renderDetail() { captured.stateIndex = 0; captured.stateCount = 4; return renderToStaticMarkup(<InvoiceDetail invoiceId="inv-1" isAdmin />) }
function renderCreate() { captured.stateIndex = 0; captured.stateCount = 12; captured.submit = null; return renderToStaticMarkup(<CreateInvoiceSlideOver open onClose={() => undefined} onCreated={() => undefined} />) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  captured.stateIndex = 0; captured.stateCount = 0; captured.states.clear(); captured.buttons.clear(); captured.submit = null
  captured.confirmReplacement = null; captured.cancelReplacement = null
  captured.xeroLoading = false; captured.xeroError = undefined
  captured.mutate.mockResolvedValue(undefined)
})

describe('Xero invoice outcome', () => {
  it('reads per-invoice errors even when HTTP and the old overall success flag claim success', () => {
    expect(xeroSyncError({ ...failure, success: true }, true)).toBe(reason)
    expect(xeroSyncError({ failed: 1, message: reason }, true)).toBe(reason)
    expect(xeroSyncError({ error: reason }, false)).toBe(reason)
    expect(xeroSyncError({ success: true, failed: 0, results: [{ invoiceId: 'inv-1', status: 'synced' }] }, true)).toBeNull()
  })
  it('renders the billing destination with a touch target', () => {
    const html = renderToStaticMarkup(<ClientBillingLink orgId="org-1" />)
    expect(html).toContain('href="/clients/org-1?tab=money"')
    expect(html).toContain('min-height:2.75rem')
  })
  it.each([200, 422])('detail shows an error and billing link for an unlinked client (HTTP %s)', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(failure, { status })))
    renderDetail()
    captured.buttons.get('Sync to Xero')?.()
    await vi.waitFor(() => expect(captured.toast).toHaveBeenCalledWith(reason, 'error'))
    expect(captured.mutate).not.toHaveBeenCalled()
    expect(captured.toast).not.toHaveBeenCalledWith('Synced to Xero.', 'success')
    const html = renderDetail()
    expect(html).toContain(reason)
    expect(html).toContain('href="/clients/org-1?tab=money"')
  })
  it.each([200, 422])('creation keeps the local draft, reason and billing link when Xero fails (HTTP %s)', async status => {
    captured.states.set(0, 'org-1'); captured.states.set(3, 'Client'); captured.states.set(4, 'xero')
    captured.states.set(5, [{ description: 'Design', quantity: '1', unitAmount: '100' }])
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: 'inv-1' })).mockResolvedValueOnce(Response.json(failure, { status }))
    vi.stubGlobal('fetch', fetch)
    renderCreate()
    expect(captured.submit).not.toBeNull()
    await captured.submit?.({ preventDefault: () => undefined })
    expect(captured.toast).toHaveBeenCalledWith(reason, 'error')
    expect(captured.toast).not.toHaveBeenCalledWith('Invoice created as Xero draft')
    const html = renderCreate()
    expect(html).toContain(reason)
    expect(html).toContain('href="/clients/org-1?tab=money"')
    expect(html).toContain('View saved invoice')
    expect(html).not.toContain('id="create-invoice-form"')
    captured.states.set(0, 'org-2')
    expect(renderCreate()).toContain('href="/clients/org-1?tab=money"')
    expect(captured.submit).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

const client: Organisation = {
  id: 'org-1', name: 'Renamed client', website: null, industry: null, planType: null,
  status: 'active', healthStatus: null, healthNote: null, internalNotes: null,
  brands: null, tags: null, preferredCurrency: 'NZD', customMrr: null,
  customMrrCurrency: null, billingModel: null, defaultHourlyRate: null,
  retainerStartDate: null, retainerEndDate: null,
  createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
}
const contacts = [{ name: 'Michael', email: 'michael@client.test' }]
function renderXeroDialog(onUpdated = vi.fn(), org = client) {
  captured.stateIndex = 0; captured.stateCount = 5
  return renderToStaticMarkup(<XeroLinkDialog org={org} contacts={contacts} onClose={() => undefined} onUpdated={onUpdated} />)
}

describe('Xero contact dialog confirmation', () => {
  it('confirms the selected ContactID from the rendered form and refreshes the client', async () => {
    const contactId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    captured.states.set(0, contactId)
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    const updated = vi.fn()
    const html = renderXeroDialog(updated)
    for (const text of ['Renamed client', 'michael@client.test', 'Old client name', 'billing@client.test', 'Confirm link']) expect(html).toContain(text)
    captured.submit?.({ preventDefault: () => undefined })
    await vi.waitFor(() => expect(updated).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith('/api/admin/integrations/xero/match-contacts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: client.id, xeroContactId: contactId }),
    })
    expect(renderXeroDialog()).toContain('Xero contact linked')
  })
  it('keeps a PATCH 409 visible in the dialog with no successful refresh', async () => {
    captured.states.set(0, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'This Xero contact is already linked to another client.' }, { status: 409 })))
    const updated = vi.fn()
    renderXeroDialog(updated)
    captured.submit?.({ preventDefault: () => undefined })
    await vi.waitFor(() => expect(captured.states.get(2)).toBe('This Xero contact is already linked to another client.'))
    expect(updated).not.toHaveBeenCalled()
    expect(renderXeroDialog()).toContain('role="alert"')
    expect(renderXeroDialog()).toContain('This Xero contact is already linked to another client.')
  })
  it('retains client contact emails while suggestions load and offers direct ContactID entry', () => {
    captured.xeroLoading = true
    const html = renderXeroDialog()
    expect(html).toContain('Loading Xero contacts...')
    expect(html).toContain('michael@client.test')
    expect(html).toContain('Xero ContactID')
  })
  it('shows the current link and requires a separate confirmation before replacement', async () => {
    const currentId = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const contactId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const org = { ...client, xeroContactId: currentId }
    captured.states.set(0, contactId.toUpperCase())
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    const updated = vi.fn()

    expect(renderXeroDialog(updated, org)).toContain('Current Xero link')
    captured.submit?.({ preventDefault: () => undefined })
    expect(fetch).not.toHaveBeenCalled()
    const confirmation = renderXeroDialog(updated, org)
    for (const text of ['Replace current Xero contact?', currentId, contactId, 'Replace Xero link']) expect(confirmation).toContain(text)
    expect(captured.confirmReplacement).not.toBeNull()
    await captured.confirmReplacement?.()

    expect(fetch).toHaveBeenCalledWith('/api/admin/integrations/xero/match-contacts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: client.id, xeroContactId: contactId, replace: true }),
    })
    expect(updated).toHaveBeenCalledOnce()
    expect(renderXeroDialog(updated, org)).toContain('Xero contact linked')
  })
  it('leaves the current link unchanged when replacement confirmation is cancelled', () => {
    const org = { ...client, xeroContactId: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890' }
    captured.states.set(0, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const updated = vi.fn()
    renderXeroDialog(updated, org)
    captured.submit?.({ preventDefault: () => undefined })
    renderXeroDialog(updated, org)
    captured.cancelReplacement?.()
    expect(renderXeroDialog(updated, org)).not.toContain('Replace current Xero contact?')
    expect(fetch).not.toHaveBeenCalled()
    expect(updated).not.toHaveBeenCalled()
  })
  it('confirms the same current contact with different casing without replacement approval', async () => {
    const contactId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    captured.states.set(0, contactId)
    const org = { ...client, xeroContactId: contactId.toUpperCase() }
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    const updated = vi.fn()
    renderXeroDialog(updated, org)
    captured.submit?.({ preventDefault: () => undefined })
    await vi.waitFor(() => expect(updated).toHaveBeenCalledOnce())
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ orgId: client.id, xeroContactId: contactId })
    expect(captured.confirmReplacement).toBeNull()
  })
})
