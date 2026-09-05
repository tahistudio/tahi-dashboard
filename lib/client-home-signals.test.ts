import { describe, it, expect } from 'vitest'
import { REVIEWABLE_STATUS } from './request-review'
import {
  CLIENT_OPEN_STATUSES,
  CLIENT_REVIEW_STATUS,
  fileOpenDestination,
  invoicePayDestination,
  isDeliveredForClient,
  isOpenForClient,
  needsClientReview,
  partitionClientRequests,
  requestRouteId,
} from './client-home-signals'

/** Every status a client request can actually hold, per lib/status-config.ts. */
const ALL_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'in_progress',
  'client_review',
  'on_hold',
  'delivered',
  'cancelled',
  'archived',
]

describe('needsClientReview', () => {
  it('is true only for client_review', () => {
    expect(needsClientReview('client_review')).toBe(true)
    for (const s of ALL_STATUSES.filter(s => s !== 'client_review')) {
      expect(needsClientReview(s)).toBe(false)
    }
  })

  it('does not count delivered work, which the client already approved', () => {
    // The regression this helper exists to stop: delivered is the terminal
    // state a client APPROVAL moves a request into, so counting it as
    // "waiting on you" made the prompt grow every time the client acted.
    expect(needsClientReview('delivered')).toBe(false)
  })

  it('ignores unknown or malformed statuses', () => {
    for (const s of ['', 'Client_Review', 'reviewed', 'client review']) {
      expect(needsClientReview(s)).toBe(false)
    }
  })

  it('reads the same status the review route enforces', () => {
    // The home's review signal and the portal review route must never disagree
    // about which status a client is allowed to act on, so the slug is owned
    // once in lib/request-review.ts and only aliased here.
    expect(CLIENT_REVIEW_STATUS).toBe(REVIEWABLE_STATUS)
    expect(needsClientReview(REVIEWABLE_STATUS)).toBe(true)
  })
})

describe('isOpenForClient', () => {
  it('covers the statuses where the studio still holds the work', () => {
    // Spelled out rather than iterated over CLIENT_OPEN_STATUSES: iterating the
    // list the predicate is built from cannot fail, not even when a status is
    // deleted from it. 'on_hold' is the one that differs from the /requests
    // "In progress" saved view, so it is the one worth pinning.
    for (const s of ['submitted', 'in_review', 'in_progress', 'on_hold']) {
      expect(isOpenForClient(s)).toBe(true)
    }
  })

  it('exports the same list the predicate reads', () => {
    expect([...CLIENT_OPEN_STATUSES]).toEqual(['submitted', 'in_review', 'in_progress', 'on_hold'])
  })

  it('excludes client_review, delivered and every closed status', () => {
    for (const s of ['client_review', 'delivered', 'cancelled', 'archived', 'draft']) {
      expect(isOpenForClient(s)).toBe(false)
    }
  })
})

describe('isDeliveredForClient', () => {
  it('is true only for delivered', () => {
    expect(isDeliveredForClient('delivered')).toBe(true)
    for (const s of ALL_STATUSES.filter(s => s !== 'delivered')) {
      expect(isDeliveredForClient(s)).toBe(false)
    }
  })
})

