import { describe, it, expect, vi } from 'vitest'
import { schema } from '@/db/d1'
import {
  formatRequestOrgContext,
  formatClientHistory,
  formatCallAgreements,
  selectCallAgreements,
  loadCallAgreements,
  loadRequestOrgContext,
  CLIENT_HISTORY_PROMPT_RULES,
  CALL_AGREEMENT_LIMIT,
  CALL_BLOCK_MAX_CHARS,
  type CallAgreement,
  type CallAgreementRow,
  type ClientHistoryStats,
} from '@/lib/ai-request-org-context'

const EM_DASH = String.fromCharCode(0x2014)
const EN_DASH = String.fromCharCode(0x2013)

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

  it('tells the model to name a FROM RECENT CALLS match by number rather than draft it again (CN.3)', () => {
    expect(CLIENT_HISTORY_PROMPT_RULES).toContain(
      '- If FROM RECENT CALLS lists something that matches what is being asked, it was already agreed on a call and filed: name it by its number and do not draft it again. If the ask adds to it, draft only the addition.',
    )
  })
})

// ── FROM RECENT CALLS (CN.3) ─────────────────────────────────────────────────

/** An applied create_request for request #231 at Acme, joined to a live,
 *  client-visible request and a transcript. Each test overrides only what it
 *  is about. */
function requestRow(overrides: Partial<CallAgreementRow> = {}): CallAgreementRow {
  return {
    orgId: 'org-acme',
    kind: 'create_request',
    status: 'applied',
    appliedAt: '2026-09-18T10:00:00Z',
    appliedTaskId: null,
    appliedRequestId: 'req-231',
    quote: 'Can we get the LinkedIn tag into the footer this week?',
    proposal: JSON.stringify({ title: 'Add LinkedIn to the footer' }),
    requestId: 'req-231',
    requestOrgId: 'org-acme',
    requestNumber: 231,
    requestTitle: 'Footer LinkedIn tag',
    requestIsInternal: false,
    requestStatus: 'in_progress',
    taskId: null,
    taskOrgId: null,
    taskTitle: null,
    callReceivedAt: '2026-09-18T02:30:00Z',
    ...overrides,
  }
}

/** An applied create_task at Acme, joined to a live task. */
function taskRow(overrides: Partial<CallAgreementRow> = {}): CallAgreementRow {
  return requestRow({
    kind: 'create_task',
    appliedRequestId: null,
    requestId: null,
    requestOrgId: null,
    requestNumber: null,
    requestTitle: null,
    requestIsInternal: null,
    requestStatus: null,
    appliedTaskId: 'task-1',
    taskId: 'task-1',
    taskOrgId: 'org-acme',
    taskTitle: 'Send Tim the footer copy',
    proposal: JSON.stringify({ title: 'Footer copy for Tim' }),
    quote: 'Liam will send the footer copy over.',
    ...overrides,
  })
}

/** A distinct live request per index, applied a day apart, newest last. */
function numberedRequestRow(i: number): CallAgreementRow {
  const day = String(i + 1).padStart(2, '0')
  return requestRow({
    appliedRequestId: `req-${i}`,
    requestId: `req-${i}`,
    requestNumber: 200 + i,
    requestTitle: `Request ${i}`,
    appliedAt: `2026-08-${day}T09:00:00Z`,
  })
}

