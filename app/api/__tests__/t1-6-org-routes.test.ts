/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: vi.fn(), isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi' }))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(), resolvePermissions: vi.fn(),
}))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn(), auth: vi.fn(), currentUser: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'

const deniedAccess: ResolvedAccess = {
  userId: 'scoped-seat', orgId: 'org_tahi', level: 'team_member', audience: 'team',
  isAdmin: false, isSuperAdmin: false, canManagePermissions: false,
  viewableResources: new Set(), overrides: new Map(),
}

const modules = import.meta.glob('../admin/**/route.ts')
const CASES = [
  { file: 'admin/brands/route.ts', method: 'GET' },
  { file: 'admin/clients/route.ts', method: 'GET' },
  {
    "file": "admin/blockers/search/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/call-transcripts/calls/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/call-transcripts/[id]/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/call-transcripts/[id]/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/calls/index/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/calls/normalize-times/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/calls/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/calls/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/calls/[id]/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/conversations/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/conversations/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/conversations/[id]/messages/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/conversations/[id]/messages/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/conversations/[id]/messages/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/forms/resolve/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/forms/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/forms/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/forms/[id]/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/forms/[id]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/kanban-columns/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/kanban-columns/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/kanban-columns/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/kanban-columns/[id]/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/kanban-columns/[id]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/requests/bulk/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/bulk/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/requests/bulk-assign/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/blockers/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/blockers/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/blockers/[linkId]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/requests/[id]/calls/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/calls/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/draft-reply/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/duplicate/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/files/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/files/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/handoff/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/handoff/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/requests/[id]/messages/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/messages/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/nest/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/participants/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/participants/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/participants/[participantId]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/requests/[id]/reads/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/reads/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/requests/[id]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/requests/[id]/scope-flag/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/scope-flag/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/requests/[id]/steps/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/steps/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/steps/[stepId]/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/requests/[id]/steps/[stepId]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/requests/[id]/sub-requests/reorder/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/requests/[id]/sub-requests/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/sub-requests/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/time-entries/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/time-entries/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/triage/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/requests/[id]/voice-notes/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/requests/[id]/voice-notes/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/task-templates/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/task-templates/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/task-templates/[id]/route.ts",
    "method": "PATCH"
  },
  {
    "file": "admin/task-templates/[id]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/time/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/time/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/time/[id]/route.ts",
    "method": "DELETE"
  },
  {
    "file": "admin/time-entries/route.ts",
    "method": "GET"
  },
  {
    "file": "admin/time-entries/route.ts",
    "method": "POST"
  },
  {
    "file": "admin/call-transcripts/route.ts",
    "method": "GET"
  }
] as const

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'scoped-seat', orgId: 'org_tahi', sessionId: 'test', mcpActor: { teamMemberId: 'owner', clerkUserId: 'owner-user', profile: 'full' } })
  vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  vi.mocked(db).mockRejectedValue(new Error('A denied feature must not reach business data'))
  vi.mocked(resolvePermissions).mockResolvedValue(deniedAccess)
})

describe.each(CASES)('$method $file refuses a denied scoped seat', scenario => {
  it('returns 403 before business queries, regardless of recorded attribution', async () => {
    const route = await modules['../' + scenario.file]() as Record<string, Handler>
    const preparesAccess = (scenario.file === 'admin/clients/route.ts' && scenario.method === 'GET')
      || (scenario.method === 'POST' && ['admin/time/route.ts', 'admin/time-entries/route.ts', 'admin/requests/[id]/time-entries/route.ts'].includes(scenario.file))
    // These handlers share resolved permissions across guards. Their first DB
    // handle is permission-only; a second opening or a business query throws.
    const permissionDatabase = new Proxy({}, { get(_target, key) {
      if (['select', 'insert', 'update', 'delete', 'all', 'run', 'batch'].includes(String(key))) {
        throw new Error('A denied feature must not execute business queries')
      }
      return undefined
    } })
    if (preparesAccess) vi.mocked(db).mockResolvedValueOnce(permissionDatabase as never)
    const request = new NextRequest('http://localhost/api/' + scenario.file.replace('/route.ts', '').replaceAll(/\[[^/]+\]/g, 'foreign-id'), {
      method: scenario.method,
      ...(scenario.method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }),
    })
    const response = await route[scenario.method](request, { params: Promise.resolve({ id: 'foreign-id', stepId: 'foreign-step', linkId: 'foreign-link', participantId: 'foreign-person' }) })
    expect(response.status).toBe(403)
    if (preparesAccess) {
      expect(db).toHaveBeenCalledTimes(1)
      expect(resolvePermissions).toHaveBeenCalledWith(permissionDatabase, expect.objectContaining({ userId: 'scoped-seat', orgId: 'org_tahi' }))
      expect(requireFeature).toHaveBeenCalledWith({ userId: 'scoped-seat', orgId: 'org_tahi' }, expect.anything(), deniedAccess)
    } else {
      expect(db).not.toHaveBeenCalled()
      expect(requireFeature).toHaveBeenCalledWith({ userId: 'scoped-seat', orgId: 'org_tahi' }, expect.anything())
    }
  })
})
