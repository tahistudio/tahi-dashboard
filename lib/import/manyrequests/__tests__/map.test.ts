/**
 * The field map, pinned.
 *
 * Every ManyRequests vocabulary value gets a case here, including the ones that
 * are judgement calls, because a status that quietly lands on the wrong D1
 * value shows a client either 34 cancelled requests that were delivered or 34
 * delivered ones that were dropped.
 */
import { describe, it, expect } from 'vitest'
import {
  buildFormResponses,
  commentKey,
  extractRequestBrief,
  invoiceItemKey,
  mapBillingInterval,
  mapInvoiceMoney,
  mapInvoicePaidAt,
  mapInvoiceStatus,
  mapOrgStatus,
  mapPlanType,
  mapRequestPriority,
  mapRequestStatus,
  mapSubscriptionStatus,
  normaliseCurrency,
  normaliseDate,
  normaliseTimestamp,
  resolveCommentAuthor,
  subscriptionKey,
  unescapeHtmlEntities,
} from '../map'
import { REQUEST_STATUS_CONFIG } from '@/lib/status-config'
import { PATCHABLE_STATUSES, REQUEST_PRIORITIES } from '@/lib/request-vocabulary'
import type { MrRequest } from '../types'

describe('request status', () => {
  const cases: Array<[string, string, boolean]> = [
    ['Submitted', 'submitted', false],
    ['In progress', 'in_progress', false],
    ['Awaiting Approval', 'client_review', false],
    ['Pending response', 'on_hold', false],
    ['On hold', 'on_hold', false],
    ['Queued', 'submitted', false],
    ['Completed', 'delivered', true],
  ]

  it.each(cases)('maps %s to %s', (source, expected, delivered) => {
    const mapped = mapRequestStatus(source)
    expect(mapped.status).toBe(expected)
    expect(mapped.delivered).toBe(delivered)
    expect(mapped.needsRuling).toBe(false)
  })

  it('is case and spacing tolerant, because the source labels are display text', () => {
    expect(mapRequestStatus('  in progress  ').status).toBe('in_progress')
    expect(mapRequestStatus('COMPLETED').status).toBe('delivered')
  })

  it('records why Pending response lost its meaning instead of dropping it', () => {
    const mapped = mapRequestStatus('Pending response')
    expect(mapped.note).toContain('waiting on the client')
  })

  it('routes Closed through the ruling and flags it every time', () => {
    expect(mapRequestStatus('Closed').status).toBe('cancelled')
    expect(mapRequestStatus('Closed').needsRuling).toBe(true)
    expect(mapRequestStatus('Closed', 'delivered').status).toBe('delivered')
    expect(mapRequestStatus('Closed', 'delivered').delivered).toBe(true)
    expect(mapRequestStatus('Closed', 'archived').status).toBe('archived')
    expect(mapRequestStatus('Closed', 'archived').delivered).toBe(false)
  })

  it('flags an unrecognised status rather than inventing one', () => {
    const mapped = mapRequestStatus('Something New')
    expect(mapped.status).toBe('submitted')
    expect(mapped.needsRuling).toBe(true)
    expect(mapped.note).toContain('Unrecognised')
  })

  it('only ever produces a status D1 can render and a PATCH would accept', () => {
    const sources = [
      'Submitted', 'In progress', 'Awaiting Approval', 'Pending response',
      'On hold', 'Queued', 'Completed', 'Closed', null, undefined, 42,
    ]
    for (const source of sources) {
      for (const ruling of ['cancelled', 'delivered', 'archived'] as const) {
        const { status } = mapRequestStatus(source, ruling)
        expect(Object.keys(REQUEST_STATUS_CONFIG)).toContain(status)
        expect(PATCHABLE_STATUSES).toContain(status)
      }
    }
  })
})

describe('request priority', () => {
  it('collapses to the two-value D1 vocabulary', () => {
    expect(mapRequestPriority('high')).toBe('high')
    expect(mapRequestPriority('medium')).toBe('standard')
    // D1 has no 'low'. Introducing one would give a request a priority no
    // picker offers; the source value survives in formResponses instead.
    expect(mapRequestPriority('low')).toBe('standard')
    expect(mapRequestPriority(null)).toBe('standard')
    expect(mapRequestPriority(undefined)).toBe('standard')
  })

  it('never leaves the writable priority vocabulary', () => {
    for (const source of ['high', 'medium', 'low', null, '', 'URGENT']) {
      expect(REQUEST_PRIORITIES).toContain(mapRequestPriority(source))
    }
  })
})