describe('partitionClientRequests', () => {
  const rows = [
    { id: 'a', status: 'client_review' },
    { id: 'b', status: 'delivered' },
    { id: 'c', status: 'in_progress' },
    { id: 'd', status: 'delivered' },
    { id: 'e', status: 'submitted' },
    { id: 'f', status: 'cancelled' },
  ]

  it('splits a mixed list into review, open and delivered', () => {
    const out = partitionClientRequests(rows)
    expect(out.review.map(r => r.id)).toEqual(['a'])
    expect(out.open.map(r => r.id)).toEqual(['c', 'e'])
    expect(out.delivered.map(r => r.id)).toEqual(['b', 'd'])
  })

  it('leaves cancelled and archived out of all three buckets', () => {
    const out = partitionClientRequests([
      { id: 'x', status: 'cancelled' },
      { id: 'y', status: 'archived' },
    ])
    expect(out.review).toEqual([])
    expect(out.open).toEqual([])
    expect(out.delivered).toEqual([])
  })

  it('keeps the incoming order inside each bucket', () => {
    const out = partitionClientRequests([
      { id: '1', status: 'delivered' },
      { id: '2', status: 'delivered' },
      { id: '3', status: 'delivered' },
    ])
    expect(out.delivered.map(r => r.id)).toEqual(['1', '2', '3'])
  })

  it('handles an empty list', () => {
    expect(partitionClientRequests([])).toEqual({ review: [], open: [], delivered: [] })
  })

  it('approving a request moves it out of review and never back in', () => {
    // client_review -> delivered is exactly what POST /api/portal/requests/[id]/review
    // does on "approve". The review bucket must shrink, not hold steady.
    const before = partitionClientRequests([{ id: 'a', status: 'client_review' }])
    const after = partitionClientRequests([{ id: 'a', status: 'delivered' }])
    expect(before.review).toHaveLength(1)
    expect(after.review).toHaveLength(0)
    expect(after.delivered).toHaveLength(1)
  })
})

describe('invoicePayDestination', () => {
  it('prefers the hosted pay link when there is one', () => {
    expect(invoicePayDestination({ id: 'inv-1', payUrl: 'https://invoice.stripe.com/i/abc' })).toEqual({
      kind: 'new_tab',
      url: 'https://invoice.stripe.com/i/abc',
    })
  })

  it('trims surrounding whitespace off the pay link', () => {
    expect(invoicePayDestination({ id: 'inv-1', payUrl: '  https://invoice.stripe.com/i/abc  ' })).toEqual({
      kind: 'new_tab',
      url: 'https://invoice.stripe.com/i/abc',
    })
  })

  it('falls back to the invoice itself, never the list', () => {
    for (const payUrl of [null, undefined, '', '   ']) {
      expect(invoicePayDestination({ id: 'inv-1', payUrl })).toEqual({ kind: 'route', routeId: 'invoices/inv-1' })
    }
  })

  it('refuses a pay link that is not http or https', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example.com', 'stripe.com/pay']) {
      expect(invoicePayDestination({ id: 'inv-1', payUrl: bad })).toEqual({ kind: 'route', routeId: 'invoices/inv-1' })
    }
  })

  it('falls back to the list only when there is no invoice to open', () => {
    expect(invoicePayDestination({ id: '', payUrl: null })).toEqual({ kind: 'route', routeId: 'invoices' })
  })
})

describe('fileOpenDestination', () => {
  it('opens the served file when the route gave us one', () => {
    expect(fileOpenDestination({ url: '/api/uploads/serve?key=org%2Ffile.pdf' })).toEqual({
      kind: 'new_tab',
      url: '/api/uploads/serve?key=org%2Ffile.pdf',
    })
  })

  it('falls back to the files browser when the url is missing', () => {
    for (const url of [null, undefined, '', '   ']) {
      expect(fileOpenDestination({ url })).toEqual({ kind: 'route', routeId: 'files' })
    }
  })

  it('refuses anything that is not an in-app absolute path', () => {
    for (const bad of [
      'https://evil.example.com/x',
      '//evil.example.com',
      // A browser normalises the backslash for special schemes, so this
      // resolves protocol-relative to an external host just like '//host'.
      '/\\evil.example.com',
      '\\\\evil.example.com',
      'javascript:alert(1)',
      'api/uploads/serve',
    ]) {
      expect(fileOpenDestination({ url: bad })).toEqual({ kind: 'route', routeId: 'files' })
    }
  })
})

describe('requestRouteId', () => {
  it('lands on the request, not the list', () => {
    expect(requestRouteId('9f1c')).toBe('requests/9f1c')
  })

  it('falls back to the list only when there is no id', () => {
    expect(requestRouteId('')).toBe('requests')
    expect(requestRouteId('   ')).toBe('requests')
  })

  it('encodes an id that would otherwise change the path', () => {
    expect(requestRouteId('a/b')).toBe('requests/a%2Fb')
  })
})
