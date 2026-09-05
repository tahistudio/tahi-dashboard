/**
 * The two pure view models behind the client money surfaces.
 *
 * Both are worth pinning because both encode a decision a reader cannot see
 * from the call site: which invoice states a client is allowed to be told
 * about, and what the studio's one free-text service field is allowed to
 * become on a card.
 */
import { describe, it, expect } from 'vitest'
import {
  daysUntilDue,
  formatCurrencyTotals,
  formatPortalDate,
  formatPortalDateLong,
  isPortalInvoiceOpen,
  portalDueLabel,
  portalInvoiceLabel,
  portalInvoiceState,
  sumByCurrency,
  yearOf,
} from '@/lib/portal-invoice-view'
import {
  deliveryFilters,
  parseServiceDescription,
  serviceDelivery,
  toServiceCard,
} from '@/lib/portal-service-view'

const NOW = new Date(2026, 8, 6) // 6 September 2026, local

describe('portalInvoiceState', () => {
  it('is paid for every settled shape, including written off', () => {
    expect(portalInvoiceState({ status: 'paid', dueDate: '2026-01-01' }, NOW)).toBe('paid')
    expect(portalInvoiceState({ status: 'written_off', dueDate: '2026-01-01' }, NOW)).toBe('paid')
    expect(portalInvoiceState({ status: 'sent', dueDate: '2026-01-01', paidAt: '2026-02-02' }, NOW))
      .toBe('paid')
  })

  it('derives overdue for ANY unpaid invoice, not only a stored "sent"', () => {
    // The trap the shared admin list still carries: a viewed invoice past its
    // due date badges as Viewed forever.
    expect(portalInvoiceState({ status: 'viewed', dueDate: '2026-08-31' }, NOW)).toBe('overdue')
    expect(portalInvoiceState({ status: 'sent', dueDate: '2026-08-31' }, NOW)).toBe('overdue')
  })

  it('is awaiting payment on the due day itself', () => {
    expect(portalInvoiceState({ status: 'sent', dueDate: '2026-09-06' }, NOW)).toBe('awaiting')
  })

  it('is awaiting payment when there is no due date at all', () => {
    expect(portalInvoiceState({ status: 'sent', dueDate: null }, NOW)).toBe('awaiting')
  })
})

describe('isPortalInvoiceOpen', () => {
  it('counts only what the client still owes', () => {
    expect(isPortalInvoiceOpen({ status: 'sent', dueDate: '2026-09-30' })).toBe(true)
    expect(isPortalInvoiceOpen({ status: 'paid', dueDate: '2026-09-30' })).toBe(false)
    expect(isPortalInvoiceOpen({ status: 'written_off', dueDate: '2026-09-30' })).toBe(false)
  })
})

describe('portalDueLabel', () => {
  it('speaks in days near the date and in a date far from it', () => {
    expect(portalDueLabel({ status: 'sent', dueDate: '2026-09-06' }, NOW)).toBe('Due today')
    expect(portalDueLabel({ status: 'sent', dueDate: '2026-09-07' }, NOW)).toBe('Due tomorrow')
    expect(portalDueLabel({ status: 'sent', dueDate: '2026-09-12' }, NOW)).toBe('Due in 6 days')
    expect(portalDueLabel({ status: 'sent', dueDate: '2026-10-30' }, NOW)).toBe('Due 30 Oct 2026')
  })

  it('counts lateness in whole days and gets the singular right', () => {
    expect(portalDueLabel({ status: 'sent', dueDate: '2026-09-05' }, NOW)).toBe('1 day overdue')
    expect(portalDueLabel({ status: 'sent', dueDate: '2026-08-31' }, NOW)).toBe('6 days overdue')
  })

  it('says when a settled invoice was paid', () => {
    expect(portalDueLabel({ status: 'paid', dueDate: '2026-07-28', paidAt: '2026-07-22' }, NOW))
      .toBe('Paid 22 Jul 2026')
  })
})

describe('daysUntilDue', () => {
  it('ignores the time of day on both sides', () => {
    expect(daysUntilDue('2026-09-06', NOW)).toBe(0)
    expect(daysUntilDue('2026-09-06T23:59:59', NOW)).toBe(0)
    expect(daysUntilDue('2026-09-08', NOW)).toBe(2)
  })
})

