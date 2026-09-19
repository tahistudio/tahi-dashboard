/**
 * POST /api/admin/integrations/google/sync-calendar, meetingType
 * classification coverage for the 'mentoring' / 'other' vocabulary
 * additions.
 *
 * Covers:
 *   - classifyTitle recognises 'mentor', 'mentoring' and 'coaching' titles
 *     as 'mentoring' (exercised indirectly through a fresh, unmatched
 *     event, since the classifier itself is not exported).
 *   - A hand-set meetingType survives a sync pass when the event has no
 *     lead/org/deal parent link (the computed value would only ever come
 *     from the weaker title heuristic).
 *   - A lead-linked call is always reclassified to 'discovery' by the
 *     sync, even when a human previously set a different meetingType by
 *     hand - a parent link is a fresh, reliable signal that still wins.
 *
 * Google Calendar + Drive tokens are mocked at lib/google; the D1 layer is
 * the same queue-based fake chain used by
 * app/api/admin/integrations/google/__tests__/sync-drive-transcripts.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/cron-runs', () => ({ logCronRun: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/google', () => ({
  getGoogleAccessToken: vi.fn().mockResolvedValue({
    accessToken: 'tok', refreshToken: null, expiresAt: null, email: 'me@tahi.studio', scopes: '',
  }),
  listCalendarEvents: vi.fn(),
  GoogleNotConnectedError: class GoogleNotConnectedError extends Error {},
}))

import { db } from '@/lib/db'
import { listCalendarEvents } from '@/lib/google'
import type { CalendarEvent } from '@/lib/google'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/integrations/google/sync-calendar/route'

// ---------------------------------------------------------------------------
// Fake D1: a queue-based chainable recorder. Mirrors
// sync-drive-transcripts.test.ts / patch-link-fields.test.ts.
// ---------------------------------------------------------------------------
type QueryRecord = { method: string; args: unknown[] }

function makeChain(result: unknown, calls: QueryRecord[]): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[][] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const calls: QueryRecord[] = [{ method, args }]
    queries.push(calls)
    return makeChain(queue.length ? queue.shift() : [], calls)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
  }
  return { handle, queries }
}

function request() {
  return new NextRequest('http://localhost:3000/api/admin/integrations/google/sync-calendar', { method: 'POST' })
}

function event(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    summary: 'Untitled meeting',
    status: 'confirmed',
    start: { dateTime: '2026-09-19T22:00:00Z' },
    end: { dateTime: '2026-09-19T22:30:00Z' },
    attendees: [{ email: 'stranger@nowhere.test' }],
    ...overrides,
  }
}

/** The set of queries every run makes BEFORE the per-event loop, in
 *  order: leadRows, leadsWithSite, contactRows, dealContactRows (skipped
 *  when contactRows is empty), dealRows (skipped when no deal contacts),
 *  existingCalls. Our fixtures never populate contacts/deal data, so
 *  those two conditional queries never fire. */
function preloop(leadRows: unknown[], existingCalls: unknown[]) {
  return [
    leadRows,   // leadRows (by email)
    [],         // leadsWithSite (by domain)
    [],         // contactRows
    existingCalls, // existingCalls (by googleCalendarEventId)
  ]
}

beforeEach(() => {
  // vi.clearAllMocks() clears call history but not the mockResolvedValue
  // set in the vi.mock factory above, so getGoogleAccessToken keeps
  // resolving between tests without re-asserting it here.
  vi.clearAllMocks()
})

