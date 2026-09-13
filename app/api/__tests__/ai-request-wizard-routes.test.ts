/**
 * The two AI request wizards, on the paths where the model does not answer.
 *
 * Both routes used to swallow every failure (no key, a thrown call, empty
 * text, a 429) into a 200 carrying a draft built by regex from the user's own
 * words, so nobody, admin or client, learned the model was never reached.
 * They now say so: 502 for an unreachable model, 429 for a busy one, and a
 * `degraded` flag on the keyword answer when there is no key at all.
 *
 * The portal route also carries the per-user daily turn cap, since a client
 * looping the wizard is otherwise invisible spend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMessage = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMessage }
  },
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_1', orgId: 'org_caller', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

const settingsRows: Array<{ value: string | null }> = []
const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) })

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(settingsRows) }) }),
    }),
    insert: () => ({ values: insertValues }),
  }),
}))

vi.mock('@/db/d1', () => ({
  schema: { settings: { key: 'key', value: 'value' } },
}))

vi.mock('drizzle-orm', () => ({ eq: (a: unknown, b: unknown) => ({ a, b }) }))

// The portal wizard now refuses a client whose org is denied Requests. That
// gate is covered end to end in portal-feature-visibility.test.ts; stub it here
// so these spend/limit tests keep their minimal settings-only schema mock.
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

// The admin route now gates its client-context lookup on team member access
// scoping (CLAUDE.md rule 11). Mocked here rather than driven through the
// minimal settings-only db mock above: the real resolveAccessScoping chain
// has its own coverage in admin-requests-scoping.test.ts, and the loader this
// gates has its own in lib/ai-request-org-context.test.ts.
vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

// CLIENT_HISTORY_PROMPT_RULES is left at its real value (importOriginal):
// the coverage-gap tests below assert this rule is actually in the system
// prompt sent to the model, which would pass for the wrong reason against a
// stubbed string that drifted from the real one. Only the DB-backed loader
// is replaced.
vi.mock('@/lib/ai-request-org-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai-request-org-context')>()
  return {
    ...actual,
    loadRequestOrgContext: vi.fn().mockResolvedValue(''),
  }
})

import { POST as adminPost } from '@/app/api/admin/ai/request-wizard/route'
import { POST as portalPost } from '@/app/api/portal/ai/request-wizard/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { requireAccessToOrg } from '@/lib/require-access'
import { loadRequestOrgContext } from '@/lib/ai-request-org-context'

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Redesign the hero' }], context: {} }),
  })
}

function anthropicError(status: number): Error & { status: number } {
  return Object.assign(new Error('boom'), { status })
}

/** A wizard turn that names a client org, the shape the panel sends once a
 *  client has been picked. */
function makeRequestWithOrgId(orgId: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/ai/request-wizard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Redesign the hero' }],
      context: { orgId },
    }),
  })
}

function asAdmin() {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi', sessionId: 's' })
}

function asClient() {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client', sessionId: 's' })
}

/** The UTC day the routes key their counter on. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** What a stored counter row looks like on disk. */
function counterRow(count: number, day = today()) {
  return { value: JSON.stringify({ day, count }) }
}

/** The single settings write a turn makes, parsed back. */
function writtenCounter(): { key: string; day: string; count: number } {
  const row = insertValues.mock.calls[0][0] as { key: string; value: string }
  const parsed = JSON.parse(row.value) as { day: string; count: number }
  return { key: row.key, ...parsed }
}

beforeEach(() => {
  vi.clearAllMocks()
  settingsRows.length = 0
  insertValues.mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) })
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  process.env.ANTHROPIC_API_KEY = 'sk-test'
})

