/**
 * app/api/__tests__/portal-tracks-reorder-synthetic.test.ts
 *
 * PUT /api/portal/tracks/[trackId]/reorder must refuse a synthetic lane id
 * honestly instead of silently no-op'ing.
 *
 * Since S1, GET /api/portal/tracks emits synthetic entitlement-only lanes
 * (id like "synthetic-large-0" or "synthetic-small-1") for a track slot the
 * org is entitled to but that has no backing row in the tracks table yet. The
 * client Overview "Your work in motion" queue previously let a client press
 * the move up/down control on such a lane: the request PUT here looked the id
 * up in the tracks table, found nothing, and 404'd on a route whose caller
 * never checks the response, so the reorder silently reverted on the next
 * refetch with no feedback at all.
 *
 * The fix short-circuits on the id shape alone, before any D1 read: there is
 * nothing to reorder on an empty lane, so the route says so with a 400 rather
 * than pretending the track might exist.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn().mockResolvedValue({
    userId: 'user_client', orgId: 'org-a', clerkOrgId: 'clerk_org_a', impersonating: false,
  }),
}))
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/acting-as', () => ({
  refusePreviewWrite: vi.fn().mockReturnValue(null),
  actingIdentity: vi.fn().mockReturnValue({
    adminUserId: 'user_client', adminTeamMemberId: 'tm-1', adminName: 'Test', orgId: 'org-a', contactId: null,
  }),
  recordActingWrite: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { PUT as reorderTrack } from '@/app/api/portal/tracks/[trackId]/reorder/route'
import { NextRequest } from 'next/server'

function reorderReq(trackId: string, requestIds: string[]) {
  return new NextRequest(`http://localhost:3000/api/portal/tracks/${trackId}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestIds }),
  })
}

function call(trackId: string, requestIds: string[]) {
  return reorderTrack(reorderReq(trackId, requestIds), { params: Promise.resolve({ trackId }) })
}

describe('PUT /api/portal/tracks/[trackId]/reorder refuses synthetic lanes', () => {
  it.each(['synthetic-large-0', 'synthetic-small-1'])(
    '400s for %s with an explanation, without ever touching D1',
    async trackId => {
      const res = await call(trackId, ['req-1', 'req-2'])
      const json = (await res.json()) as { error?: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('There is nothing to reorder on an empty lane.')
      // The whole point: a synthetic id is recognised from its shape alone,
      // so the route never opens a D1 connection to look it up and 404.
      expect(db).not.toHaveBeenCalled()
    },
  )

  it('still 400s an empty requestIds array before the synthetic check', async () => {
    const res = await call('synthetic-large-0', [])
    const json = (await res.json()) as { error?: string }

    expect(res.status).toBe(400)
    expect(json.error).toBe('requestIds must be a non-empty array of IDs')
    expect(db).not.toHaveBeenCalled()
  })
})
