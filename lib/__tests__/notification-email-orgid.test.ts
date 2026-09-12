/**
 * The delivery CONTEXT a notification email carries, end to end.
 *
 * lib/__tests__/notification-email.test.ts pins who an email can reach and
 * what it says. This file pins the one thing that decided whether any of it
 * arrived: every send from lib/notification-email.ts used to reach the door in
 * lib/email-delivery.ts with no context at all, so the gate saw
 * `template: 'unspecified', orgId: null` on every thread reply, every "ready
 * for your review", every "delivered" and every org standing-line message. The
 * per-client exemption in `email.allowedOrgIds` names an ORG, so with a null
 * org id it could never match: a client stayed silently unreachable no matter
 * what the studio put in the setting, and the suppression log could not say
 * which template had gone missing. Two rows in production proved it.
 *
 * So the three things asserted here are the three that were broken:
 *
 *   1. A client-audience plan reaches `deliverEmail` with a real org id and a
 *      real kebab-case template name.
 *   2. A rate limited retry carries the SAME context on the second attempt. A
 *      retry judged by a different rule than the first try is a difference
 *      nobody would ever see until a client stopped hearing from us.
 *   3. An allowlisted org id reaches `resolveOrgRecipientScope` and actually
 *      widens the gate for that client's own contact, through the REAL rule:
 *      only the Resend SDK and D1 are stood in for here.
 *
 * Nothing in this file names a real client. The org ids and addresses are
 * fictional on purpose, and the Resend client is a spy, so no run of this
 * suite can put a message in anybody's inbox.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  dispatchNotificationEmails,
  threadReplyEmailPlan,
  type EmailTarget,
} from '@/lib/notification-email'

// ─── The fixtures the fakes read ─────────────────────────────────────────────

interface SettingRow {
  key: string
  value: string | null
}

/** Everything the two mocked modules answer with, per test. */
const state = vi.hoisted(() => ({
  settings: [] as { key: string; value: string | null }[],
  contacts: [] as { email: string | null }[],
  suppressed: [] as Record<string, unknown>[],
}))

// ─── Resend: stood in for, never reached ─────────────────────────────────────

const resendSend = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: resendSend } })),
}))

// ─── D1: stood in for, because vitest has no binding ─────────────────────────
//
// The two reads the gate makes are told apart by the columns they ask for
// (`key` for settings, `email` for contacts) rather than by table identity, so
// this fake needs no schema import and cannot go stale against one.

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: (columns?: Record<string, unknown>) => ({
      from: () => {
        const rows = Object.keys(columns ?? {}).includes('key')
          ? state.settings
          : state.contacts
        const chain = Promise.resolve(rows) as Promise<unknown[]> & {
          where: () => typeof chain
        }
        chain.where = () => chain
        return chain
      },
    }),
    insert: () => ({
      values: async (rows: Record<string, unknown>[]) => {
        state.suppressed.push(...rows)
      },
    }),
  }),
}))

// ─── The gate: REAL, with one call-through spy on it ─────────────────────────
//
// Spied rather than replaced. The question is whether the org id arrives, and
// a stub that answered for the rule would pass while the rule itself was never
// consulted, which is the exact shape of the bug being fixed.

const resolveOrgRecipientScopeSpy = vi.hoisted(() => vi.fn())

/**
 * The unmocked implementations, kept so every test starts on the real thing.
 *
 * `vi.clearAllMocks()` clears recorded calls but NOT an implementation, so a
 * test that stubs a return value with `mockResolvedValue` keeps that stub for
 * the rest of the file. The gate tests below are only worth anything if the
 * real code is what runs, so the pass-through is re-armed before each one.
 */
const passthrough = vi.hoisted(() => ({
  deliver: null as ((...args: never[]) => unknown) | null,
  scope: null as ((...args: never[]) => unknown) | null,
}))

vi.mock('@/lib/email-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-gate')>()
  passthrough.scope = actual.resolveOrgRecipientScope as unknown as (
    ...args: never[]
  ) => unknown
  resolveOrgRecipientScopeSpy.mockImplementation(actual.resolveOrgRecipientScope)
  return { ...actual, resolveOrgRecipientScope: resolveOrgRecipientScopeSpy }
})

// ─── The door: REAL, with one call-through spy on it ─────────────────────────

const deliverEmail = vi.hoisted(() => vi.fn())

vi.mock('@/lib/email-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-delivery')>()
  passthrough.deliver = actual.deliverEmail as unknown as (...args: never[]) => unknown
  deliverEmail.mockImplementation(actual.deliverEmail)
  return { ...actual, deliverEmail }
})

// ─── The sample world ────────────────────────────────────────────────────────

/** Fictional. Matches no row in any database this studio owns. */
const CLIENT_ORG_ID = 'org-test-client-not-real'
const CLIENT_ADDRESS = 'someone@example-client.test'
const OUTSIDER_ADDRESS = 'stranger@example-outsider.test'

/** Nobody here has a Clerk login, so the preference read never runs. */
const invited: EmailTarget = {
  email: CLIENT_ADDRESS,
  name: 'Jo Yarnall',
  userType: 'contact',
  clerkUserId: null,
}

/** dispatchNotificationEmails only touches the db for people with a login. */
const noPrefDb = {} as never

function settings(rows: Record<string, string>): SettingRow[] {
  return Object.entries(rows).map(([key, value]) => ({ key, value }))
}