describe('POST /api/admin/ai/request-wizard', () => {
  it('502s when the model call throws rather than faking a draft', async () => {
    asAdmin()
    createMessage.mockRejectedValueOnce(anthropicError(500))
    const res = await adminPost(makeRequest('/api/admin/ai/request-wizard'))
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string; reason: string }
    expect(body.reason).toBe('ai_unavailable')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('502s on empty model text', async () => {
    asAdmin()
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: '' }] })
    const res = await adminPost(makeRequest('/api/admin/ai/request-wizard'))
    expect(res.status).toBe(502)
  })

  it('passes a rate limit through as 429', async () => {
    asAdmin()
    createMessage.mockRejectedValueOnce(anthropicError(429))
    const res = await adminPost(makeRequest('/api/admin/ai/request-wizard'))
    expect(res.status).toBe(429)
    expect((await res.json() as { reason: string }).reason).toBe('ai_rate_limited')
  })

  it('labels the keyword answer as degraded when no key is configured', async () => {
    asAdmin()
    delete process.env.ANTHROPIC_API_KEY
    const res = await adminPost(makeRequest('/api/admin/ai/request-wizard'))
    expect(res.status).toBe(200)
    const body = await res.json() as { degraded?: boolean; reason?: string }
    expect(body.degraded).toBe(true)
    expect(body.reason).toBe('ai_unavailable')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('503s instead in production, so a deploy that lost the key shows in the logs', async () => {
    asAdmin()
    delete process.env.ANTHROPIC_API_KEY
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const res = await adminPost(makeRequest('/api/admin/ai/request-wizard'))
      expect(res.status).toBe(503)
      expect((await res.json() as { reason: string }).reason).toBe('ai_unavailable')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('returns the model reply untouched on the happy path', async () => {
    asAdmin()
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'What page is it on?' }] })
    const res = await adminPost(makeRequest('/api/admin/ai/request-wizard'))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string; done: boolean; degraded?: boolean }
    expect(body.reply).toBe('What page is it on?')
    expect(body.done).toBe(false)
    expect(body.degraded).toBeUndefined()
  })

  // GI.4 step one: the wizard learns the client deeply. The rule is static
  // (lib/ai-request-org-context.ts CLIENT_HISTORY_PROMPT_RULES), so it is
  // always in the system prompt sent to the model, whether or not this turn
  // actually carries a CLIENT HISTORY block.
  it('always tells the model to answer coverage-gap questions from CLIENT HISTORY, then keep drafting', async () => {
    asAdmin()
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Sure thing' }] })
    await adminPost(makeRequest('/api/admin/ai/request-wizard'))
    const [[sentPayload]] = createMessage.mock.calls
    const system = (sentPayload as { system: string }).system
    expect(system).toContain('CLIENT HISTORY')
    expect(system).toContain('coverage gaps')
    expect(system).toContain('two sentences')
  })

  // CLAUDE.md rule 11: this route returns client details (org name, industry,
  // website, brands, recent request titles) once context.orgId is supplied.
  // Without a scope check a team member restricted to specific clients could
  // name any org id here and have another client's details woven into the
  // reply.
  describe('client context scoping', () => {
    it('loads org context for a team member scoped to that client', async () => {
      vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_scoped', orgId: 'org_tahi', sessionId: 's' })
      vi.mocked(requireAccessToOrg).mockResolvedValueOnce(null)
      vi.mocked(loadRequestOrgContext).mockResolvedValueOnce('CLIENT ON FILE: Acme Co')
      createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Which page?' }] })

      const res = await adminPost(makeRequestWithOrgId('org-acme'))
      expect(res.status).toBe(200)
      expect(vi.mocked(requireAccessToOrg)).toHaveBeenCalledWith(expect.anything(), 'user_scoped', 'org-acme')
      expect(vi.mocked(loadRequestOrgContext)).toHaveBeenCalledWith(expect.anything(), 'org-acme')
      const [[sentPayload]] = createMessage.mock.calls
      expect((sentPayload as { system: string }).system).toContain('CLIENT ON FILE: Acme Co')
    })

    it('403s and never loads org context or calls the model when the org is out of scope', async () => {
      vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_scoped', orgId: 'org_tahi', sessionId: 's' })
      vi.mocked(requireAccessToOrg).mockResolvedValueOnce(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      )

      const res = await adminPost(makeRequestWithOrgId('org-other'))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
      expect(vi.mocked(loadRequestOrgContext)).not.toHaveBeenCalled()
      expect(createMessage).not.toHaveBeenCalled()
    })

    it('always loads context for the Tahi admin, since scoping bypasses admins', async () => {
      asAdmin()
      vi.mocked(requireAccessToOrg).mockResolvedValueOnce(null)
      vi.mocked(loadRequestOrgContext).mockResolvedValueOnce('CLIENT ON FILE: Acme Co')
      createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Which page?' }] })

      const res = await adminPost(makeRequestWithOrgId('org-acme'))
      expect(res.status).toBe(200)
      expect(vi.mocked(requireAccessToOrg)).toHaveBeenCalledWith(expect.anything(), 'user_1', 'org-acme')
      expect(vi.mocked(loadRequestOrgContext)).toHaveBeenCalledWith(expect.anything(), 'org-acme')
    })
  })
})

