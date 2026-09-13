/**
 * GET /api/portal/kickoff-slots
 *
 * Liam's feedback walking the kickoff step as a dummy client: the picker
 * offered four fixed times with no idea whether the studio actually had that
 * hour free. This route answers with the studio's real availability. Three
 * things matter here that the pure lib tests (lib/kickoff-availability.test.ts,
 * lib/kickoff-slot.test.ts) cannot cover on their own:
 *
 *   1. Auth scoping: a real client org gets its own slots, the Tahi admin org
 *      and an unauthenticated caller are refused, and the MCP service branch
 *      (CLAUDE.md rule 14) must NAME an org in ?orgId= since the worker's own
 *      Clerk org resolves to Tahi.
 *   2. The `timeZone` query param round-trips into both the per-slot labels
 *      and the payload's own `timeZone`/`timeZoneLabel`, falling back to the
 *      studio's zone for anything unreadable.
 *   3. The route NEVER fails the step over Google: not connected, an
 *      insufficient-scope 403 from freeBusy (today's actual production state,
 *      since the Google grant holds only calendar.events.readonly, which
 *      freeBusy needs calendar.freebusy or calendar.events for), and a
 *      generic freeBusy failure all fall back to `calendarSynced: false` with
 *      a `reason` and the full plain window, never a 500 or an empty list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const getPortalAuth = vi.fn()
const getRequestAuth = vi.fn()
const getGoogleAccessToken = vi.fn()
const getPrimaryCalendarFreeBusy = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: (...a: unknown[]) => getPortalAuth(...a),
  getRequestAuth: (...a: unknown[]) => getRequestAuth(...a),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/google', () => ({
  getGoogleAccessToken: (...a: unknown[]) => getGoogleAccessToken(...a),
  getPrimaryCalendarFreeBusy: (...a: unknown[]) => getPrimaryCalendarFreeBusy(...a),
}))

import { GET } from '@/app/api/portal/kickoff-slots/route'

function req(query = ''): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/kickoff-slots' + query)
}

// Thursday 24 September 2026, 2pm NZST: same fixture as the lib suites, so
// the working-day math (nextWorkingDays / buildKickoffSlots) is pinned and
// this file only has to assert what the ROUTE adds on top of it.
const NOW = new Date('2026-09-24T02:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  getPortalAuth.mockResolvedValue({ orgId: 'org_client', userId: 'user_1' })
  getRequestAuth.mockResolvedValue({ orgId: 'org_client', userId: 'user_1' })
  getGoogleAccessToken.mockResolvedValue({ accessToken: 'tok' })
  getPrimaryCalendarFreeBusy.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('auth scoping', () => {
  it('refuses a session with no portal org', async () => {
    getPortalAuth.mockResolvedValue({ orgId: null, userId: 'user_1' })
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('refuses a signed-out caller', async () => {
    getPortalAuth.mockResolvedValue({ orgId: 'org_client', userId: null })
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('refuses the Tahi admin org itself', async () => {
    getPortalAuth.mockResolvedValue({ orgId: 'org_tahi', userId: 'user_liam' })
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('answers a real client org with its own slots', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { slots: unknown[] }
    expect(Array.isArray(json.slots)).toBe(true)
    expect(json.slots.length).toBeGreaterThan(0)
  })

  it('the MCP service branch must name an org in ?orgId=, since the service token resolves to Tahi', async () => {
    getRequestAuth.mockResolvedValue({ orgId: 'org_tahi', userId: 'api-service' })
    const withoutOrg = await GET(req())
    expect(withoutOrg.status).toBe(403)
    // getPortalAuth is never consulted on the service branch.
    expect(getPortalAuth).not.toHaveBeenCalled()

    const withOrg = await GET(req('?orgId=org_client'))
    expect(withOrg.status).toBe(200)
  })

  it('the service branch still refuses naming the Tahi org itself', async () => {
    getRequestAuth.mockResolvedValue({ orgId: 'org_tahi', userId: 'api-service' })
    const res = await GET(req('?orgId=org_tahi'))
    expect(res.status).toBe(403)
  })
})

describe('timeZone query param', () => {
  it('accepts a real IANA zone and labels every slot in it', async () => {
    const res = await GET(req('?timeZone=America/New_York'))
    const json = (await res.json()) as { timeZone: string; timeZoneLabel: string; slots: { label: string }[] }
    expect(json.timeZone).toBe('America/New_York')
    expect(json.timeZoneLabel).toContain('Eastern')
    expect(json.slots.every(s => typeof s.label === 'string' && s.label.length > 0)).toBe(true)
  })

  it('falls back to the studio zone for junk or a missing param', async () => {
    const junk = await GET(req('?timeZone=Middle/Earth'))
    const missing = await GET(req())
    const junkJson = (await junk.json()) as { timeZone: string; studioTimeZone: string }
    const missingJson = (await missing.json()) as { timeZone: string; studioTimeZone: string }
    expect(junkJson.timeZone).toBe(junkJson.studioTimeZone)
    expect(missingJson.timeZone).toBe(missingJson.studioTimeZone)
  })

  it('always names the studio zone alongside the visitor zone', async () => {
    const res = await GET(req('?timeZone=America/New_York'))
    const json = (await res.json()) as { studioTimeZone: string; studioTimeZoneLabel: string }
    expect(json.studioTimeZone).toBe('Pacific/Auckland')
    expect(json.studioTimeZoneLabel).toContain('New Zealand')
  })
})

describe('the calendar is best-effort: never fails the step', () => {
  it('is synced and removes busy slots when Google answers cleanly', async () => {
    // Friday 25 Sept 9:00-10:00 NZST busy: removes the 9:00 and 9:30 chips.
    getPrimaryCalendarFreeBusy.mockResolvedValue([
      { start: '2026-09-24T21:00:00.000Z', end: '2026-09-24T22:00:00.000Z' },
    ])
    const res = await GET(req())
    const json = (await res.json()) as { calendarSynced: boolean; reason: string | null; slots: { start: string }[] }
    expect(json.calendarSynced).toBe(true)
    expect(json.reason).toBeNull()
    const starts = json.slots.map(s => s.start)
    expect(starts).not.toContain('2026-09-24T21:00:00.000Z')
    expect(starts).not.toContain('2026-09-24T21:30:00.000Z')
    expect(starts).toContain('2026-09-24T22:00:00.000Z')
  })

  it('falls back to the plain window when Google is not connected', async () => {
    getGoogleAccessToken.mockRejectedValue(new Error('not connected'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { calendarSynced: boolean; reason: string | null; slots: unknown[] }
    expect(json.calendarSynced).toBe(false)
    expect(json.reason).toBe('Reconnect Google to sync availability')
    expect(json.slots.length).toBeGreaterThan(0)
  })

  it('falls back to the plain window on an insufficient-scope answer from freeBusy (today\'s production state)', async () => {
    getPrimaryCalendarFreeBusy.mockRejectedValue(
      new Error('Calendar freeBusy error: insufficientPermissions'),
    )
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { calendarSynced: boolean; reason: string | null; slots: unknown[] }
    expect(json.calendarSynced).toBe(false)
    expect(json.reason).toBe('Reconnect Google to sync availability')
    expect(json.slots.length).toBeGreaterThan(0)
  })

  it('falls back to the plain window on any other freeBusy transport failure', async () => {
    getPrimaryCalendarFreeBusy.mockRejectedValue(new Error('Calendar freeBusy failed: 500 oops'))
    const res = await GET(req())
    const json = (await res.json()) as { calendarSynced: boolean; slots: unknown[] }
    expect(json.calendarSynced).toBe(false)
    expect(json.slots.length).toBeGreaterThan(0)
  })
})
