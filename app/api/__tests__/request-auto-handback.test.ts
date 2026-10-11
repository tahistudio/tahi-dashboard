/**
 * The three client writes that hand a request back on their own.
 *
 * A hand-off that the client has to close BY HAND after doing the thing they
 * were asked to do is a hand-off that stays open: nobody presses "I have done
 * it" on a portal they visit twice a month, and the studio ends up chasing
 * work that landed days ago. So approving, uploading and replying each clear
 * the pointer themselves.
 *
 * This file checks the wiring, not the rule. Whether the pointer SHOULD clear
 * for a given person is lib/request-handoff.ts's job and is tested there
 * (a colleague at the same client must not clear somebody else's hand-off);
 * what matters here is that each of the three routes actually calls it, with
 * the acting contact and the right trigger, and that an upload BY THE STUDIO
 * does not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Slack thread line (CN.3): armed only when the token is set, with the
// queue recorded rather than deferred.
vi.mock('@/lib/slack/work-sync', async () => {
  const actual = await vi.importActual<typeof import('@/lib/slack/work-sync')>('@/lib/slack/work-sync')
  return {
    ...actual,
    workSyncArmed: () => !!process.env.SLACK_BOT_TOKEN,
    queueWorkSync: vi.fn(async () => undefined),
  }
})
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({ requirePortalFeature: vi.fn() }))
vi.mock('@/lib/notify-request-team', () => ({ notifyRequestTeam: vi.fn() }))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(), logAuditStrict: vi.fn() }))
vi.mock('@/lib/upload-access', () => ({ resolveOwnerOrgForUpload: vi.fn() }))
vi.mock('@/lib/acting-eligibility', () => ({ resolveActEligibility: vi.fn() }))
vi.mock('@/lib/request-handoff', () => ({ handBackOnClientAction: vi.fn() }))
vi.mock('@/lib/acting-as', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/acting-as')>()),
  recordActingWrite: vi.fn(),
}))
vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

import { db } from '@/lib/db'
import { getPortalAuth, getRequestAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { resolveOwnerOrgForUpload } from '@/lib/upload-access'
import { handBackOnClientAction } from '@/lib/request-handoff'
import { queueWorkSync } from '@/lib/slack/work-sync'
import { NextRequest } from 'next/server'
import { POST as REVIEW } from '@/app/api/portal/requests/[id]/review/route'
import { POST as THREAD } from '@/app/api/portal/requests/[id]/messages/route'
import { POST as CONFIRM } from '@/app/api/uploads/confirm/route'

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

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const REQUEST = {
  id: 'req-1',
  orgId: 'org-a',
  title: 'Spring landing page',
  status: 'client_review',
  assigneeId: 'tm-1',
  requestNumber: 42,
}
const CONTACT = { id: 'contact-1', name: 'Ngaire Hutchins' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requirePortalFeature).mockResolvedValue(null as never)
  vi.mocked(getPortalAuth).mockResolvedValue({
    orgId: 'org-a', userId: 'user_ngaire', clerkOrgId: 'org_clerk_a', contactId: null,
  } as never)
})

describe('approving in client review hands the request back', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost:3000/api/portal/requests/req-1/review', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  it('calls the hand-back with the approving contact and the review trigger', async () => {
    const { handle } = makeDb([[REQUEST], [], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await REVIEW(req({ decision: 'approve' }), params('req-1'))
    expect(res.status).toBe(200)
    expect(vi.mocked(handBackOnClientAction)).toHaveBeenCalledWith(
      expect.anything(),
      {
        requestId: 'req-1',
        contactId: 'contact-1',
        contactName: 'Ngaire Hutchins',
        trigger: 'review_approved',
      },
    )
  })

  it('does not hand back on "changes", which is the studio being asked for more', async () => {
    const { handle } = makeDb([[REQUEST], [], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await REVIEW(req({ decision: 'changes', note: 'Shorten the hero' }), params('req-1'))
    expect(res.status).toBe(200)
    expect(vi.mocked(handBackOnClientAction)).not.toHaveBeenCalled()
  })
})

describe('the client review and the Slack thread line (CN.3)', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost:3000/api/portal/requests/req-1/review', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('queues an approval as the client, in their words', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { handle } = makeDb([[REQUEST], [], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await REVIEW(req({ decision: 'approve' }), params('req-1'))
    expect(res.status).toBe(200)
    // No contact is named: the route's own lookup is by login alone, so the
    // engine picks the seat at this request's client from the login instead.
    expect(vi.mocked(queueWorkSync).mock.calls[0][1]).toEqual([{
      entityType: 'request',
      entityId: 'req-1',
      actor: { type: 'client', contactId: null, clerkUserId: 'user_ngaire', actingAsTeamMemberId: null },
      changes: [{ field: 'status', from: 'client_review', to: 'delivered', phrase: 'approved it' }],
    }])
  })

  it('queues a change request as "asked for changes"', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { handle } = makeDb([[REQUEST], [], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await REVIEW(req({ decision: 'changes', note: 'Shorten the hero' }), params('req-1'))
    expect(vi.mocked(queueWorkSync).mock.calls[0][1][0].changes).toEqual([
      { field: 'status', from: 'client_review', to: 'in_progress', phrase: 'asked for changes' },
    ])
  })

  it('names the studio acting for the client, standing in the previewed seat', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    vi.mocked(getPortalAuth).mockResolvedValue({
      orgId: 'org-a',
      userId: 'user_liam',
      clerkOrgId: 'org_clerk_a',
      contactId: 'contact-1',
      impersonating: true,
      canWriteAsClient: true,
      actingAs: {
        adminUserId: 'user_liam',
        adminTeamMemberId: 'tm_liam',
        adminName: 'Liam Miller',
        orgId: 'org-a',
        contactId: 'contact-1',
      },
    } as never)
    // The contact lookup by the admin's own login finds nobody.
    const { handle } = makeDb([[REQUEST], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await REVIEW(req({ decision: 'approve' }), params('req-1'))
    expect(res.status).toBe(200)
    expect(vi.mocked(queueWorkSync).mock.calls[0][1][0].actor).toEqual({
      type: 'client', contactId: 'contact-1', clerkUserId: 'user_liam', actingAsTeamMemberId: 'tm_liam',
    })
  })

  it('queues nothing while Slack is not configured', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const { handle } = makeDb([[REQUEST], [], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await REVIEW(req({ decision: 'approve' }), params('req-1'))
    expect(res.status).toBe(200)
    expect(vi.mocked(queueWorkSync)).not.toHaveBeenCalled()
  })

  it('queues nothing for a request that is not in client review', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { handle } = makeDb([[{ ...REQUEST, status: 'in_progress' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await REVIEW(req({ decision: 'approve' }), params('req-1'))
    expect(res.status).toBe(400)
    expect(vi.mocked(queueWorkSync)).not.toHaveBeenCalled()
  })
})

describe('replying on the thread hands the request back', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost:3000/api/portal/requests/req-1/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  it('calls the hand-back with the replying contact and the thread trigger', async () => {
    const { handle } = makeDb([[REQUEST], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await THREAD(req({ body: '<p>Here are the photos</p>' }), params('req-1'))
    expect(res.status).toBe(201)
    expect(vi.mocked(handBackOnClientAction)).toHaveBeenCalledWith(
      expect.anything(),
      {
        requestId: 'req-1',
        contactId: 'contact-1',
        contactName: 'Ngaire Hutchins',
        trigger: 'thread_message',
      },
    )
  })
})

describe('uploading a file to the request hands it back', () => {
  function req(body: Record<string, unknown>) {
    return new NextRequest('http://localhost:3000/api/uploads/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  const payload = {
    storageKey: 'org-a/photos.zip',
    filename: 'photos.zip',
    requestId: 'req-1',
    mimeType: 'application/zip',
    sizeBytes: 1024,
  }

  beforeEach(() => {
    vi.mocked(resolveOwnerOrgForUpload).mockResolvedValue({
      ok: true, ownerOrgId: 'org-a',
    } as never)
  })

  it('calls the hand-back with the uploading contact and the file trigger', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_ngaire', orgId: 'org_clerk_a',
    } as never)
    const { handle } = makeDb([[CONTACT], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await CONFIRM(req(payload))
    expect(res.status).toBe(201)
    expect(vi.mocked(handBackOnClientAction)).toHaveBeenCalledWith(
      expect.anything(),
      {
        requestId: 'req-1',
        contactId: 'contact-1',
        contactName: 'Ngaire Hutchins',
        trigger: 'file_uploaded',
      },
    )
  })

  it('does NOT hand back when the STUDIO uploads to the same request', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_liam', orgId: 'org_tahi',
    } as never)
    const { handle } = makeDb([[{ id: 'tm-1' }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await CONFIRM(req({ ...payload, orgId: 'org-a' }))
    expect(res.status).toBe(201)
    expect(vi.mocked(handBackOnClientAction)).not.toHaveBeenCalled()
  })

  it('does not hand back an upload that is not attached to a request', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_ngaire', orgId: 'org_clerk_a',
    } as never)
    const { handle } = makeDb([[CONTACT], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const { requestId: _omitted, ...noRequest } = payload
    const res = await CONFIRM(req(noRequest))
    expect(res.status).toBe(201)
    expect(vi.mocked(handBackOnClientAction)).not.toHaveBeenCalled()
  })
})