describe('selectCallAgreements, client audience', () => {
  it('drops the task kinds and request_note, keeping only the three client kinds', () => {
    const rows = [
      taskRow(),
      taskRow({ kind: 'complete_task', appliedTaskId: 'task-2', taskId: 'task-2' }),
      taskRow({ kind: 'note', appliedTaskId: 'task-3', taskId: 'task-3' }),
      requestRow({ kind: 'request_note', appliedRequestId: 'req-9', requestId: 'req-9', requestNumber: 9, requestTitle: 'Internal thread line' }),
      requestRow(),
      requestRow({ kind: 'update_request', appliedRequestId: 'req-232', requestId: 'req-232', requestNumber: 232, requestTitle: 'Hero video' }),
      requestRow({ kind: 'hand_off_request', appliedRequestId: 'req-233', requestId: 'req-233', requestNumber: 233, requestTitle: 'Brand fonts' }),
    ]
    const picked = selectCallAgreements(rows, 'org-acme', 'client')
    expect(picked.map(p => p.kind).sort()).toEqual(['create_request', 'hand_off_request', 'update_request'])
    expect(picked.some(p => p.title === 'Send Tim the footer copy')).toBe(false)
    expect(picked.some(p => p.title === 'Internal thread line')).toBe(false)
  })

  it('drops an internal request', () => {
    expect(selectCallAgreements([requestRow({ requestIsInternal: true })], 'org-acme', 'client')).toEqual([])
  })

  it('drops a request whose visibility is unknown, exactly as the portal list does', () => {
    expect(selectCallAgreements([requestRow({ requestIsInternal: null })], 'org-acme', 'client')).toEqual([])
  })

  it('drops an archived request', () => {
    expect(selectCallAgreements([requestRow({ requestStatus: 'archived' })], 'org-acme', 'client')).toEqual([])
  })

  it('drops a request that belongs to another org', () => {
    expect(selectCallAgreements([requestRow({ requestOrgId: 'org-other' })], 'org-acme', 'client')).toEqual([])
  })

  it('drops a request that no longer exists', () => {
    const gone = requestRow({ requestId: null, requestOrgId: null, requestTitle: null, requestNumber: null, requestIsInternal: null, requestStatus: null })
    expect(selectCallAgreements([gone], 'org-acme', 'client')).toEqual([])
  })

  it('drops rows of another org even when they are handed to it', () => {
    const rows = [
      requestRow({ orgId: 'org-other', requestOrgId: 'org-other' }),
      requestRow({ orgId: 'org-other' }),
      requestRow({ orgId: null }),
    ]
    expect(selectCallAgreements(rows, 'org-acme', 'client')).toEqual([])
    expect(selectCallAgreements(rows, 'org-acme', 'studio')).toEqual([])
  })

  it('drops rows that are not applied', () => {
    const rows = ['pending', 'snoozed', 'rejected', 'expired', 'failed'].map(status => requestRow({ status }))
    expect(selectCallAgreements(rows, 'org-acme', 'client')).toEqual([])
    expect(selectCallAgreements(rows, 'org-acme', 'studio')).toEqual([])
  })

  it("uses the request's current title, not the proposal's", () => {
    const [item] = selectCallAgreements([requestRow({ requestTitle: 'Footer LinkedIn tag (renamed)' })], 'org-acme', 'client')
    expect(item.title).toBe('Footer LinkedIn tag (renamed)')
    expect(item.title).not.toContain('Add LinkedIn to the footer')
  })

  it('never carries a quote', () => {
    const rows = [
      requestRow(),
      requestRow({ kind: 'update_request', appliedRequestId: 'req-232', requestId: 'req-232', requestNumber: 232 }),
      requestRow({ kind: 'hand_off_request', appliedRequestId: 'req-233', requestId: 'req-233', requestNumber: 233 }),
    ]
    const picked = selectCallAgreements(rows, 'org-acme', 'client')
    expect(picked).toHaveLength(3)
    for (const item of picked) expect(item.quote).toBeNull()
  })

  it('carries the number, the call date and the applied date', () => {
    expect(selectCallAgreements([requestRow()], 'org-acme', 'client')).toEqual([
      { kind: 'create_request', requestNumber: 231, title: 'Footer LinkedIn tag', callDate: '2026-09-18', appliedOn: '2026-09-18', quote: null },
    ])
  })

  it('leaves the call date null when the row has no transcript', () => {
    const [item] = selectCallAgreements([requestRow({ callReceivedAt: null })], 'org-acme', 'client')
    expect(item.callDate).toBeNull()
  })
})

