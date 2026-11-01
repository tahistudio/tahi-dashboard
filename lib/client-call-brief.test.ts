import { describe, it, expect } from 'vitest'
import {
  BRIEF_CAPS,
  buildClientCallBrief,
  type BriefInvoiceRow,
  type BriefPastCallRow,
  type BriefRequestRow,
  type BriefTaskRow,
  type ClientCallBriefInput,
} from '@/lib/client-call-brief'

const NOW = new Date('2026-11-01T00:00:00Z')
const ORG = { id: 'org_1', name: 'Acme' }

function input(over: Partial<ClientCallBriefInput> = {}): ClientCallBriefInput {
  return {
    call: { id: 'call_now', title: 'Acme check-in', scheduledAt: '2026-11-02T01:00:00Z', orgId: 'org_1' },
    org: ORG,
    pastCalls: [],
    requests: [],
    tasks: [],
    blockers: [],
    invoices: null,
    now: NOW,
    ...over,
  }
}

function past(i: number, over: Partial<BriefPastCallRow> = {}): BriefPastCallRow {
  return {
    id: `call_${i}`, title: `Call ${i}`, scheduledAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString(), status: 'completed',
    summary: null, transcriptSummary: null, outcome: null, outcomeNotes: null, scopeNotes: null, ...over,
  }
}

function req(i: number, over: Partial<BriefRequestRow> = {}): BriefRequestRow {
  return {
    id: `req_${i}`, title: `Request ${i}`, requestNumber: i, status: 'in_progress', priority: 'standard', dueDate: null,
    scopeFlagged: false, scopeFlagReason: null, revisionCount: 0, maxRevisions: 3,
    waitingOnContactId: null, waitingOnContactName: null, waitingReason: null, waitingSince: null,
    waitingDueAt: null, waitingNote: null, ...over,
  }
}

function task(i: number, over: Partial<BriefTaskRow> = {}): BriefTaskRow {
  return { id: `task_${i}`, title: `Task ${i}`, status: 'todo', priority: 'standard', dueDate: null, requestId: null, ...over }
}

function inv(i: number, over: Partial<BriefInvoiceRow> = {}): BriefInvoiceRow {
  return { id: `inv_${i}0000000`, number: `INV-${i}`, status: 'sent', totalUsd: 100, currency: 'USD', dueDate: '2026-12-01', sentAt: '2026-10-01T00:00:00Z', paidAt: null, ...over }
}

