/**
 * POST /api/admin/emails/preview - the design-check mail cannon.
 *
 * Four things have to hold or this endpoint is a liability rather than a tool:
 *
 *   1. SUPER ADMIN ONLY. A Tahi-org login is not enough, and the MCP service
 *      token (which resolves to `admin`) is not enough. Anything that fires the
 *      whole template set on one call has to be held to the same bar as the
 *      data export it sits next to.
 *   2. NEVER A CLIENT'S INBOX. The samples name a plausible client, quote a
 *      plausible invoice and read like real work, so one typo in `to` would put
 *      a fake overdue notice in a real client's mailbox. The `@tahi.studio`
 *      suffix check is what makes that impossible, and it is checked BEFORE
 *      anything is sent.
 *   3. THE FULL SET, PREFIXED, AS PRODUCTION SENDS IT. Every registered variant
 *      goes out, each subject carries `[PREVIEW]`, each message carries the
 *      text alternative the wired notification sends carry, and one refused
 *      send is reported without stopping the rest.
 *   4. THE REPORT IS TRUE. The `from` it names is the one lib/email.ts sends
 *      as, and a malformed `only` is reported rather than thrown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn(),
}))

// The real `emailFromAddress` is kept: the route reports the from address so a
// preview that landed in spam can be traced, and a stub here would let that
// report drift from what lib/email.ts actually sends as.
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn(),
}))

const captured: { selectRows: unknown[][] } = { selectRows: [] }

vi.mock('@/lib/db', () => {
  const answer = () =>
    Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => answer())
  return { db: vi.fn().mockResolvedValue({ select: vi.fn(() => chain) }) }
})

import { POST } from '@/app/api/admin/emails/preview/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { sendEmail } from '@/lib/email'
import { clerkClient } from '@clerk/nextjs/server'
import { EMAIL_PREVIEW_KEYS } from '@/lib/email-previews'

const LIAM = 'business@tahi.studio'

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/emails/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function access(isSuperAdmin: boolean): ResolvedAccess {
  return { isSuperAdmin, isAdmin: true, level: isSuperAdmin ? 'super_admin' : 'admin' } as
    unknown as ResolvedAccess
}

interface PreviewResponse {
  error?: string
  sent?: { key: string; template: string; liveSender: boolean; subject: string }[]
  failed?: { key: string; error: string }[]
  from?: string
}

/**
 * The route paces its sends to stay under Resend's two-a-second limit, so a
 * full run sleeps for ten real seconds. Drive the clock instead: advance fake
 * timers in slices, flushing microtasks each time, until the handler settles.
 */
async function runFast(promise: Promise<Response>): Promise<Response> {
  vi.useFakeTimers()
  try {
    let settled = false
    promise.then(
      () => { settled = true },
      () => { settled = true },
    )
    for (let i = 0; i < 200 && !settled; i += 1) {
      await vi.advanceTimersByTimeAsync(1000)
    }
    return await promise
  } finally {
    vi.useRealTimers()
  }
}