describe('sumByCurrency', () => {
  it('never adds two currencies into one number', () => {
    const totals = sumByCurrency([
      { totalAmount: 2300, currency: 'NZD' },
      { totalAmount: 2185, currency: 'NZD' },
      { totalAmount: 500, currency: 'USD' },
    ])
    expect(totals).toEqual([
      { currency: 'NZD', total: 4485 },
      { currency: 'USD', total: 500 },
    ])
    expect(formatCurrencyTotals(totals)).toBe('NZ$4,485.00 + US$500.00')
  })

  it('defaults a missing currency to NZD rather than dropping the money', () => {
    expect(sumByCurrency([{ totalAmount: 100, currency: null }]))
      .toEqual([{ currency: 'NZD', total: 100 }])
  })

  it('reads as a zero rather than an empty string when nothing is owed', () => {
    expect(formatCurrencyTotals([])).toBe('NZ$0.00')
  })
})

describe('dates and labels', () => {
  it('formats without a locale call', () => {
    expect(formatPortalDate('2026-09-04')).toBe('4 Sep 2026')
    expect(formatPortalDateLong('2026-09-04T10:00:00.000Z')).toBe('4 September 2026')
    expect(formatPortalDate(null)).toBe('Not set')
  })

  it('names an invoice by the month it covers', () => {
    expect(portalInvoiceLabel({ dueDate: '2026-09-30' })).toBe('September invoice')
    expect(portalInvoiceLabel({ dueDate: null, sentAt: null, createdAt: '2026-02-02' }))
      .toBe('February invoice')
    expect(portalInvoiceLabel({ dueDate: null })).toBe('Invoice')
  })

  it('reads a year only from something that looks like one', () => {
    expect(yearOf('2026-09-04')).toBe('2026')
    expect(yearOf(null)).toBeNull()
    expect(yearOf('nope')).toBeNull()
  })
})

describe('parseServiceDescription', () => {
  it('splits a written-up description into outcome, inclusions and timeline', () => {
    const parsed = parseServiceDescription([
      'A site that sells the orchard as well as your fruit does.',
      '- Sitemap, content plan and a working prototype',
      '* Design in your brand, drawn at every screen size',
      '• Webflow build with a CMS your team can run',
      'Timeline: 6 to 10 weeks',
    ].join('\n'))

    expect(parsed.outcome).toBe('A site that sells the orchard as well as your fruit does.')
    expect(parsed.includes).toEqual([
      'Sitemap, content plan and a working prototype',
      'Design in your brand, drawn at every screen size',
      'Webflow build with a CMS your team can run',
    ])
    expect(parsed.timeline).toBe('6 to 10 weeks')
  })

  it('degrades an ordinary paragraph to an outcome and nothing else', () => {
    const parsed = parseServiceDescription('Monthly performance and SEO care.')
    expect(parsed).toEqual({
      outcome: 'Monthly performance and SEO care.',
      includes: [],
      timeline: null,
    })
  })

  it('invents nothing from an empty description', () => {
    expect(parseServiceDescription(null)).toEqual({ outcome: '', includes: [], timeline: null })
  })
})

describe('serviceDelivery', () => {
  it('reads the studio category first, then whether it recurs', () => {
    expect(serviceDelivery({ id: '1', name: 'a', category: 'addon' })).toBe('addon')
    expect(serviceDelivery({ id: '2', name: 'b', category: 'topup' })).toBe('topup')
    expect(serviceDelivery({ id: '3', name: 'c', category: 'service', isRecurring: 1 })).toBe('ongoing')
    expect(serviceDelivery({ id: '4', name: 'd', category: 'service', isRecurring: 0 })).toBe('project')
    expect(serviceDelivery({ id: '5', name: 'e' })).toBe('project')
  })
})

describe('toServiceCard and deliveryFilters', () => {
  it('never carries a price onto a catalogue card', () => {
    const card = toServiceCard({
      id: 's1',
      name: 'Website design and build',
      description: 'A site that sells.\n- Sitemap\nTimeline: 6 to 10 weeks',
      category: 'service',
      isRecurring: 0,
    })
    expect(Object.keys(card).sort()).toEqual(
      ['delivery', 'id', 'includes', 'name', 'outcome', 'timeline'].sort(),
    )
  })

  it('offers only the groups the catalogue actually holds', () => {
    const cards = [
      toServiceCard({ id: '1', name: 'a', category: 'service', isRecurring: 0 }),
      toServiceCard({ id: '2', name: 'b', category: 'addon' }),
    ]
    expect(deliveryFilters(cards)).toEqual([
      { value: 'addon', label: 'Add on' },
      { value: 'project', label: 'Project' },
    ])
  })
})