describe('buildClientCallBrief', () => {
  it('returns no_org with empty sections when the call has no client', () => {
    const brief = buildClientCallBrief(input({ org: null, call: { id: 'c', title: 't', scheduledAt: '2026-11-02T01:00:00Z', orgId: null } }))
    expect(brief.state).toBe('no_org')
    expect(brief.org).toBeNull()
    expect(brief.sources).toEqual([])
    expect(brief.finance).toBeNull()
    expect(brief.pastCalls).toEqual([])
  })

  it('handles an empty history without throwing and says so', () => {
    const brief = buildClientCallBrief(input())
    expect(brief.state).toBe('ready')
    expect(brief.pastCalls).toEqual([])
    expect(brief.openRequests).toEqual([])
    expect(brief.raise).toContain('No earlier calls on record with this client.')
    expect(brief.sources).toEqual([{ label: 'Acme client page', href: '/clients/org_1' }])
    expect(brief.totals.requests).toBe(0)
  })

  it('caps past calls, newest first, reports the true total, ignores the call itself, cancelled and future calls', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => past(i)),
      past(20, { id: 'call_now' }),
      past(21, { status: 'cancelled' }),
      past(22, { id: 'later', scheduledAt: '2026-12-01T00:00:00Z' }),
    ]
    const brief = buildClientCallBrief(input({ pastCalls: rows }))
    expect(brief.pastCalls).toHaveLength(BRIEF_CAPS.pastCalls)
    expect(brief.totals.pastCalls).toBe(9)
    expect(brief.pastCalls.map(c => c.id)).toEqual(['call_8', 'call_7', 'call_6', 'call_5', 'call_4'])
    expect(brief.pastCalls[0].href).toBe('/calls?call=call_8')
  })

  it('prefers the transcript summary and clips long text', () => {
    const long = 'word '.repeat(200)
    const brief = buildClientCallBrief(input({
      pastCalls: [past(1, { summary: 'old', transcriptSummary: long, outcomeNotes: 'Agreed to launch in Nov' })],
    }))
    expect(brief.pastCalls[0].summary!.length).toBeLessThanOrEqual(400)
    expect(brief.pastCalls[0].summary!.endsWith('...')).toBe(true)
    expect(brief.pastCalls[0].decisions).toBe('Agreed to launch in Nov')
  })

  it('lists only open requests, overdue and high priority first, and caps them', () => {
    const rows = [
      req(1, { status: 'delivered' }),
      req(2, { status: 'draft' }),
      req(3, { priority: 'standard' }),
      req(4, { priority: 'high' }),
      req(5, { dueDate: '2026-10-01' }),
      ...Array.from({ length: 12 }, (_, i) => req(10 + i)),
    ]
    const brief = buildClientCallBrief(input({ requests: rows }))
    expect(brief.openRequests).toHaveLength(BRIEF_CAPS.requests)
    expect(brief.openRequests[0].id).toBe('req_5')
    expect(brief.openRequests[0].overdue).toBe(true)
    expect(brief.openRequests[1].id).toBe('req_4')
    expect(brief.openRequests.find(r => r.id === 'req_1' || r.id === 'req_2')).toBeUndefined()
    expect(brief.totals.requests).toBe(15)
    expect(brief.openRequests[0].ref).toBe('#005')
  })

  it('surfaces hand-offs and scope flags from open requests only', () => {
    const brief = buildClientCallBrief(input({
      requests: [
        req(1, { waitingOnContactId: 'c1', waitingOnContactName: 'Sam', waitingReason: 'approval', waitingSince: '2026-10-25T00:00:00Z' }),
        req(2, { scopeFlagged: true, scopeFlagReason: 'Extra pages', revisionCount: 4, maxRevisions: 3 }),
        req(3, { scopeFlagged: true, status: 'delivered' }),
      ],
    }))
    expect(brief.handoffs).toHaveLength(1)
    expect(brief.handoffs[0]).toMatchObject({ contactName: 'Sam', daysWaiting: 7, href: '/requests/req_1' })
    expect(brief.scopeFlags).toHaveLength(1)
    expect(brief.scopeFlags[0]).toMatchObject({ reason: 'Extra pages', revisions: '4 of 3 revisions used' })
    expect(brief.raise.some(l => l.startsWith('Ask Sam'))).toBe(true)
    expect(brief.raise.some(l => l.includes('Scope on'))).toBe(true)
  })

  it('orders tasks blocked first, drops done ones and links blockers', () => {
    const brief = buildClientCallBrief(input({
      tasks: [task(1), task(2, { status: 'blocked' }), task(3, { status: 'done' }), task(4, { dueDate: '2026-10-01' })],
      blockers: [{ blockedType: 'task', blockedId: 'task_2', blockedTitle: 'Task 2', blockerTitle: 'Copy from client' }],
    }))
    expect(brief.openTasks.map(t => t.id)).toEqual(['task_2', 'task_4', 'task_1'])
    expect(brief.blockers[0].href).toBe('/tasks/task_2')
    expect(brief.raise).toContain('Task 2 is blocked by Copy from client.')
  })

  it('omits finance entirely when the viewer is not allowed (invoices null)', () => {
    const brief = buildClientCallBrief(input({ invoices: null }))
    expect(brief.finance).toBeNull()
    expect(brief.sources.some(s => s.href.startsWith('/invoices'))).toBe(false)
    expect(brief.raise.join(' ')).not.toMatch(/invoice/i)
  })

  it('reports last invoice and overdue totals when finance is allowed', () => {
    const brief = buildClientCallBrief(input({
      invoices: [
        inv(1, { status: 'paid', paidAt: '2026-10-05T00:00:00Z', sentAt: '2026-09-01T00:00:00Z' }),
        inv(2, { status: 'overdue', dueDate: '2026-10-10', totalUsd: 250 }),
        inv(3, { status: 'draft' }),
      ],
    }))
    expect(brief.finance!.lastInvoice!.reference).toBe('INV-2')
    expect(brief.finance!.overdue).toHaveLength(1)
    expect(brief.finance!.overdueTotalUsd).toBe(250)
    expect(brief.raise[0]).toContain('INV-2')
    expect(brief.sources.some(s => s.href === '/invoices/inv_20000000')).toBe(true)
  })

  it('allowed finance with no invoices is an empty section, not null', () => {
    const brief = buildClientCallBrief(input({ invoices: [] }))
    expect(brief.finance).toEqual({ lastInvoice: null, overdue: [], overdueTotalUsd: 0 })
  })

  it('caps the raise list and dedupes sources', () => {
    const brief = buildClientCallBrief(input({
      requests: Array.from({ length: 6 }, (_, i) => req(i, {
        dueDate: '2026-10-01', scopeFlagged: true, waitingOnContactId: 'c', waitingReason: 'file', waitingSince: '2026-10-20T00:00:00Z',
      })),
    }))
    expect(brief.raise.length).toBeLessThanOrEqual(BRIEF_CAPS.raise)
    const hrefs = brief.sources.map(s => s.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('emits no em or en dashes in generated copy', () => {
    const brief = buildClientCallBrief(input({
      requests: [req(1, { waitingOnContactId: 'c', waitingReason: 'approval', waitingSince: '2026-10-25T00:00:00Z', scopeFlagged: true })],
      invoices: [inv(1, { status: 'overdue', dueDate: '2026-10-10' })],
    }))
    expect(JSON.stringify(brief)).not.toMatch(/[–—]/)
  })
})
