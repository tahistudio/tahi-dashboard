/**
 * POST /api/public/proposals/[token]/accept closes the loop (S2, T3.3).
 *
 * Before this, a prospect's accept/decline/question landed in the
 * proposal_acceptances table and nowhere else: the viewer promises "Liam
 * replies within one business day" and nothing told the studio a decision had
 * even happened. These tests drive the real route over a fake-D1 harness,
 * with the notification sink mocked (as portal-request-created-notify.test.ts
 * does) and the real email-plan builder, so the bell payload and the email
 * plan's subject/orgId are both pinned. A second describe block covers the
 * sibling GET route's `expired` flag, which the same slice adds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

interface CapturedWrite {
  table: unknown
  values: Record<string, unknown>
}

const state = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  insertCalls: [] as CapturedWrite[],
  updateCalls: [] as CapturedWrite[],
}))

vi.mock('@/lib/notifications', () => ({
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    proposals: {
      id: 'id', title: 'title', status: 'status', dealId: 'deal_id', orgId: 'org_id',
      expiresAt: 'expires_at', publishedSnapshot: 'published_snapshot',
      publicShareToken: 'public_share_token', decidedAt: 'decided_at',
      decidedVariantId: 'decided_variant_id', updatedAt: 'updated_at',
      subtitle: 'subtitle', preparedFor: 'prepared_for', preparedBy: 'prepared_by',
      effectiveDate: 'effective_date', publishedAt: 'published_at', coverTheme: 'cover_theme',
    },
    organisations: { id: 'id', name: 'name' },
    proposalVariants: {
      id: 'id', proposalId: 'proposal_id', name: 'name', tagline: 'tagline',
      oneOffAmount: 'one_off_amount', monthlyAmount: 'monthly_amount', currency: 'currency',
      scopeHtml: 'scope_html', pricingNotesHtml: 'pricing_notes_html',
      timelineScheduleId: 'timeline_schedule_id', ctaLabel: 'cta_label',
      isFeatured: 'is_featured', position: 'position',
    },
    proposalSections: {
      id: 'id', proposalId: 'proposal_id', type: 'type', title: 'title',
      subtitle: 'subtitle', data: 'data', themeMode: 'theme_mode', position: 'position',
    },
    proposalAcceptances: {
      id: 'id', proposalId: 'proposal_id', variantId: 'variant_id', status: 'status',
      acceptorName: 'acceptor_name', acceptorEmail: 'acceptor_email', acceptorRole: 'acceptor_role',
      comment: 'comment', acceptorIpHash: 'acceptor_ip_hash', acceptorCountry: 'acceptor_country',
      acceptorUa: 'acceptor_ua', acceptedAt: 'accepted_at', acceptedVariantName: 'accepted_variant_name',
      acceptedOneOffAmount: 'accepted_one_off_amount', acceptedMonthlyAmount: 'accepted_monthly_amount',
      acceptedCurrency: 'accepted_currency',
    },
    activities: {
      id: 'id', type: 'type', title: 'title', description: 'description', dealId: 'deal_id',
      orgId: 'org_id', createdById: 'created_by_id', completedAt: 'completed_at',
    },
  },
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, asc: stub }
})

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'leftJoin', 'where', 'orderBy']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.limit = vi.fn(() => Promise.resolve(
    state.selectQueue.length ? state.selectQueue.shift() : [],
  ))
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          state.insertCalls.push({ table, values })
          return Promise.resolve(undefined)
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(() => {
            state.updateCalls.push({ table, values })
            return Promise.resolve(undefined)
          }),
        })),
      })),
    }),
  }
})

import { POST } from '@/app/api/public/proposals/[token]/accept/route'
import { GET } from '@/app/api/public/proposals/[token]/route'
import { notifyAllAdmins } from '@/lib/notifications'
import { schema } from '@/db/d1'

const TOKEN = 'a'.repeat(32)
const URL = `http://localhost:3000/api/public/proposals/${TOKEN}/accept`

function ctxFor(token: string) {
  return { params: Promise.resolve({ token }) }
}

function callPost(body: Record<string, unknown>, token: string = TOKEN) {
  const req = new NextRequest(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, ctxFor(token))
}

function callGet() {
  const req = new NextRequest(`http://localhost:3000/api/public/proposals/${TOKEN}`)
  return GET(req, ctxFor(TOKEN))
}

interface ProposalRow {
  id: string
  title: string
  status: string
  dealId: string | null
  orgId: string | null
  expiresAt: string | null
  publishedSnapshot: string | null
  orgName: string | null
}

const SNAPSHOT_WITH_VARIANT = JSON.stringify({
  variants: [
    { id: 'var_1', name: 'Standard', oneOffAmount: 5000, monthlyAmount: null, currency: 'NZD' },
  ],
})

function seedProposal(overrides: Partial<ProposalRow> = {}) {
  const row: ProposalRow = {
    id: 'prop_1',
    title: 'Website revamp',
    status: 'shared',
    dealId: 'deal_1',
    orgId: 'org_1',
    expiresAt: null,
    publishedSnapshot: SNAPSHOT_WITH_VARIANT,
    orgName: 'Acme Ltd',
    ...overrides,
  }
  state.selectQueue = [[row]]
  return row
}

interface StudioPayload {
  type: string
  title: string
  body?: string | null
  entityType?: string | null
  entityId?: string | null
  email?: { subject: string; template: string; orgId: string | null }
}

function studioPayload(callIndex = 0): StudioPayload {
  const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[callIndex]
  return payload as unknown as StudioPayload
}

function acceptanceInsert(): CapturedWrite | undefined {
  return state.insertCalls.find((c) => c.table === schema.proposalAcceptances)
}

function activityInsert(): CapturedWrite | undefined {
  return state.insertCalls.find((c) => c.table === schema.activities)
}

function proposalUpdate(): CapturedWrite | undefined {
  return state.updateCalls.find((c) => c.table === schema.proposals)
}

describe('POST /api/public/proposals/[token]/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.selectQueue = []
    state.insertCalls = []
    state.updateCalls = []
  })

  it('freezes the snapshot price, decides the proposal, and tells the studio on accept', async () => {
    seedProposal()
    const res = await callPost({ status: 'accepted', variantId: 'var_1', acceptorName: 'Jo' })
    expect(res.status).toBe(200)

    // Only the one proposal lookup ran: the snapshot path never touches the
    // live proposalVariants table, so a price edited after sharing can never
    // leak into what this acceptance records.
    expect(state.selectQueue).toHaveLength(0)

    const acceptance = acceptanceInsert()
    expect(acceptance?.values.acceptedVariantName).toBe('Standard')
    expect(acceptance?.values.acceptedOneOffAmount).toBe(5000)
    expect(acceptance?.values.acceptedCurrency).toBe('NZD')

    expect(proposalUpdate()?.values).toMatchObject({ status: 'accepted', decidedVariantId: 'var_1' })

    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const payload = studioPayload()
    expect(payload.type).toBe('proposal_signed')
    expect(payload.entityType).toBe('proposal')
    expect(payload.entityId).toBe('prop_1')
    expect(payload.email?.subject).toBe('Acme Ltd accepted "Website revamp"')
    expect(payload.email?.orgId).toBe('org_1')

    expect(activityInsert()?.values).toMatchObject({ type: 'proposal_accepted', dealId: 'deal_1' })
  })

  it('declines without a variant, and carries its own bell + email copy', async () => {
    seedProposal()
    const res = await callPost({ status: 'declined' })
    expect(res.status).toBe(200)

    expect(proposalUpdate()?.values).toMatchObject({ status: 'declined', decidedVariantId: null })
    expect(studioPayload().type).toBe('proposal_declined')
    expect(studioPayload().email?.subject).toBe('Acme Ltd declined "Website revamp"')
    expect(activityInsert()?.values).toMatchObject({ type: 'proposal_declined' })
  })

  it('records a question without deciding the proposal, and requires a comment', async () => {
    seedProposal()
    const missing = await callPost({ status: 'question' })
    expect(missing.status).toBe(400)
    expect(notifyAllAdmins).not.toHaveBeenCalled()

    seedProposal()
    const res = await callPost({ status: 'question', comment: 'What is the turnaround?' })
    expect(res.status).toBe(200)

    // A question does not lock the proposal: only updatedAt moves.
    expect(proposalUpdate()?.values).toEqual({ updatedAt: expect.any(String) })
    expect(studioPayload().type).toBe('proposal_question')
    expect(studioPayload().body).toBe('What is the turnaround?')
    expect(activityInsert()?.values).toMatchObject({
      type: 'proposal_question',
      description: 'What is the turnaround?',
    })
  })

  it('refuses an already-expired proposal outright, with no writes', async () => {
    seedProposal({ status: 'expired' })
    const res = await callPost({ status: 'accepted', variantId: 'var_1' })
    expect(res.status).toBe(410)
    expect(state.insertCalls).toHaveLength(0)
    expect(state.updateCalls).toHaveLength(0)
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('flips a stale share to expired on the first attempt after the deadline, and still refuses it', async () => {
    seedProposal({ status: 'shared', expiresAt: '2020-01-01T00:00:00.000Z' })
    const res = await callPost({ status: 'accepted', variantId: 'var_1' })
    expect(res.status).toBe(410)
    expect(state.updateCalls).toEqual([
      { table: schema.proposals, values: { status: 'expired', updatedAt: expect.any(String) } },
    ])
    expect(state.insertCalls).toHaveLength(0)
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('refuses a decision on a proposal that already left the shared state', async () => {
    seedProposal({ status: 'accepted' })
    const res = await callPost({ status: 'declined' })
    expect(res.status).toBe(409)
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('rejects a variantId that exists live but not in the snapshot the client saw', async () => {
    seedProposal({
      publishedSnapshot: JSON.stringify({ variants: [{ id: 'var_other', name: 'Other', oneOffAmount: 1, monthlyAmount: null, currency: 'NZD' }] }),
    })
    const res = await callPost({ status: 'accepted', variantId: 'var_1' })
    expect(res.status).toBe(400)
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('falls back to the live variant table for a legacy proposal with no snapshot, and says so', async () => {
    seedProposal({ publishedSnapshot: null })
    state.selectQueue.push([
      { id: 'var_1', name: 'Legacy variant', oneOffAmount: 3000, monthlyAmount: null, currency: 'NZD' },
    ])
    const res = await callPost({ status: 'accepted', variantId: 'var_1' })
    expect(res.status).toBe(200)
    const json = await res.json() as { snapshotFallback?: boolean }
    expect(json.snapshotFallback).toBe(true)
    expect(acceptanceInsert()?.values.acceptedVariantName).toBe('Legacy variant')
  })

  it('skips the activity row when the proposal has no deal', async () => {
    seedProposal({ dealId: null })
    await callPost({ status: 'declined' })
    expect(activityInsert()).toBeUndefined()
  })

  it('404s a well-formed but unknown token', async () => {
    state.selectQueue = [[]]
    const res = await callPost({ status: 'declined' })
    expect(res.status).toBe(404)
  })

  it('404s a malformed token before touching the database', async () => {
    const res = await callPost({ status: 'declined' }, 'short')
    expect(res.status).toBe(404)
    expect(state.selectQueue).toHaveLength(0)
  })
})

describe('GET /api/public/proposals/[token], the expired flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.selectQueue = []
  })

  it('reads expired: false on a live, unexpired share', async () => {
    seedProposal()
    const res = await callGet()
    const json = await res.json() as { expired?: boolean }
    expect(json.expired).toBe(false)
  })

  it('reads expired: true once the deadline has passed, even before anyone has tried to accept', async () => {
    seedProposal({ expiresAt: '2020-01-01T00:00:00.000Z' })
    const res = await callGet()
    const json = await res.json() as { expired?: boolean }
    expect(json.expired).toBe(true)
  })

  it('reads expired: false on a decided proposal even past its own deadline', async () => {
    seedProposal({ status: 'accepted', expiresAt: '2020-01-01T00:00:00.000Z' })
    const res = await callGet()
    const json = await res.json() as { expired?: boolean }
    expect(json.expired).toBe(false)
  })
})
