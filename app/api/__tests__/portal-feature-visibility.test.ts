/**
 * Route-level proof for audit item T1.18: denying a client org a feature used
 * to remove it from their nav only. A deep link or a direct fetch still served
 * the data, because there was not one `requireFeature` under app/api/portal.
 *
 * Portal routes now call the shared `requirePortalFeature`, so the deny lands
 * on the DATA. The resolver runs for real here (a scripted fake drizzle answers
 * the feature_visibility and contacts lookups), so what is under test is the
 * whole chain: org row -> contact refinement -> ancestor cascade -> 403.
 *
 * The studio is never narrowed by a client-side rule: an admin previewing the
 * portal (Clerk org = the Tahi org) and the MCP service token both pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema } from '@/db/d1'

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { getPortalAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { NextRequest } from 'next/server'

import { GET as portalTracks } from '@/app/api/portal/tracks/route'
import { GET as portalServices } from '@/app/api/portal/services/route'
import { GET as portalRequestForms } from '@/app/api/portal/request-forms/route'

const TAHI_ORG = 'org_tahi'
const CLIENT_ORG = 'org-client-1'
const CLIENT_USER = 'user-client-1'

type Row = Record<string, unknown>

/**
 * Fake drizzle. `overrideQueues` answers the two feature_visibility reads (org
 * baseline, then contact refinement) and the contacts lookup; every other table
 * resolves to no rows, which each route handles as an honest empty response.
 */
function makeDb(orgRows: Row[], contactRows: Row[] = [], contactRules: Row[] = []) {
  const queues = new Map<unknown, Row[][]>([
    // The org row the resolver normalises against: portal routes hand it the D1
    // id, the layout and the page guards hand it the Clerk id, and both land on
    // the same feature_visibility rows because of this lookup.
    [schema.organisations, [[{ id: CLIENT_ORG, clerkOrgId: 'clerk-org-client' }]]],
    [schema.featureVisibility, [orgRows, contactRules]],
    [schema.contacts, [contactRows]],
  ])
  const nextFor = (table: unknown): Row[] => {
    const q = queues.get(table)
    return q && q.length ? (q.shift() as Row[]) : []
  }
  const chain = (rows: Row[]) => {
    const c: Record<string, unknown> = {}
    for (const m of ['where', 'innerJoin', 'leftJoin', 'limit', 'orderBy', 'offset', 'groupBy']) {
      c[m] = () => c
    }
    c.then = (ok: (v: Row[]) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err)
    return c
  }
  return { select: () => ({ from: (table: unknown) => chain(nextFor(table)) }) }
}

function asClient() {
  vi.mocked(getPortalAuth).mockResolvedValue({
    userId: CLIENT_USER,
    orgId: CLIENT_ORG,
    clerkOrgId: 'clerk-org-client',
    impersonating: false,
  } as never)
}

const req = (url: string) => new NextRequest('http://localhost:3000' + url)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI_ORG
  asClient()
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_TAHI_ORG_ID
})

describe('portal routes enforce client feature_visibility', () => {
  it('403s a client org denied Tracks, instead of serving the data', async () => {
    vi.mocked(db).mockResolvedValue(makeDb([{ featureKey: 'tracks', effect: 'deny' }]) as never)
    const res = await portalTracks(req('/api/portal/tracks'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('403s a client org denied Services', async () => {
    vi.mocked(db).mockResolvedValue(makeDb([{ featureKey: 'services', effect: 'deny' }]) as never)
    expect((await portalServices(req('/api/portal/services'))).status).toBe(403)
  })

  it('403s the request intake form when Requests is denied', async () => {
    vi.mocked(db).mockResolvedValue(makeDb([{ featureKey: 'requests', effect: 'deny' }]) as never)
    expect((await portalRequestForms(req('/api/portal/request-forms'))).status).toBe(403)
  })

  it('serves a client with no deny rows (client features are on by default)', async () => {
    vi.mocked(db).mockResolvedValue(makeDb([]) as never)
    const res = await portalTracks(req('/api/portal/tracks'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], subscription: null })
  })

  it('serves a client denied a DIFFERENT feature', async () => {
    vi.mocked(db).mockResolvedValue(makeDb([{ featureKey: 'invoices', effect: 'deny' }]) as never)
    expect((await portalTracks(req('/api/portal/tracks'))).status).toBe(200)
  })

  it('lets a per-contact allow lift the org deny for that one person', async () => {
    vi.mocked(db).mockResolvedValue(makeDb(
      [{ featureKey: 'tracks', effect: 'deny' }],
      [{ id: 'contact-1' }],
      [{ featureKey: 'tracks', effect: 'allow' }],
    ) as never)
    expect((await portalTracks(req('/api/portal/tracks'))).status).toBe(200)
  })

  it('never narrows an admin previewing the portal (Clerk org = the Tahi org)', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue({
      userId: 'user_owner',
      orgId: CLIENT_ORG,
      clerkOrgId: TAHI_ORG,
      impersonating: true,
    } as never)
    vi.mocked(db).mockResolvedValue(makeDb([{ featureKey: 'tracks', effect: 'deny' }]) as never)
    expect((await portalTracks(req('/api/portal/tracks'))).status).toBe(200)
  })

  it('never narrows the MCP service token', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue({
      userId: 'api-service',
      orgId: CLIENT_ORG,
      clerkOrgId: null,
      impersonating: false,
    } as never)
    vi.mocked(db).mockResolvedValue(makeDb([{ featureKey: 'tracks', effect: 'deny' }]) as never)
    expect((await portalTracks(req('/api/portal/tracks'))).status).toBe(200)
  })
})
