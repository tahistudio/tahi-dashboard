import { describe, it, expect } from 'vitest'
import {
  formatRequestOrgContext,
  formatClientHistory,
  CLIENT_HISTORY_PROMPT_RULES,
  type ClientHistoryStats,
} from '@/lib/ai-request-org-context'

/** A fully-populated stats object, so each test only overrides what it cares
 *  about rather than restating every field. */
function baseHistory(overrides: Partial<ClientHistoryStats> = {}): ClientHistoryStats {
  return {
    totalRequests: 0,
    firstRequestDate: null,
    lastRequestDate: null,
    categoryCountsAllTime: {},
    categoryCountsRecent: {},
    sizeCountsAllTime: {},
    sizeCountsRecent: {},
    allCategories: ['design', 'development', 'content', 'strategy', 'admin', 'bug'],
    openStatusCounts: {},
    planType: null,
    tracksLabel: null,
    hasCustomRate: false,
    hoursLast90Days: null,
    ...overrides,
  }
}

describe('formatRequestOrgContext', () => {
  it('returns nothing for a brand-new org with no history', () => {
    expect(formatRequestOrgContext({ org: null, brands: [], recentRequests: [] })).toBe('')
  })

  it('names the org, its industry and website', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: 'Hardware retail', website: 'acme.co.nz' },
      brands: [],
      recentRequests: [],
    })
    expect(text).toContain('Name: Acme Hardware')
    expect(text).toContain('Industry: Hardware retail')
    expect(text).toContain('Website: acme.co.nz')
  })

  it('lists recent requests with their category so the model never re-asks about them', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [],
      recentRequests: [
        { title: 'Hardware service page redesign', category: 'design' },
        { title: 'Fix contact form', category: 'development' },
      ],
    })
    expect(text).toContain('Hardware service page redesign (design)')
    expect(text).toContain('Fix contact form (development)')
  })

  it('does not add the which-brand rule for a single brand', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [{ name: 'Acme Retail', website: 'acme-retail.com' }],
      recentRequests: [],
    })
    expect(text).toContain('Brands on file: Acme Retail (acme-retail.com)')
    expect(text).not.toContain('Ask which one')
  })

  it('triggers the which-brand rule once more than one brand is on file', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Group', industry: null, website: null },
      brands: [
        { name: 'Acme Retail', website: 'acme-retail.com' },
        { name: 'Acme Wholesale', website: 'acme-wholesale.com' },
      ],
      recentRequests: [],
    })
    expect(text).toContain('Brands on file: Acme Retail (acme-retail.com), Acme Wholesale (acme-wholesale.com)')
    expect(text).toContain('Ask which one this request is for before drafting')
  })

  it('never uses an em or en dash', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Group', industry: 'Hardware', website: 'acme.co.nz' },
      brands: [
        { name: 'Acme Retail', website: null },
        { name: 'Acme Wholesale', website: null },
      ],
      recentRequests: [{ title: 'Something', category: 'design' }],
    })
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(text.includes(String.fromCharCode(0x2013))).toBe(false)
  })

  it('appends the CLIENT HISTORY block when history is supplied', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [],
      recentRequests: [],
      history: baseHistory({ totalRequests: 3, planType: 'maintain' }),
    })
    expect(text).toContain('CLIENT ON FILE')
    expect(text).toContain('CLIENT HISTORY')
    expect(text).toContain('Total requests: 3')
  })

  it('does not append a history block when none is supplied', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [],
      recentRequests: [],
    })
    expect(text).not.toContain('CLIENT HISTORY')
  })
})