describe('organisation status', () => {
  it('maps every ManyRequests subscription status', () => {
    expect(mapOrgStatus('subscribed')).toBe('active')
    expect(mapOrgStatus('expiring')).toBe('active')
    // paused survives as paused: D1 has a real paused state with its own chip.
    expect(mapOrgStatus('paused')).toBe('paused')
    expect(mapOrgStatus('unsubscribed')).toBe('churned')
    expect(mapOrgStatus(null)).toBe('active')
  })
})

describe('invoice status', () => {
  it('maps every ManyRequests invoice status', () => {
    expect(mapInvoiceStatus('draft')).toBe('draft')
    expect(mapInvoiceStatus('pending')).toBe('sent')
    expect(mapInvoiceStatus('in progress')).toBe('sent')
    expect(mapInvoiceStatus('paid')).toBe('paid')
    expect(mapInvoiceStatus('refunded')).toBe('written_off')
    expect(mapInvoiceStatus('failed')).toBe('written_off')
    expect(mapInvoiceStatus(null)).toBe('draft')
  })
})

describe('invoice money and paidAt', () => {
  it('keeps the native currency in the columns named usd, which is what D1 already does', () => {
    const money = mapInvoiceMoney({
      number: 'INV-2025000024',
      amount: 1279.67,
      subtotal: 1150,
      taxes_amount: 0,
      discount: 0,
      currency: 'gbp',
    })
    expect(money.currency).toBe('GBP')
    expect(money.totalUsd).toBe(1279.67)
    expect(money.amountUsd).toBe(1150)
  })

  it('falls back to the total when no subtotal is sent', () => {
    const money = mapInvoiceMoney({ number: 'INV-1', amount: 500, currency: 'EUR' })
    expect(money.amountUsd).toBe(500)
    expect(money.totalUsd).toBe(500)
  })

  it('only stamps paidAt on a paid invoice', () => {
    const invoice = { number: 'INV-1', paid_at: '2026-01-02T03:04:05Z', created_at: '2025-12-01T00:00:00Z' }
    expect(mapInvoicePaidAt(invoice, 'paid')).toBe('2026-01-02T03:04:05.000Z')
    expect(mapInvoicePaidAt(invoice, 'sent')).toBeNull()
    expect(mapInvoicePaidAt(invoice, 'draft')).toBeNull()
  })

  it('falls back to created_at when a paid invoice carries no paid_at', () => {
    expect(mapInvoicePaidAt({ number: 'INV-1', created_at: '2025-12-01T00:00:00Z' }, 'paid'))
      .toBe('2025-12-01T00:00:00.000Z')
  })
})

describe('subscription vocabularies', () => {
  it('maps status and billing period', () => {
    expect(mapSubscriptionStatus('active')).toBe('active')
    expect(mapSubscriptionStatus('canceled')).toBe('cancelled')
    expect(mapSubscriptionStatus('cancelled')).toBe('cancelled')
    expect(mapBillingInterval('Monthly')).toBe('monthly')
    expect(mapBillingInterval('Quarterly')).toBe('quarterly')
    expect(mapBillingInterval('Annually')).toBe('annual')
    expect(mapBillingInterval(null)).toBe('monthly')
  })

  it('guesses a plan type from the service name and keeps the name for review', () => {
    expect(mapPlanType('Glasswall Custom Retainer')).toBe('hourly')
    expect(mapPlanType('Elevate custom hourly')).toBe('hourly')
    expect(mapPlanType('Growth Design & Dev')).toBe('scale')
    expect(mapPlanType('Total Webflow Plan')).toBe('scale')
    expect(mapPlanType('Webflow Development')).toBe('maintain')
    expect(mapPlanType(null)).toBe('none')
  })

  it('builds a stable composite key, because no subscription id is exposed', () => {
    const key = subscriptionKey('3', 'Glasswall Custom Retainer', '2025-01-01T00:00:00.000Z')
    expect(key).toBe('mr:subscription:3:glasswall-custom-retainer:2025-01-01T00:00:00.000Z')
    expect(subscriptionKey('3', 'Glasswall Custom Retainer', '2025-01-01T00:00:00.000Z')).toBe(key)
  })
})

