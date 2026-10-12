/**
 * POST /api/admin/conversations/[id]/messages: an internal note never
 * notifies a client contact through an @mention (security re-review L-C), and
 * a worker MCP call is authored by the person behind it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const inserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(async () => auth.current),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/app/api/admin/conversations/_access', () => ({
  requireConversationAccess: vi.fn(async () => ({
    ok: true,
    participantId: 'tm_participant',
    conversation: { id: 'c1', orgId: 'org_client', requestId: null, name: 'Client line' },
  })),
}))

vi.mock('@/lib/parse-mentions', () => ({
  parseMentions: vi.fn(() => [{ id: 'contact_1', type: 'contact' }]),
}))

vi.mock('@/lib/notifications', () => ({
  notifyMentionedPerson: vi.fn(async () => undefined),
  createNotifications: vi.fn(async () => ({ delivered: 0, skipped: 0 })),
  resolveParticipants: vi.fn(async () => []),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  const self = () => builder
  for (const key of ['from', 'where', 'limit', 'orderBy', 'set']) builder[key] = self
  builder.then = (resolve: (v: unknown) => void) => resolve(result)
  return builder
}

vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => ({
    select: () => chain([]),
    update: () => chain(undefined),
    insert: () => ({
      values: (row: Record<string, unknown> | Record<string, unknown>[]) => {
        inserted.rows.push(...(Array.isArray(row) ? row : [row]))
        return Promise.resolve()
      },
    }),
  })),
}))

import { POST } from '@/app/api/admin/conversations/[id]/messages/route'
import { notifyMentionedPerson } from '@/lib/notifications'

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest('https://x/api/admin/conversations/c1/messages', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'c1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  inserted.rows = []
  auth.current = { userId: 'user_liam', orgId: 'org_tahi', sessionId: 's1' }
})

describe('mentions on a conversation message', () => {
  it('never lets an internal note notify a client contact', async () => {
    const res = await post({ body: 'Heads up @contact', isInternal: true })
    expect(res.status).toBe(201)
    expect(vi.mocked(notifyMentionedPerson).mock.calls[0][1].allowContacts).toBe(false)
  })

  it('lets a client-visible message notify the mentioned contact as before', async () => {
    await post({ body: 'Hi @contact' })
    expect(vi.mocked(notifyMentionedPerson).mock.calls[0][1].allowContacts).toBe(true)
  })
})

describe('authorship', () => {
  it('records the MCP person, not the service participant', async () => {
    auth.current = {
      userId: 'api-service', orgId: 'org_tahi', sessionId: null,
      mcpActor: { teamMemberId: 'tm_staci', clerkUserId: 'user_staci', profile: 'designer' },
    }
    await post({ body: 'Internal note', isInternal: true })
    const message = inserted.rows.find((row) => row.body === 'Internal note')
    expect(message?.authorId).toBe('tm_staci')
  })

  it('keeps the participant as author without an actor', async () => {
    await post({ body: 'From the dashboard' })
    const message = inserted.rows.find((row) => row.body === 'From the dashboard')
    expect(message?.authorId).toBe('tm_participant')
  })
})