describe('POST /api/admin/emails/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    process.env.NEXT_PUBLIC_APP_URL = 'https://portal.tahi.studio'
    process.env.RESEND_FROM_EMAIL = 'Tahi Studio <business@tahi.studio>'
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_liam', orgId: 'org_tahi', sessionId: 'sess_1',
    })
    vi.mocked(resolvePermissions).mockResolvedValue(access(true))
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
    // The roster row is the first (and only) select the route makes.
    captured.selectRows = [[{ name: 'Liam Miller', email: LIAM }]]
  })

  // ── The gate ──────────────────────────────────────────────────────────────

  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_client', orgId: 'org_client', sessionId: 'sess_2',
    })

    const res = await POST(makeRequest({}))

    expect(res.status).toBe(403)
    expect(sendEmail).not.toHaveBeenCalled()
    // The gate must fail before any work: no D1 handle, no permission resolve.
    expect(resolvePermissions).not.toHaveBeenCalled()
  })

  it('refuses a Tahi admin who is not a super admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(access(false))

    const res = await POST(makeRequest({}))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(403)
    expect(json.error).toBe('Forbidden')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses the MCP service token, which resolves to admin and not super admin', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'api-service', orgId: 'org_tahi', sessionId: null,
    })
    vi.mocked(resolvePermissions).mockResolvedValue(access(false))

    const res = await POST(makeRequest({}))

    expect(res.status).toBe(403)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  // ── The domain refusal ────────────────────────────────────────────────────

  it('refuses an address outside @tahi.studio, before sending anything', async () => {
    const res = await POST(makeRequest({ to: 'ngaire@mahanaorchards.co.nz' }))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(400)
    expect(json.error).toContain('@tahi.studio')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses a lookalike domain that merely contains tahi.studio', async () => {
    const res = await POST(makeRequest({ to: 'liam@tahi.studio.evil.com' }))

    expect(res.status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses when the caller has no resolvable address and none was given', async () => {
    captured.selectRows = [[]]
    vi.mocked(clerkClient).mockRejectedValue(new Error('no clerk in tests'))

    const res = await POST(makeRequest({}))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(400)
    expect(json.error).toContain('No address')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('accepts a @tahi.studio address in any case', async () => {
    const res = await runFast(POST(makeRequest({ to: 'Staci@Tahi.Studio', only: ['welcome'] })))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(200)
    expect(json.sent).toHaveLength(1)
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toBe('Staci@Tahi.Studio')
  })

  // ── The happy path ────────────────────────────────────────────────────────

  it('sends every registered template to the caller, each subject prefixed', async () => {
    const res = await runFast(POST(makeRequest({})))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(200)
    expect(json.failed).toEqual([])
    expect(json.sent?.map((s) => s.key)).toEqual([...EMAIL_PREVIEW_KEYS])
    expect(json.from).toBe('Tahi Studio <business@tahi.studio>')

    const calls = vi.mocked(sendEmail).mock.calls
    expect(calls).toHaveLength(EMAIL_PREVIEW_KEYS.length)
    for (const [to, subject, react] of calls) {
      expect(to).toBe(LIAM)
      expect(subject.startsWith('[PREVIEW] ')).toBe(true)
      expect(react).toBeTruthy()
    }
    // The reported subject is the REAL one, not the prefixed one, so a reader
    // can compare it against the send path.
    for (const entry of json.sent ?? []) {
      expect(entry.subject.startsWith('[PREVIEW]')).toBe(false)
    }
  })

  it('greets the caller by their roster name', async () => {
    await runFast(POST(makeRequest({ only: ['welcome'] })))

    const [, subject] = vi.mocked(sendEmail).mock.calls[0]
    expect(subject).toBe('[PREVIEW] Welcome to Tahi Studio, Liam')
  })

  it('falls back to Clerk when the login has no roster row', async () => {
    captured.selectRows = [[]]
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          primaryEmailAddressId: 'idn_1',
          emailAddresses: [{ id: 'idn_1', emailAddress: 'staci@tahi.studio' }],
          firstName: 'Staci',
          lastName: 'Bonnie',
        }),
      },
    } as unknown as Awaited<ReturnType<typeof clerkClient>>)

    const res = await runFast(POST(makeRequest({ only: ['welcome'] })))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(200)
    expect(json.sent).toHaveLength(1)
    const [to, subject] = vi.mocked(sendEmail).mock.calls[0]
    expect(to).toBe('staci@tahi.studio')
    expect(subject).toBe('[PREVIEW] Welcome to Tahi Studio, Staci')
  })

  // ── Selection and partial failure ─────────────────────────────────────────

  it('reports the from address lib/email.ts actually sends as', async () => {
    // With nothing configured the send leaves as the branded lockup, so a bare
    // 'business@tahi.studio' in this field would send a reviewer hunting for a
    // sender that never appeared in their headers.
    delete process.env.RESEND_FROM_EMAIL

    const res = await runFast(POST(makeRequest({ only: ['welcome'] })))
    const json = (await res.json()) as PreviewResponse

    expect(json.from).toBe('Tahi Studio <business@tahi.studio>')
  })

  it('reports the template and whether anything sends it live', async () => {
    const res = await runFast(
      POST(makeRequest({ only: ['new-message-studio', 'review-request'] })),
    )
    const json = (await res.json()) as PreviewResponse

    expect(json.sent).toEqual([
      {
        key: 'new-message-studio',
        template: 'new-message',
        liveSender: true,
        subject: expect.stringContaining('New client message on'),
      },
      {
        key: 'review-request',
        template: 'review-request',
        liveSender: false,
        subject: expect.any(String),
      },
    ])
  })

  it('sends the plain text alternative alongside the HTML', async () => {
    await runFast(POST(makeRequest({ only: ['welcome'] })))

    const [, , , text] = vi.mocked(sendEmail).mock.calls[0]
    expect(typeof text).toBe('string')
    expect(text).toContain('Mahana Orchards')
    expect(text).not.toContain('<html')
  })

  it('sends only the requested keys, and names an unknown one', async () => {
    const res = await runFast(
      POST(makeRequest({ only: ['invoice-sent', 'welcome', 'not-a-template'] })),
    )
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(200)
    expect(json.sent?.map((s) => s.key)).toEqual(['invoice-sent', 'welcome'])
    expect(json.failed).toEqual([{ key: 'not-a-template', error: 'Unknown template key' }])
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it('reports a repeated key once and sends it once', async () => {
    const res = await runFast(POST(makeRequest({ only: ['welcome', 'welcome', 'nope', 'nope'] })))
    const json = (await res.json()) as PreviewResponse

    expect(json.sent?.map((s) => s.key)).toEqual(['welcome'])
    expect(json.failed).toEqual([{ key: 'nope', error: 'Unknown template key' }])
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('reports a non-string key rather than throwing out of the handler', async () => {
    // `only` is parsed JSON, so a mistyped console call can put anything in it.
    // The report this route already knows how to produce beats an opaque 500.
    const res = await runFast(POST(makeRequest({ only: [1, null, 'welcome'] })))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(200)
    expect(json.failed).toEqual([
      { key: '1', error: 'Template key must be a string' },
      { key: 'null', error: 'Template key must be a string' },
    ])
    expect(json.sent?.map((s) => s.key)).toEqual(['welcome'])
  })

  it('reports a refused send and keeps going', async () => {
    vi.mocked(sendEmail)
      .mockResolvedValueOnce({ success: false, error: 'Domain not verified' })
      .mockResolvedValue({ success: true })

    const res = await runFast(POST(makeRequest({ only: ['invoice-sent', 'welcome'] })))
    const json = (await res.json()) as PreviewResponse

    expect(res.status).toBe(200)
    expect(json.failed).toEqual([{ key: 'invoice-sent', error: 'Domain not verified' }])
    expect(json.sent?.map((s) => s.key)).toEqual(['welcome'])
  })

  it('retries a rate-limited send once', async () => {
    vi.mocked(sendEmail)
      .mockResolvedValueOnce({ success: false, error: 'Too many requests (429)' })
      .mockResolvedValue({ success: true })

    const res = await runFast(POST(makeRequest({ only: ['welcome'] })))
    const json = (await res.json()) as PreviewResponse

    expect(json.sent?.map((s) => s.key)).toEqual(['welcome'])
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})
