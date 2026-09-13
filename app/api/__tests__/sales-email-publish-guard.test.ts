/**
 * POST /api/admin/proposals/[id]/email and POST /api/admin/schedules/[id]/email.
 *
 * Sharing a proposal or schedule now takes a first snapshot (see
 * proposal-share-snapshot.test.ts and schedule-share-snapshot.test.ts), but
 * that snapshot can still be null on a row that was shared before this
 * change shipped, or (for a schedule) revoked and never re-shared. Emailing
 * the public link in that state mails a link that serves nothing: the
 * public viewer reads publishedSnapshot only and 404s without one. Both
 * routes now refuse with 400 rather than mailing a dead link, alongside the
 * existing "share it first" guard for a missing token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const queue: Row[][] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/app/api/admin/_sales-access/artifact-scope', () => ({
  requireProposalAccess: async () => null,
  requireScheduleAccess: async () => null,
}))

vi.mock('@/db/d1', () => ({
  schema: new Proxy({}, {
    get: (_t, table: string) => new Proxy({}, { get: (_x, col: string) => `${table}.${col}` }),
  }),
}))

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }))

function chain(): Record<string, unknown> {
  const b: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'limit']) b[key] = () => b
  b.then = (resolve: (rows: Row[]) => void) => resolve(queue.shift() ?? [])
  return b
}

vi.mock('@/lib/db', () => ({
  db: async () => ({ select: () => chain() }),
}))

vi.mock('@react-email/render', () => ({ render: async () => '<html></html>' }))
vi.mock('@/emails/proposal-share', () => ({ ProposalShareEmail: () => null }))
vi.mock('@/emails/schedule-share', () => ({ ScheduleShareEmail: () => null }))

vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: async () => ({ success: true, suppressed: [] }),
  partitionRecipients: () => ({ allowed: [], suppressed: [] }),
  recordEmailSuppressions: async () => {},
  resolveDeliveryPolicy: async () => ({}),
  resolveOrgRecipientScope: async () => ({}),
}))

const { POST: postProposalEmail } = await import('../admin/proposals/[id]/email/route')
const { POST: postScheduleEmail } = await import('../admin/schedules/[id]/email/route')

const params = { params: Promise.resolve({ id: 'a1' }) }
function req(body: unknown) {
  return new Request('http://localhost/api/x/a1/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const recipients = { to: [{ name: 'Client', email: 'client@example.com' }] }

describe('POST .../proposals/[id]/email publish guard', () => {
  beforeEach(() => { queue.length = 0 })

  it('400s when the proposal has a token but no published snapshot', async () => {
    queue.push([{
      id: 'a1', orgId: 'org_client', title: 'Website build', subtitle: null,
      expiresAt: null, status: 'shared', token: 'tok', publishedSnapshot: null,
    }])
    const res = await postProposalEmail(req(recipients) as never, params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Publish the proposal before emailing the link.',
    })
  })

  it('still 400s when there is no token at all (existing guard, unchanged)', async () => {
    queue.push([{
      id: 'a1', orgId: 'org_client', title: 'Website build', subtitle: null,
      expiresAt: null, status: 'draft', token: null, publishedSnapshot: null,
    }])
    const res = await postProposalEmail(req(recipients) as never, params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Share the proposal first to mint a public link.',
    })
  })

  it('proceeds once a published snapshot exists', async () => {
    queue.push([{
      id: 'a1', orgId: 'org_client', title: 'Website build', subtitle: null,
      expiresAt: null, status: 'shared', token: 'tok',
      publishedSnapshot: '{"proposal":{"title":"Website build"}}',
    }])
    const res = await postProposalEmail(req(recipients) as never, params)
    expect(res.status).toBe(200)
    const body = await res.json() as { sent: string[] }
    expect(body.sent).toEqual(['client@example.com'])
  })
})

describe('POST .../schedules/[id]/email publish guard', () => {
  beforeEach(() => { queue.length = 0 })

  it('400s when the schedule has a token but no published snapshot', async () => {
    queue.push([{
      id: 'a1', orgId: 'org_client', title: 'Website build', subtitle: null,
      targetLaunchDate: null, token: 'tok', publishedSnapshot: null,
    }])
    const res = await postScheduleEmail(req(recipients) as never, params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Publish the schedule before emailing the link.',
    })
  })

  it('still 400s when there is no token at all (existing guard, unchanged)', async () => {
    queue.push([{
      id: 'a1', orgId: 'org_client', title: 'Website build', subtitle: null,
      targetLaunchDate: null, token: null, publishedSnapshot: null,
    }])
    const res = await postScheduleEmail(req(recipients) as never, params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Share the schedule first to mint a public link.',
    })
  })

  it('proceeds once a published snapshot exists', async () => {
    queue.push([{
      id: 'a1', orgId: 'org_client', title: 'Website build', subtitle: null,
      targetLaunchDate: null, token: 'tok',
      publishedSnapshot: '{"schedule":{"title":"Website build"}}',
    }])
    const res = await postScheduleEmail(req(recipients) as never, params)
    expect(res.status).toBe(200)
    const body = await res.json() as { sent: string[] }
    expect(body.sent).toEqual(['client@example.com'])
  })
})