describe('selectCallAgreements, studio audience', () => {
  it('keeps the task kinds, titled from the task', () => {
    const rows = [
      taskRow(),
      taskRow({ kind: 'update_task', appliedTaskId: 'task-2', taskId: 'task-2', taskTitle: 'Chase the logo files', appliedAt: '2026-09-17T10:00:00Z' }),
    ]
    const picked = selectCallAgreements(rows, 'org-acme', 'studio')
    expect(picked.map(p => [p.kind, p.title, p.requestNumber])).toEqual([
      ['create_task', 'Send Tim the footer copy', null],
      ['update_task', 'Chase the logo files', null],
    ])
  })

  it('keeps request_note, titled from the request', () => {
    const [item] = selectCallAgreements([requestRow({ kind: 'request_note' })], 'org-acme', 'studio')
    expect(item).toMatchObject({ kind: 'request_note', requestNumber: 231, title: 'Footer LinkedIn tag' })
  })

  it('keeps the quote, clipped to 120 characters', () => {
    const long = 'We said the footer needs the LinkedIn tag and the Instagram one as well, and then the newsletter form moves up above the fold on mobile.'
    expect(long.length).toBeGreaterThan(120)
    const [item] = selectCallAgreements([requestRow({ quote: long })], 'org-acme', 'studio')
    expect(item.quote).not.toBeNull()
    expect(item.quote!.length).toBeLessThanOrEqual(120)
    expect(item.quote!.endsWith('...')).toBe(true)
    expect(long.startsWith(item.quote!.slice(0, -3))).toBe(true)
  })

  it('keeps a short quote as it is, on one line', () => {
    const [item] = selectCallAgreements([requestRow({ quote: 'Footer tag,\n  this week.' })], 'org-acme', 'studio')
    expect(item.quote).toBe('Footer tag, this week.')
  })

  it('falls back to the proposal title, then to the kind, when the task is gone', () => {
    const gone = { taskId: null, taskOrgId: null, taskTitle: null }
    const [fromProposal] = selectCallAgreements([taskRow(gone)], 'org-acme', 'studio')
    expect(fromProposal.title).toBe('Footer copy for Tim')
    const [fromKind] = selectCallAgreements([taskRow({ ...gone, proposal: '{"fields":{}}' })], 'org-acme', 'studio')
    expect(fromKind.title).toBe('New task')
    const [unparseable] = selectCallAgreements([taskRow({ ...gone, kind: 'complete_task', proposal: 'not json' })], 'org-acme', 'studio')
    expect(unparseable.title).toBe('Marked done')
  })

  it('keeps an internal or archived request, which the studio can see', () => {
    const rows = [
      requestRow({ requestIsInternal: true }),
      requestRow({ appliedRequestId: 'req-232', requestId: 'req-232', requestNumber: 232, requestStatus: 'archived' }),
    ]
    expect(selectCallAgreements(rows, 'org-acme', 'studio')).toHaveLength(2)
  })

  it("drops a row whose request or task now belongs to another client", () => {
    const rows = [
      requestRow({ requestOrgId: 'org-other' }),
      taskRow({ taskOrgId: 'org-other' }),
    ]
    expect(selectCallAgreements(rows, 'org-acme', 'studio')).toEqual([])
  })

  it('keeps a studio task with no client', () => {
    expect(selectCallAgreements([taskRow({ taskOrgId: null })], 'org-acme', 'studio')).toHaveLength(1)
  })
})