/** The blackout as it stands tonight, with one client exempted. */
function exemptOnePolicy(orgId: string): SettingRow[] {
  return settings({
    'email.deliveryMode': 'allowlist',
    'email.allowedDomains': '["tahi.studio"]',
    'email.allowedOrgIds': JSON.stringify([orgId]),
    // Explicitly empty: no per-address narrowing on top of the domain rule,
    // which is what makes the org exemption the only thing under test.
    'email.allowedAddresses': '[]',
    'email.blockedAddresses': '[]',
  })
}

function clientPlan(orgId: string | null) {
  return threadReplyEmailPlan({
    audience: 'client',
    requestId: 'req_1',
    requestTitle: 'Spring campaign landing page refresh',
    requestNumber: 4,
    orgId,
    fromName: 'Staci Bonnie',
    message: 'The second draft is up for you to look at.',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  if (passthrough.deliver) deliverEmail.mockImplementation(passthrough.deliver)
  if (passthrough.scope) resolveOrgRecipientScopeSpy.mockImplementation(passthrough.scope)
  state.settings = exemptOnePolicy(CLIENT_ORG_ID)
  state.contacts = [{ email: CLIENT_ADDRESS }]
  state.suppressed = []
  resendSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null })
  vi.stubEnv('RESEND_API_KEY', 'test_key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('the context a notification email hands the delivery gate', () => {
  it('names the client and the template, rather than nobody and "unspecified"', async () => {
    const plan = clientPlan(CLIENT_ORG_ID)
    const res = await dispatchNotificationEmails(noPrefDb, [invited], 'new_message', plan)

    expect(res.sent).toBe(1)
    expect(deliverEmail).toHaveBeenCalledTimes(1)

    const req = deliverEmail.mock.calls[0][0] as { orgId: unknown; template: unknown }
    expect(req.orgId).toBe(CLIENT_ORG_ID)
    expect(req.orgId).not.toBeNull()
    // The two values the production suppression rows were stuck on.
    expect(req.template).toBe('request-thread-reply')
    expect(req.template).not.toBe('unspecified')
  })

  it('sets the template from the builder, so a call site cannot mistype it', () => {
    // The call site supplies an org id and nothing else about delivery; the
    // name is the builder's to own.
    expect(clientPlan(CLIENT_ORG_ID).template).toBe('request-thread-reply')
    expect(clientPlan(null).orgId).toBeNull()
  })

  it('carries the same context on a rate limited retry', async () => {
    vi.useFakeTimers()
    deliverEmail.mockResolvedValueOnce({
      success: false,
      error: 'Too many requests',
      delivered: [],
      suppressed: [],
      suppressedCount: 0,
      blocked: false,
    })
    deliverEmail.mockResolvedValue({
      success: true,
      delivered: [CLIENT_ADDRESS],
      suppressed: [],
      suppressedCount: 0,
      blocked: false,
    })

    const promise = dispatchNotificationEmails(
      noPrefDb,
      [invited],
      'new_message',
      clientPlan(CLIENT_ORG_ID),
    )
    await vi.runAllTimersAsync()
    const res = await promise

    expect(res.sent).toBe(1)
    expect(deliverEmail).toHaveBeenCalledTimes(2)

    const first = deliverEmail.mock.calls[0][0] as { orgId: unknown; template: unknown }
    const second = deliverEmail.mock.calls[1][0] as { orgId: unknown; template: unknown }
    expect(second.orgId).toBe(first.orgId)
    expect(second.template).toBe(first.template)
    expect(second.orgId).toBe(CLIENT_ORG_ID)
  })
})

describe('the org id, through the real rule', () => {
  it('reaches resolveOrgRecipientScope and widens the gate for that client', async () => {
    const res = await dispatchNotificationEmails(
      noPrefDb,
      [invited],
      'new_message',
      clientPlan(CLIENT_ORG_ID),
    )

    expect(resolveOrgRecipientScopeSpy).toHaveBeenCalled()
    expect(resolveOrgRecipientScopeSpy.mock.calls[0][0]).toBe(CLIENT_ORG_ID)

    // The exemption is what carried it: the address is on no allowed domain.
    expect(res.sent).toBe(1)
    expect(resendSend).toHaveBeenCalledTimes(1)
    const payload = resendSend.mock.calls[0][0] as { to: string[] }
    expect(payload.to).toEqual([CLIENT_ADDRESS])
    expect(state.suppressed).toHaveLength(0)
  })

  it('still withholds the same address when its org is not exempt', async () => {
    state.settings = exemptOnePolicy('some-other-org')

    const res = await dispatchNotificationEmails(
      noPrefDb,
      [invited],
      'new_message',
      clientPlan(CLIENT_ORG_ID),
    )

    expect(res.sent).toBe(0)
    expect(res.failed).toBe(1)
    expect(resendSend).not.toHaveBeenCalled()
    // And the log now says which template went missing, and for whom.
    expect(state.suppressed).toHaveLength(1)
    expect(state.suppressed[0].template).toBe('request-thread-reply')
    expect(state.suppressed[0].orgId).toBe(CLIENT_ORG_ID)
  })

  it('widens for that client only, never for whoever else is on the line', async () => {
    const outsider: EmailTarget = {
      email: OUTSIDER_ADDRESS,
      name: 'Someone Else',
      userType: 'contact',
      clerkUserId: null,
    }

    const res = await dispatchNotificationEmails(
      noPrefDb,
      [outsider],
      'new_message',
      clientPlan(CLIENT_ORG_ID),
    )

    expect(res.sent).toBe(0)
    expect(resendSend).not.toHaveBeenCalled()
    expect(state.suppressed[0].to).toBe(OUTSIDER_ADDRESS)
  })
})
