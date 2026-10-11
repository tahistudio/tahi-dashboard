import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ApiError } from '@/lib/swr-fetcher'
import type { OverviewCtx } from '@/components/tahi/overview/ctx'

const resources = vi.hoisted(() => new Map<string, { data?: unknown; error?: unknown; isLoading?: boolean }>())
vi.mock('@/lib/use-resource', () => ({
  useResource: vi.fn((key: string | null) => {
    const resource = key ? resources.get(key) ?? {} : {}
    return { ...resource, isLoading: key ? resource.isLoading ?? (!resource.data && !resource.error) : false, mutate: vi.fn().mockResolvedValue(undefined) }
  }),
}))
vi.mock('@/lib/display-currency-context', () => ({
  useDisplayCurrency: () => ({
    format: (amount: number) => `NZD ${amount}`,
    formatNative: (amount: number, currency: string) => `${currency} ${amount}`,
    formatNativeWithDisplay: (amount: number, currency: string) => `${currency} ${amount}`,
  }),
}))

import { ClientHome } from '@/components/tahi/overview/homes/client-home'
import { useResource } from '@/lib/use-resource'

const ACTIVE = '/api/portal/requests?status=active&limit=200'
const REVIEW = '/api/portal/requests?status=client_review&limit=200'
const INVOICES = '/api/portal/invoices?status=all'
const SUB = '/api/portal/subscription'
const TRACKS = '/api/portal/tracks'
const CALLS = '/api/portal/calls'
const plan = { id: 'sub', planLabel: 'Negotiated plan', planType: 'custom', status: 'active', billingInterval: 'monthly', nextInvoiceDate: null, invoiceChannel: 'xero', monthlyRate: 1234, currency: 'GBP', customRate: true, trackCount: 1 }
const invoice = { id: 'inv', status: 'sent', totalAmount: 777, currency: 'GBP', dueDate: '2026-10-01', createdAt: '2026-09-01', payUrl: 'https://invoice.stripe.com/i/example' }
const queued = { id: 'q1', title: 'Queued work', type: 'small_task', status: 'submitted', priority: null, queueOrder: 0, dueDate: null, createdAt: '2026-09-01' }
const lane = { id: 'real-track', type: 'small', isPriorityTrack: false, currentRequest: null, queue: [queued] }

function home(overrides: Partial<OverviewCtx> = {}) {
  return renderToStaticMarkup(<ClientHome ctx={{ audience: 'client', isReadOnly: false, go: vi.fn(), orgName: 'Example', userName: 'Sam', ...overrides }} />)
}

function vital(html: string, label: string) {
  const from = html.indexOf(`<div class="vt-lbl">${label}</div>`)
  if (from < 0) return ''
  const end = html.indexOf('<div class="ov-vital">', from)
  return html.slice(from, end < 0 ? html.indexOf('</div></div></div>', from) : end)
}

beforeEach(() => {
  vi.clearAllMocks()
  resources.clear()
  for (const key of ['/api/portal/activity', INVOICES, CALLS, '/api/portal/files', '/api/portal/team']) resources.set(key, { data: { items: [] } })
  resources.set(ACTIVE, { data: { requests: [] } })
  resources.set(REVIEW, { data: { requests: [] } })
  resources.set(SUB, { data: { clientType: 'retainer', seat: 'admin', subscription: plan } })
  resources.set(TRACKS, { data: { items: [lane], subscription: { id: 'sub', planType: 'custom', status: 'active' } } })
})