describe('selectCallAgreements, both audiences', () => {
  for (const audience of ['client', 'studio'] as const) {
    it(`${audience}: newest first, whatever order the rows arrive in`, () => {
      const rows = [numberedRequestRow(2), numberedRequestRow(5), numberedRequestRow(1)]
      expect(selectCallAgreements(rows, 'org-acme', audience).map(p => p.requestNumber)).toEqual([205, 202, 201])
    })

    it(`${audience}: at most CALL_AGREEMENT_LIMIT, the newest ones`, () => {
      const rows = Array.from({ length: 12 }, (_, i) => numberedRequestRow(i))
      const picked = selectCallAgreements(rows, 'org-acme', audience)
      expect(CALL_AGREEMENT_LIMIT).toBe(8)
      expect(picked).toHaveLength(8)
      expect(picked.map(p => p.requestNumber)).toEqual([211, 210, 209, 208, 207, 206, 205, 204])
    })

    it(`${audience}: one item per request, the newest row winning`, () => {
      const rows = [
        requestRow({ appliedAt: '2026-09-01T10:00:00Z' }),
        requestRow({ kind: 'update_request', appliedAt: '2026-09-18T10:00:00Z' }),
        requestRow({ kind: 'hand_off_request', appliedAt: '2026-09-10T10:00:00Z' }),
      ]
      const picked = selectCallAgreements(rows, 'org-acme', audience)
      expect(picked).toHaveLength(1)
      expect(picked[0].kind).toBe('update_request')
    })
  }

  it('studio: one item per task, the newest row winning', () => {
    const rows = [
      taskRow({ appliedAt: '2026-09-01T10:00:00Z' }),
      taskRow({ kind: 'complete_task', appliedAt: '2026-09-18T10:00:00Z' }),
    ]
    const picked = selectCallAgreements(rows, 'org-acme', 'studio')
    expect(picked).toHaveLength(1)
    expect(picked[0].kind).toBe('complete_task')
  })

  it('client: a dropped newer row never hides an older visible one', () => {
    const rows = [
      requestRow({ appliedAt: '2026-09-01T10:00:00Z' }),
      requestRow({ kind: 'request_note', appliedAt: '2026-09-18T10:00:00Z' }),
    ]
    const picked = selectCallAgreements(rows, 'org-acme', 'client')
    expect(picked.map(p => p.kind)).toEqual(['create_request'])
  })
})

/** A hand-built agreement, for the formatter tests. */
function agreement(overrides: Partial<CallAgreement> = {}): CallAgreement {
  return {
    kind: 'create_request',
    requestNumber: 231,
    title: 'Footer LinkedIn tag',
    callDate: '2026-09-18',
    appliedOn: '2026-09-18',
    quote: null,
    ...overrides,
  }
}