describe('sync-calendar, meetingType classification', () => {
  it('classifies an unmatched "mentor" title as mentoring', async () => {
    vi.mocked(listCalendarEvents).mockResolvedValue([
      event({ id: 'evt-mentor', summary: 'Mentor session with Jane' }),
    ])
    const { handle, queries } = makeDb([
      ...preloop([], []),
      [], // update integrations (final stamp)
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    expect(res.status).toBe(200)

    const insertCall = queries.flat().find(c => c.method === 'values')
    expect(insertCall?.args[0]).toMatchObject({ meetingType: 'mentoring' })
  })

  it('classifies an unmatched "coaching" title as mentoring', async () => {
    vi.mocked(listCalendarEvents).mockResolvedValue([
      event({ id: 'evt-coaching', summary: 'Weekly coaching call' }),
    ])
    const { handle, queries } = makeDb([
      ...preloop([], []),
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    expect(res.status).toBe(200)

    const insertCall = queries.flat().find(c => c.method === 'values')
    expect(insertCall?.args[0]).toMatchObject({ meetingType: 'mentoring' })
  })

  it('never classifies a fresh event as "other" (human-only value)', async () => {
    // A grab-bag of titles that would otherwise be ambiguous. None should
    // ever resolve to 'other' - that value only ever comes from a human
    // editing the call by hand.
    vi.mocked(listCalendarEvents).mockResolvedValue([
      event({ id: 'evt-other-1', summary: 'Random 1:1' }),
      event({ id: 'evt-other-2', summary: 'Something else entirely', attendees: [{ email: 'other@nowhere.test' }] }),
    ])
    const { handle, queries } = makeDb([
      ...preloop([], []),
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    expect(res.status).toBe(200)

    const insertedTypes = queries.flat()
      .filter(c => c.method === 'values')
      .map(c => (c.args[0] as { meetingType?: string }).meetingType)
    expect(insertedTypes.every(t => t !== 'other')).toBe(true)
  })

  it('preserves a hand-set "mentoring" meetingType when the sync has no lead/org/deal parent link', async () => {
    const existingRow = {
      id: 'call-1',
      googleCalendarEventId: 'evt-preserve',
      title: 'Untitled meeting',
      scheduledAt: '2026-09-19T22:00:00.000Z',
      durationMinutes: 30,
      googleMeetUrl: null,
      meetingType: 'mentoring',
    }
    vi.mocked(listCalendarEvents).mockResolvedValue([
      // Title alone would classify as unclassified (no keyword match), and
      // there is no attendee match, so the computed value is 'unclassified'.
      // The stored 'mentoring' must survive.
      event({ id: 'evt-preserve', summary: 'Untitled meeting' }),
    ])
    const { handle, queries } = makeDb([
      ...preloop([], [existingRow]),
      [], // update integrations (final stamp)
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    const body = await res.json() as { updated: number; results: Array<{ eventId: string; action: string }> }
    expect(res.status).toBe(200)
    // Nothing actually changed (title/time/meetingType all match what's
    // stored), so the row is reported unchanged, not overwritten.
    expect(body.results.find(r => r.eventId === 'evt-preserve')).toMatchObject({ action: 'unchanged' })
    expect(body.updated).toBe(0)
    // Only the trailing integrations stamp update ran - no write to
    // discovery_calls at all, since nothing (including meetingType)
    // actually changed.
    const updateCalls = queries.filter(q => q[0].method === 'update')
    expect(updateCalls).toHaveLength(1)
  })

  it('always reclassifies a lead-linked call to discovery, even over a hand-set meetingType', async () => {
    const existingRow = {
      id: 'call-2',
      googleCalendarEventId: 'evt-lead',
      title: 'Untitled meeting',
      scheduledAt: '2026-09-19T22:00:00.000Z',
      durationMinutes: 30,
      googleMeetUrl: null,
      meetingType: 'client', // a human previously (mis)classified this
    }
    vi.mocked(listCalendarEvents).mockResolvedValue([
      event({ id: 'evt-lead', summary: 'Untitled meeting', attendees: [{ email: 'lead@prospect.test' }] }),
    ])
    const { handle, queries } = makeDb([
      [{ id: 'lead-1', email: 'lead@prospect.test', status: 'new', website: null }], // leadRows
      [], // leadsWithSite
      [], // contactRows
      [existingRow], // existingCalls
      [], // update integrations
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    expect(res.status).toBe(200)

    const setCall = queries.flatMap(q => q).find(c => c.method === 'set')
    expect(setCall?.args[0]).toMatchObject({ meetingType: 'discovery' })
  })
})