describe('client home truth at composition boundaries', () => {
  it('shows invoice failure, an Unknown vital and a qualified hero instead of empty or settled claims', () => {
    resources.set(INVOICES, { error: new ApiError(500) })
    const html = home()
    expect(html).toContain('Your invoices did not load.')
    expect(vital(html, 'Invoices due')).toContain('Unknown')
    expect(html).toContain('Some checks did not answer')
    expect(html).not.toContain('No invoices yet.')
    expect(html).not.toContain('all settled')
    expect(html).not.toContain('All quiet')
  })

  it('withholds denied invoices without classifying the denial as an outage', () => {
    resources.set(INVOICES, { error: new ApiError(403) })
    const html = home()
    expect(html).not.toContain('Invoices due')
    expect(html).not.toContain('Your invoices did not load.')
    expect(html).not.toContain('Some checks did not answer')
    expect(html).toContain('Negotiated plan')
  })

  it('qualifies an empty hero when calls could not be read', () => {
    resources.set(CALLS, { error: new ApiError(500) })
    const html = home()
    expect(html).toContain('Your calls did not load.')
    expect(html).toContain('Some checks did not answer')
    expect(html).not.toContain('All quiet')
  })

  it('does not infer a retainer or fetch its board after a subscription failure', () => {
    resources.set(SUB, { error: new ApiError(500) })
    const html = home()
    expect(html).toContain('Your work did not load.')
    expect(html).toContain('Your plan did not load.')
    expect(html).not.toContain('Retainer')
    expect(html).not.toContain('0 active')
    expect(vi.mocked(useResource).mock.calls.map(([key]) => key)).not.toContain(TRACKS)
  })

  it('holds the plan and unknown work shape while subscription is loading', () => {
    resources.set(SUB, { isLoading: true })
    const html = home()
    expect(html).toContain('Loading')
    expect(html).not.toContain('Retainer plan')
    expect(html).not.toContain('Being set up.')
    expect(html).not.toContain('Your work in motion')
  })

  it('shows setup only for a confirmed admin response with no subscription', () => {
    resources.set(SUB, { data: { clientType: 'retainer', seat: 'admin', subscription: null } })
    resources.set(TRACKS, { data: { items: [], subscription: null } })
    const html = home()
    expect(html).toContain('Being set up.')
    expect(html).not.toContain('Retainer plan')
    expect(html).not.toContain('Ask about your plan')
  })

  it('keeps all financial readings away from a member even if an invoice remains in cache', () => {
    resources.set(SUB, { data: { clientType: 'retainer', seat: 'member', subscription: null } })
    resources.set(INVOICES, { data: { items: [invoice] } })
    const html = home()
    expect(html).toContain('Billing is handled by your account admin.')
    expect(html).not.toContain('Invoices due')
    expect(html).not.toContain('GBP 777')
    expect(html).not.toContain('Negotiated plan')
    expect(html).not.toContain('>Pay</button>')
  })

  it('retains last good data during failed revalidation without claiming it is freshly checked', () => {
    resources.set(INVOICES, { data: { items: [invoice] }, error: new ApiError(500) })
    resources.set(SUB, { data: { clientType: 'retainer', seat: 'admin', subscription: plan }, error: new ApiError(500) })
    const html = home()
    expect(html).toContain('GBP 777')
    expect(html).toContain('GBP 1234')
    expect(html).not.toContain('Your invoices did not load.')
    expect(html).not.toContain('Your plan did not load.')
    expect(html).not.toContain('Everything else here is current')
  })

  it('shows Unknown request/review vitals when neither request read answered', () => {
    resources.set(ACTIVE, { error: new ApiError(500) })
    resources.set(REVIEW, { error: new ApiError(500) })
    const html = home()
    for (const label of ['Open requests', 'Next delivery', 'To approve']) expect(vital(html, label)).toContain('Unknown')
    expect(html).toContain('Your overview did not load.')
    expect(html).not.toContain('All quiet')
  })

  it.each([ACTIVE, REVIEW])('keeps the review signal loading if %s fails before the other read settles', failed => {
    resources.set(failed, { error: new ApiError(500) })
    resources.set(failed === ACTIVE ? REVIEW : ACTIVE, { isLoading: true })
    const html = home()
    expect(html).toContain('Waiting on you, loading')
    expect(vital(html, 'To approve')).toContain('tahi-shimmer')
    expect(html).not.toContain('All quiet')
  })

  it('still warns about missing hand-offs when the dedicated review read succeeds', () => {
    resources.set(ACTIVE, { error: new ApiError(500) })
    const html = home()
    expect(html).toContain('Some checks did not answer')
    expect(vital(html, 'To approve')).not.toContain('Unknown')
    expect(html).not.toContain('All quiet')
  })

  it('adapts actual personal and team hand-off title fields', () => {
    const waitingOn = { contactId: 'contact', contactName: 'Alex', reason: 'content', reasonLabel: 'Content', since: '2026-09-01', dueAt: null, note: null, daysWaiting: 3 }
    resources.set(ACTIVE, { data: { requests: [], waitingOnYou: [{ requestId: 'r1', title: 'Personal hand-off', requestNumber: 1, waitingOn }], waitingOnOrg: [{ requestId: 'r2', title: 'Team hand-off', requestNumber: 2, waitingOn }] } })
    const html = home()
    expect(html).toContain('Personal hand-off')
    expect(html).toContain('Team hand-off')
    expect(html).toContain('Open request')
  })

  it('renders one queue across repeated lanes without adding request navigation', () => {
    resources.set(TRACKS, { data: { items: [lane, { ...lane, id: 'real-track-2' }] } })
    const html = home()
    expect((html.match(/<b>Queued work<\/b>/g) ?? [])).toHaveLength(1)
    expect((html.match(/\+ Queue another/g) ?? [])).toHaveLength(1)
    expect(html).not.toContain('href="/requests/q1"')
  })

  it('does not call contracted tracks active while a lane is still being set up', () => {
    resources.set(TRACKS, { data: { items: [{ ...lane, id: 'synthetic-small-0', synthetic: true }] } })
    const html = home()
    expect(html).toContain('On your plan, not live yet.')
    expect(html).toContain('<b>1 on your plan</b>')
    expect(html).not.toContain('<b>1 active</b>')
  })

  it.each([true, false])('preserves work and money boundaries in preview (read-only=%s)', ro => {
    resources.set(INVOICES, { data: { items: [invoice] } })
    const html = home({ isReadOnly: ro, isMoneyReadOnly: true, previewName: 'Example' })
    expect(html).toMatch(/<button[^>]*class="ov-cta ov-pay"[^>]*disabled=""[^>]*title="[^"]+"/)
    if (ro) {
      expect(html).toContain('Every action here is read-only')
      expect(html).not.toContain('aria-label="Move Queued work')
    } else {
      expect(html).toContain('Paying stays read-only; work actions remain available.')
      expect(html).toContain('aria-label="Move Queued work')
      expect(html).toMatch(/class="pfh-mast-cta tahi-focus-ring">/)
    }
  })

  it('keeps a failed project reading unknown and removes guessed invoice timing', () => {
    resources.set(SUB, { data: { clientType: 'project', seat: 'admin', subscription: null } })
    resources.set('/api/portal/project', { error: new ApiError(500) })
    const failed = home()
    expect(vital(failed, 'Project progress')).toContain('Unknown')
    expect(failed).toContain('Your project did not load.')
    resources.set('/api/portal/project', { data: { isProject: true, phases: [], progressKnown: false, project: null, nextInvoice: null, nextMilestone: null } })
    const ready = home()
    expect(ready).toContain('No invoice date available')
    expect(ready).toContain('No milestone date available')
    expect(ready).not.toContain('On launch')
    expect(ready).not.toContain('None due')
  })

  it('leaves the disabled onboarding feature unread', () => {
    home({ home: 'first' })
    expect(vi.mocked(useResource).mock.calls.map(([key]) => key)).not.toContain('/api/portal/onboarding')
  })
})
