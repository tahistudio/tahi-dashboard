/**
 * POST /api/admin/clients - the invite the dialog promises, and the owner role.
 *
 * The dialog has always said "we email them an invite link", and the route did
 * neither: no email, no token, and the first contact was left on the 'member'
 * default so the owner was refused on their own workspace. These tests pin the
 * fixed contract:
 *   - the primary contact is created as the workspace admin,
 *   - a tokened invite is minted and emailed,
 *   - the response reports the real outcome so the toast can tell the truth,
 *   - an invite or Resend failure never loses the client that was just created,
 *   - no contact email means no invite, and the six-field create still works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: { inserts: Record<string, unknown>[] } = { inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: vi.fn().mockResolvedValue(null),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, ne: stub, like: stub, desc: stub, inArray: stub, sql: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations', id: 'id' },
    contacts: { __table: 'contacts', id: 'id' },
    subscriptions: { __table: 'subscriptions', id: 'id' },
    tracks: { __table: 'tracks', id: 'id' },
    kanbanColumns: { __table: 'kanban_columns', id: 'id' },
    onboardingInvites: { __table: 'onboarding_invites', id: 'id' },
    requests: { __table: 'requests', orgId: 'org_id', status: 'status' },
  },
}))

vi.mock('@/lib/db', () => {
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: Record<string, unknown>) => {
          captured.inserts.push({ __table: tableName(table), ...row })
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

import { POST } from '@/app/api/admin/clients/route'
import { NextRequest } from 'next/server'
import { sendEmail } from '@/lib/email'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type InviteOutcome = { email: string; link: string; emailed: boolean; error?: string } | null

const rows = (table: string) => captured.inserts.filter(r => r.__table === table)

describe('POST /api/admin/clients invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.inserts = []
    process.env.NEXT_PUBLIC_APP_URL = 'https://portal.tahi.studio'
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
  })

  it('creates the primary contact as the workspace admin and emails a tokened invite', async () => {
    const res = await POST(makeRequest({
      name: 'Acme Corp',
      planType: 'maintain',
      primaryContactName: 'Jane Smith',
      primaryContactEmail: 'Jane@Acme.com',
    }))
    expect(res.status).toBe(201)
    const json = await res.json() as { id: string; invite: InviteOutcome }

    const contacts = rows('contacts')
    expect(contacts).toHaveLength(1)
    expect(contacts[0].portalRole).toBe('admin')
    expect(contacts[0].isPrimary).toBe(true)
    expect(contacts[0].email).toBe('jane@acme.com')

    const invites = rows('onboarding_invites')
    expect(invites).toHaveLength(1)
    expect(invites[0].contactEmail).toBe('jane@acme.com')
    // A retainer client is already engaged, so no payment step on their own
    // workspace.
    expect(invites[0].persona).toBe('existing_retainer')

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(json.invite?.emailed).toBe(true)
    expect(json.invite?.link).toContain(`/onboarding?token=${invites[0].token}`)
  })

  it('uses the project persona for a client with no retainer', async () => {
    await POST(makeRequest({
      name: 'One Off Ltd',
      primaryContactEmail: 'ops@oneoff.com',
    }))
    expect(rows('onboarding_invites')[0].persona).toBe('existing_project')
  })

  it('reports a failed send instead of swallowing it', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured' })

    const res = await POST(makeRequest({
      name: 'Acme Corp',
      primaryContactEmail: 'jane@acme.com',
    }))
    expect(res.status).toBe(201)
    const json = await res.json() as { invite: InviteOutcome }
    expect(json.invite?.emailed).toBe(false)
    expect(json.invite?.error).toContain('RESEND_API_KEY')
    // The link is still handed back so the operator can send it by hand.
    expect(json.invite?.link).toContain('/onboarding?token=')
  })

  it('honours sendInvite false by minting a link without emailing', async () => {
    const res = await POST(makeRequest({
      name: 'Acme Corp',
      primaryContactEmail: 'jane@acme.com',
      sendInvite: false,
    }))
    const json = await res.json() as { invite: InviteOutcome }
    expect(sendEmail).not.toHaveBeenCalled()
    expect(json.invite?.emailed).toBe(false)
    expect(rows('onboarding_invites')).toHaveLength(1)
  })

  it('still creates the client when the invite throws', async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error('resend exploded'))

    const res = await POST(makeRequest({
      name: 'Acme Corp',
      primaryContactEmail: 'jane@acme.com',
    }))
    expect(res.status).toBe(201)
    const json = await res.json() as { id: string; invite: InviteOutcome }
    expect(json.id).toBeTruthy()
    expect(json.invite?.emailed).toBe(false)
    expect(rows('organisations')).toHaveLength(1)
  })

  it('creates no invite when no contact email was given', async () => {
    const res = await POST(makeRequest({ name: 'Acme Corp' }))
    expect(res.status).toBe(201)
    const json = await res.json() as { invite: InviteOutcome }
    expect(json.invite).toBeNull()
    expect(rows('contacts')).toHaveLength(0)
    expect(rows('onboarding_invites')).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