describe('formatCallAgreements', () => {
  it('returns nothing when there is nothing to name', () => {
    expect(formatCallAgreements([], 'client')).toBe('')
    expect(formatCallAgreements([], 'studio')).toBe('')
  })

  it('writes the exact client lines', () => {
    const text = formatCallAgreements([
      agreement(),
      agreement({ kind: 'update_request', requestNumber: 232, title: 'Hero video' }),
      agreement({ kind: 'hand_off_request', requestNumber: 233, title: 'Brand fonts' }),
    ], 'client')
    expect(text).toBe([
      'FROM RECENT CALLS (agreed on a call with the studio and already filed; never draft these again):',
      '- #231 Footer LinkedIn tag, filed from the call on 2026-09-18',
      '- #232 Hero video, updated after the call on 2026-09-18',
      '- #233 Brand fonts, waiting on you since the call on 2026-09-18',
    ].join('\n'))
  })

  it('says "a call" on the client lines when there is no call date', () => {
    const text = formatCallAgreements([
      agreement({ callDate: null }),
      agreement({ kind: 'update_request', requestNumber: 232, title: 'Hero video', callDate: null }),
      agreement({ kind: 'hand_off_request', requestNumber: 233, title: 'Brand fonts', callDate: null }),
    ], 'client')
    expect(text).toContain('- #231 Footer LinkedIn tag, filed from a call')
    expect(text).toContain('- #232 Hero video, updated after a call')
    expect(text).toContain('- #233 Brand fonts, waiting on you since a call')
  })

  it('never prints a quote, a task or a request note to the client, even when handed one', () => {
    const text = formatCallAgreements([
      agreement({ quote: 'Tim said the budget is tight' }),
      agreement({ kind: 'create_task', requestNumber: null, title: 'Chase Tim for the logo' }),
      agreement({ kind: 'request_note', requestNumber: 234, title: 'Internal note' }),
    ], 'client')
    expect(text).toBe([
      'FROM RECENT CALLS (agreed on a call with the studio and already filed; never draft these again):',
      '- #231 Footer LinkedIn tag, filed from the call on 2026-09-18',
    ].join('\n'))
    expect(formatCallAgreements([agreement({ kind: 'create_task', requestNumber: null, title: 'Chase Tim' })], 'client')).toBe('')
  })

  it('writes the exact studio lines', () => {
    const text = formatCallAgreements([
      agreement({ quote: 'Can we get the LinkedIn tag into the footer?' }),
      agreement({ kind: 'create_task', requestNumber: null, title: 'Send Tim the footer copy', quote: 'Liam will send the copy.' }),
      agreement({ kind: 'complete_task', requestNumber: null, title: 'Chase the logo files', callDate: null }),
    ], 'studio')
    expect(text).toBe([
      'FROM RECENT CALLS (applied from call notes; already filed):',
      '- #231 Footer LinkedIn tag (new request, call 2026-09-18): "Can we get the LinkedIn tag into the footer?"',
      '- Task: Send Tim the footer copy (new task, call 2026-09-18): "Liam will send the copy."',
      '- Task: Chase the logo files (marked done)',
    ].join('\n'))
  })

  it('puts every kind into words on the studio lines', () => {
    const words: Array<[string, string]> = [
      ['create_request', 'new request'],
      ['update_request', 'request update'],
      ['hand_off_request', 'handed to the client'],
      ['request_note', 'note on the request'],
      ['create_task', 'new task'],
      ['update_task', 'task update'],
      ['complete_task', 'marked done'],
      ['add_subtasks', 'checklist added'],
      ['note', 'note on the task'],
    ]
    for (const [kind, phrase] of words) {
      const text = formatCallAgreements([agreement({ kind, callDate: null })], 'studio')
      expect(text).toContain(`(${phrase})`)
    }
  })

  it('caps the block at CALL_BLOCK_MAX_CHARS by dropping the oldest lines first', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      agreement({ requestNumber: 300 + i, title: `Newsletter template rebuild number ${i} with a long enough title to fill the budget` }),
    )
    for (const audience of ['client', 'studio'] as const) {
      const text = formatCallAgreements(items, audience)
      const lines = text.split('\n')
      expect(CALL_BLOCK_MAX_CHARS).toBe(1400)
      expect(text.length).toBeLessThanOrEqual(CALL_BLOCK_MAX_CHARS)
      expect(lines.length).toBeGreaterThan(2)
      expect(lines.length).toBeLessThan(31)
      // Newest first in, newest kept: the first item survives, the last goes.
      expect(text).toContain('#300 ')
      expect(text).not.toContain('#329 ')
      // What survives is a contiguous run from the newest.
      const kept = lines.length - 1
      expect(text).toContain(`#${300 + kept - 1} `)
      expect(text).not.toContain(`#${300 + kept} `)
    }
  })

  it('never uses an em or en dash, even when a title or quote carries one', () => {
    const items = [
      agreement({ title: `Footer ${EM_DASH} LinkedIn tag`, quote: `Tim ${EN_DASH} the footer${EM_DASH}this week` }),
      agreement({ kind: 'create_task', requestNumber: null, title: `Pages 2${EN_DASH}4 copy`, quote: `${EM_DASH} copy please` }),
    ]
    for (const audience of ['client', 'studio'] as const) {
      const text = formatCallAgreements(items, audience)
      expect(text.length).toBeGreaterThan(0)
      expect(text.includes(EM_DASH)).toBe(false)
      expect(text.includes(EN_DASH)).toBe(false)
    }
    const studio = formatCallAgreements(items, 'studio')
    expect(studio).toContain('#231 Footer, LinkedIn tag')
    expect(studio).toContain('Task: Pages 2-4 copy')
  })

  it('writes one line per item, however the title or quote was typed', () => {
    const text = formatCallAgreements([
      agreement({ title: 'Footer\nLinkedIn   tag', quote: 'line one\nline two' }),
      agreement({ kind: 'update_task', requestNumber: null, title: 'Task\r\ntitle' }),
    ], 'studio')
    expect(text.split('\n')).toHaveLength(3)
    expect(text).toContain('- #231 Footer LinkedIn tag (new request, call 2026-09-18): "line one line two"')
  })
})