describe('POST /api/portal/ai/request-wizard', () => {
  it('always tells the model to answer coverage-gap questions from CLIENT HISTORY, then keep drafting', async () => {
    asClient()
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Sure thing' }] })
    await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    const [[sentPayload]] = createMessage.mock.calls
    const system = (sentPayload as { system: string }).system
    expect(system).toContain('CLIENT HISTORY')
    expect(system).toContain('coverage gaps')
    expect(system).toContain('two sentences')
  })

  it('502s when the model call throws, on the client-facing route too', async () => {
    asClient()
    createMessage.mockRejectedValueOnce(anthropicError(500))
    const res = await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(res.status).toBe(502)
    expect((await res.json() as { reason: string }).reason).toBe('ai_unavailable')
  })

  it('counts a turn against the caller once the model has answered', async () => {
    asClient()
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Which pages?' }] })
    const res = await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(res.status).toBe(200)
    const written = writtenCounter()
    // One row per user, not one per user per day: GET /api/admin/settings
    // flattens every row with no key filter, so a key per day grows forever.
    expect(written.key).toBe('ai_wizard_turns:user_client')
    expect(written.day).toBe(today())
    expect(written.count).toBe(1)
  })

  it('spends nothing on a turn the model never answered', async () => {
    asClient()
    createMessage.mockRejectedValueOnce(anthropicError(500))
    const res = await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(res.status).toBe(502)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('spends nothing when the upstream rate limits the call', async () => {
    asClient()
    createMessage.mockRejectedValueOnce(anthropicError(429))
    const res = await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(res.status).toBe(429)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('429s once the caller is over the daily cap, with no model call', async () => {
    asClient()
    settingsRows.push(counterRow(40))
    const res = await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(res.status).toBe(429)
    expect((await res.json() as { reason: string }).reason).toBe('ai_daily_cap')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('keeps counting from the stored value rather than restarting', async () => {
    asClient()
    settingsRows.push(counterRow(7))
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Which pages?' }] })
    await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(writtenCounter().count).toBe(8)
  })

  it('reads a row from an earlier day as zero rather than as spend', async () => {
    asClient()
    settingsRows.push(counterRow(40, '2020-01-01'))
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Which pages?' }] })
    const res = await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(res.status).toBe(200)
    expect(writtenCounter()).toMatchObject({ day: today(), count: 1 })
  })

  it('treats a row it cannot parse as zero rather than locking the client out', async () => {
    asClient()
    settingsRows.push({ value: 'not json' })
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Which pages?' }] })
    expect((await portalPost(makeRequest('/api/portal/ai/request-wizard'))).status).toBe(200)
  })

  it('refuses the Tahi admin org: the portal wizard is for clients', async () => {
    asAdmin()
    const res = await portalPost(makeRequest('/api/portal/ai/request-wizard'))
    expect(res.status).toBe(403)
  })
})