describe('formatClientHistory', () => {
  it('handles an org with no requests on file yet', () => {
    const text = formatClientHistory(baseHistory())
    expect(text).toContain('No requests on file yet.')
    // A brand-new org has touched none of the studio's categories, so every
    // one of them is a coverage gap worth naming.
    expect(text).toContain('Never requested: design, development, content, strategy, admin, bug')
    expect(text).not.toContain('Open now')
    expect(text).not.toContain('Hours logged')
    expect(text).toContain('Plan: none on file, list rate')
  })

  it('summarises a busy, long-tenured client', () => {
    const stats = baseHistory({
      totalRequests: 24,
      firstRequestDate: '2024-01-15',
      lastRequestDate: '2026-09-01',
      categoryCountsAllTime: { design: 10, development: 8, content: 4, bug: 2 },
      categoryCountsRecent: { design: 3, development: 2 },
      sizeCountsAllTime: { small: 16, large: 8 },
      sizeCountsRecent: { small: 4, large: 1 },
      openStatusCounts: { in_progress: 2, client_review: 1 },
      planType: 'scale',
      tracksLabel: '1 small track + 2 large tracks',
      hasCustomRate: true,
      hoursLast90Days: 18.5,
    })
    const text = formatClientHistory(stats)

    expect(text).toContain('Total requests: 24 (2024-01-15 to 2026-09-01)')
    expect(text).toContain('By category, all time: design 10, development 8, content 4, bug 2')
    expect(text).toContain('last 12 months: design 3, development 2')
    expect(text).toContain('By size, all time: small 16, large 8')
    expect(text).toContain('last 12 months: small 4, large 1')
    expect(text).toContain('Open now: in_progress 2, client_review 1')
    expect(text).toContain('Plan: scale, 1 small track + 2 large tracks, negotiated rate on file')
    expect(text).toContain('Hours logged, last 90 days: 18.5')
    expect(text.length).toBeLessThan(1200)
  })

  it('names only the categories never requested, not the ones already covered', () => {
    const stats = baseHistory({
      totalRequests: 5,
      categoryCountsAllTime: { design: 5 },
    })
    const text = formatClientHistory(stats)
    expect(text).toContain('Never requested: development, content, strategy, admin, bug')
    expect(text).not.toContain('design,')
  })

  it('says nothing about coverage gaps once every category has been requested', () => {
    const stats = baseHistory({
      totalRequests: 6,
      categoryCountsAllTime: { design: 1, development: 1, content: 1, strategy: 1, admin: 1, bug: 1 },
    })
    expect(formatClientHistory(stats)).not.toContain('Never requested')
  })

  it('truncates a long category breakdown with a marked count of what was cut', () => {
    const manyCategories: Record<string, number> = {
      c1: 9, c2: 8, c3: 7, c4: 6, c5: 5, c6: 4, c7: 3, c8: 2, c9: 1,
    }
    const text = formatClientHistory(baseHistory({
      totalRequests: 45,
      categoryCountsAllTime: manyCategories,
    }))
    // Highest counts survive, in order, capped at 6, with the rest marked.
    expect(text).toContain('By category, all time: c1 9, c2 8, c3 7, c4 6, c5 5, c6 4 (+3 more)')
  })

  it('truncates a long never-requested list the same way', () => {
    const stats = baseHistory({
      totalRequests: 1,
      categoryCountsAllTime: { design: 1 },
      allCategories: ['design', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })
    const text = formatClientHistory(stats)
    expect(text).toContain('Never requested: a, b, c, d, e, f (+1 more)')
  })

  it('never uses an em or en dash', () => {
    const text = formatClientHistory(baseHistory({
      totalRequests: 12,
      firstRequestDate: '2024-01-01',
      lastRequestDate: '2026-01-01',
      categoryCountsAllTime: { design: 6, development: 6 },
      openStatusCounts: { submitted: 1 },
      planType: 'scale',
      tracksLabel: '1 small track + 1 large track',
      hasCustomRate: true,
      hoursLast90Days: 4,
    }))
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(text.includes(String.fromCharCode(0x2013))).toBe(false)
  })
})

describe('CLIENT_HISTORY_PROMPT_RULES', () => {
  it('tells the model to treat CLIENT HISTORY as already known', () => {
    expect(CLIENT_HISTORY_PROMPT_RULES).toContain('CLIENT HISTORY')
    expect(CLIENT_HISTORY_PROMPT_RULES).toContain('already known')
  })

  it('tells the model to answer coverage-gap questions briefly, then keep drafting', () => {
    expect(CLIENT_HISTORY_PROMPT_RULES).toContain('coverage gaps')
    expect(CLIENT_HISTORY_PROMPT_RULES).toContain('two sentences')
    expect(CLIENT_HISTORY_PROMPT_RULES).toContain('continue scoping the request')
  })

  it('never uses an em or en dash', () => {
    expect(CLIENT_HISTORY_PROMPT_RULES.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(CLIENT_HISTORY_PROMPT_RULES.includes(String.fromCharCode(0x2013))).toBe(false)
  })
})