describe('formatRequestOrgContext with FROM RECENT CALLS', () => {
  it('renders FROM RECENT CALLS after CLIENT HISTORY', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [],
      recentRequests: [],
      history: baseHistory({ totalRequests: 3 }),
      callAgreements: [agreement()],
    })
    const onFile = text.indexOf('CLIENT ON FILE')
    const history = text.indexOf('CLIENT HISTORY')
    const calls = text.indexOf('FROM RECENT CALLS')
    expect(onFile).toBeGreaterThanOrEqual(0)
    expect(history).toBeGreaterThan(onFile)
    expect(calls).toBeGreaterThan(history)
    expect(text).toContain('- #231 Footer LinkedIn tag, filed from the call on 2026-09-18')
  })

  it('still renders the block for an org with nothing else on file', () => {
    const text = formatRequestOrgContext({ org: null, brands: [], recentRequests: [], callAgreements: [agreement()] })
    expect(text.startsWith('FROM RECENT CALLS')).toBe(true)
    expect(text).not.toContain('CLIENT ON FILE')
  })

  it('renders nothing extra when there are no agreements', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [],
      recentRequests: [],
      callAgreements: [],
    })
    expect(text).not.toContain('FROM RECENT CALLS')
  })

  it('writes for the client unless told otherwise', () => {
    const items = [
      agreement({ quote: 'Tim said the budget is tight' }),
      agreement({ kind: 'create_task', requestNumber: null, title: 'Chase Tim for the logo' }),
    ]
    const byDefault = formatRequestOrgContext({ org: null, brands: [], recentRequests: [], callAgreements: items })
    expect(byDefault).not.toContain('budget is tight')
    expect(byDefault).not.toContain('Chase Tim')
    const studio = formatRequestOrgContext({ org: null, brands: [], recentRequests: [], callAgreements: items, audience: 'studio' })
    expect(studio).toContain('"Tim said the budget is tight"')
    expect(studio).toContain('Task: Chase Tim for the logo')
  })
})

// ── the loaders, against a table-keyed database double ──────────────────────

type LoaderDrizzle = Parameters<typeof loadRequestOrgContext>[0]

/**
 * A Drizzle stand-in that answers every select chain by the table named in
 * `.from()`. The call-agreements read (the only one on task_suggestions) can
 * be made to throw on `.from()` or to reject when awaited.
 */
function fakeDrizzle(options: {
  suggestions?: CallAgreementRow[]
  suggestionsFail?: 'throw' | 'reject'
} = {}) {
  const limits: number[] = []
  const orgRow = {
    name: 'Acme Hardware',
    industry: 'Hardware retail',
    website: 'acme.co.nz',
    planType: 'maintain',
    tracksMode: null,
    customSmallTracks: null,
    customLargeTracks: null,
  }
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.organisations) return [orgRow]
    if (table === schema.brands) return [{ name: 'Acme Retail', website: 'acme-retail.com' }]
    if (table === schema.requests) {
      return [{ title: 'Hero refresh', category: 'design', size: 'small', status: 'in_progress', createdAt: '2026-09-01T00:00:00Z' }]
    }
    if (table === schema.taskSuggestions) return options.suggestions ?? []
    return []
  }
  const select = vi.fn(() => {
    let table: unknown
    const chain: Record<string, unknown> = {}
    for (const method of ['where', 'orderBy', 'leftJoin', 'innerJoin']) chain[method] = vi.fn(() => chain)
    chain.limit = vi.fn((n: number) => {
      if (table === schema.taskSuggestions) limits.push(n)
      return chain
    })
    chain.from = vi.fn((t: unknown) => {
      table = t
      if (t === schema.taskSuggestions && options.suggestionsFail === 'throw') throw new Error('no such column: applied_request_id')
      return chain
    })
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (table === schema.taskSuggestions && options.suggestionsFail === 'reject') {
        return Promise.reject(new Error('D1_ERROR: timeout')).then(resolve, reject)
      }
      return Promise.resolve(rowsFor(table)).then(resolve, reject)
    }
    return chain
  })
  const all = vi.fn(async () => [{ custom_mrr: null }])
  return { drizzle: { select, all } as unknown as LoaderDrizzle, limits }
}