describe('html entities', () => {
  it('undoes what the API escapes', () => {
    expect(unescapeHtmlEntities('That&#039;s the brief')).toBe("That's the brief")
    expect(unescapeHtmlEntities('&quot;quoted&quot;')).toBe('"quoted"')
    expect(unescapeHtmlEntities('a &lt; b &amp;&amp; c &gt; d')).toBe('a < b && c > d')
  })

  it('decodes &amp; last so a double-escaped tag stays literal', () => {
    expect(unescapeHtmlEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;')
  })
})

describe('comment key and author', () => {
  it('keys on request, timestamp and author', () => {
    const key = commentKey('347', { author: 'Nathan Day', created_at: '2026-01-01T00:00:00Z', content: 'hi' })
    expect(key).toBe('mr:comment:347:2026-01-01T00:00:00.000Z:nathan-day')
  })

  it('refuses a comment with no timestamp or no author, so nothing lands unkeyed', () => {
    expect(commentKey('347', { author: 'Nathan Day', content: 'hi' })).toBeNull()
    expect(commentKey('347', { created_at: '2026-01-01T00:00:00Z', content: 'hi' })).toBeNull()
  })

  it('resolves team first, then this org\'s contacts, then any contact', () => {
    const index = {
      teamIdByName: new Map([['nathan day', 'tm_nathan']]),
      contactIdByOrgAndName: new Map([['org_a::ella wilde', 'c_ella_a']]),
      contactIdByName: new Map([['ella wilde', 'c_ella_b'], ['jo yarnall', 'c_jo']]),
    }
    expect(resolveCommentAuthor('Nathan Day', index, 'org_a')).toEqual({ authorId: 'tm_nathan', authorType: 'team_member' })
    expect(resolveCommentAuthor('Ella Wilde', index, 'org_a')).toEqual({ authorId: 'c_ella_a', authorType: 'contact' })
    expect(resolveCommentAuthor('Jo Yarnall', index, 'org_a')).toEqual({ authorId: 'c_jo', authorType: 'contact' })
  })

  it('returns null rather than guessing, so a thread never gets the wrong side', () => {
    const index = {
      teamIdByName: new Map<string, string>(),
      contactIdByOrgAndName: new Map<string, string>(),
      contactIdByName: new Map<string, string>(),
    }
    expect(resolveCommentAuthor('Someone Unknown', index, 'org_a')).toBeNull()
    expect(resolveCommentAuthor(null, index, 'org_a')).toBeNull()
  })
})

describe('request brief', () => {
  const base: MrRequest = { id: 347, title: 'Custom Redirects' }

  it('reads the labelled textarea, not the almost-always-null description', () => {
    const request: MrRequest = {
      ...base,
      description: null,
      fields: [
        { label: 'Page URL', type: 'url', value: 'https://example.com' },
        { label: 'Description and supporting links/information', type: 'textarea', value: 'Add a redirect from &#039;/old&#039; to /new' },
      ],
    }
    expect(extractRequestBrief(request)).toBe("Add a redirect from '/old' to /new")
  })

  it('falls back to any textarea, then to description', () => {
    expect(extractRequestBrief({ ...base, fields: [{ label: 'Notes', type: 'textarea', value: 'some notes' }] }))
      .toBe('some notes')
    expect(extractRequestBrief({ ...base, description: 'plain description' })).toBe('plain description')
    expect(extractRequestBrief(base)).toBeNull()
  })

  it('writes the whole fields array plus the source-only values into formResponses', () => {
    const request: MrRequest = {
      ...base,
      number: 347,
      status: 'Submitted',
      priority: 'low',
      assignees: ['Liam Miller', 'Nathan Day'],
      hours: { tracked_hours: 4.5 },
      comments_total: 12,
      fields: [{ label: 'Page URL', value: 'https://example.com' }],
    }
    const parsed = JSON.parse(buildFormResponses(request, { extraAssignees: ['Nathan Day'] })) as {
      _manyrequests: Record<string, unknown>
    }
    expect(parsed._manyrequests.id).toBe('347')
    // The 'low' priority D1 cannot store is still recorded.
    expect(parsed._manyrequests.priority).toBe('low')
    expect(parsed._manyrequests.trackedHours).toBe(4.5)
    expect(parsed._manyrequests.commentsTotal).toBe(12)
    expect(parsed._manyrequests.assignees).toEqual(['Liam Miller', 'Nathan Day'])
    expect(parsed._manyrequests.unassignedExtraAssignees).toEqual(['Nathan Day'])
    expect(parsed._manyrequests.fields).toHaveLength(1)
  })
})

describe('primitives', () => {
  it('normalises currencies, timestamps and dates, and drops what it cannot parse', () => {
    expect(normaliseCurrency('gbp')).toBe('GBP')
    expect(normaliseCurrency('not a code')).toBe('USD')
    expect(normaliseTimestamp('2026-01-02')).toBe('2026-01-02T00:00:00.000Z')
    expect(normaliseTimestamp('nonsense')).toBeNull()
    expect(normaliseDate('2026-01-02T10:00:00Z')).toBe('2026-01-02')
    expect(normaliseDate(null)).toBeNull()
  })

  it('keys invoice line items positionally', () => {
    expect(invoiceItemKey('INV-2025000024', 0)).toBe('INV-2025000024#0')
    expect(invoiceItemKey('INV-2025000024', 1)).toBe('INV-2025000024#1')
  })
})