describe('loadCallAgreements', () => {
  it('returns [] when the database throws', async () => {
    const { drizzle } = fakeDrizzle({ suggestionsFail: 'throw' })
    await expect(loadCallAgreements(drizzle, 'org-acme', 'client')).resolves.toEqual([])
  })

  it('returns [] when the read rejects', async () => {
    const { drizzle } = fakeDrizzle({ suggestionsFail: 'reject' })
    await expect(loadCallAgreements(drizzle, 'org-acme', 'studio')).resolves.toEqual([])
  })

  it('scans at most 30 rows and applies the audience rules to what comes back', async () => {
    const { drizzle, limits } = fakeDrizzle({
      suggestions: [
        requestRow(),
        requestRow({ appliedRequestId: 'req-232', requestId: 'req-232', requestNumber: 232, requestIsInternal: true }),
        taskRow(),
        requestRow({ orgId: 'org-other', appliedRequestId: 'req-900', requestId: 'req-900', requestOrgId: 'org-other', requestNumber: 900 }),
      ],
    })
    const client = await loadCallAgreements(drizzle, 'org-acme', 'client', new Date('2026-09-26T00:00:00Z'))
    expect(limits).toEqual([30])
    expect(client.map(c => c.requestNumber)).toEqual([231])
    const studio = await loadCallAgreements(drizzle, 'org-acme', 'studio', new Date('2026-09-26T00:00:00Z'))
    expect(studio.map(c => c.title).sort()).toEqual(['Footer LinkedIn tag', 'Footer LinkedIn tag', 'Send Tim the footer copy'])
  })
})

describe('loadRequestOrgContext', () => {
  it('still returns the other blocks when the call agreements read throws', async () => {
    for (const suggestionsFail of ['throw', 'reject'] as const) {
      const { drizzle } = fakeDrizzle({ suggestionsFail })
      const text = await loadRequestOrgContext(drizzle, 'org-acme')
      expect(text).toContain('CLIENT ON FILE')
      expect(text).toContain('Name: Acme Hardware')
      expect(text).toContain('Brands on file: Acme Retail (acme-retail.com)')
      expect(text).toContain('Recent requests: Hero refresh (design)')
      expect(text).toContain('CLIENT HISTORY')
      expect(text).not.toContain('FROM RECENT CALLS')
    }
  })

  it('appends FROM RECENT CALLS for the client by default', async () => {
    const { drizzle } = fakeDrizzle({ suggestions: [requestRow(), taskRow()] })
    const text = await loadRequestOrgContext(drizzle, 'org-acme')
    expect(text.indexOf('FROM RECENT CALLS')).toBeGreaterThan(text.indexOf('CLIENT HISTORY'))
    expect(text).toContain('- #231 Footer LinkedIn tag, filed from the call on 2026-09-18')
    expect(text).not.toContain('Send Tim the footer copy')
    expect(text).not.toContain('LinkedIn tag into the footer this week')
  })

  it('carries tasks and quotes for the studio audience', async () => {
    const { drizzle } = fakeDrizzle({ suggestions: [requestRow(), taskRow()] })
    const text = await loadRequestOrgContext(drizzle, 'org-acme', { audience: 'studio' })
    expect(text).toContain('FROM RECENT CALLS (applied from call notes; already filed):')
    expect(text).toContain('- #231 Footer LinkedIn tag (new request, call 2026-09-18): "Can we get the LinkedIn tag into the footer this week?"')
    expect(text).toContain('- Task: Send Tim the footer copy (new task, call 2026-09-18): "Liam will send the footer copy over."')
  })
})
