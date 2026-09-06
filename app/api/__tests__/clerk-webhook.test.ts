/**
 * POST /api/webhooks/clerk - the identity backfill Clerk drives.
 *
 * The gap it closes: `contacts.clerkUserId` was only ever written from a
 * browser, by the sign-in linkers in app/(dashboard)/layout.tsx. A second-seat
 * teammate who accepted a Clerk organisation invitation but never rendered that
 * layout stayed at the gate forever, holding a valid session with no identity
 * behind it.
 *
 * Three things are worth pinning, and they are what this file covers.
 *
 * THE DOOR. Svix signatures are verified here with Web Crypto rather than by
 * the `svix` package (a Node library, and this runs on Workers), so the
 * protocol itself needs a spec: a genuine delivery is accepted, a tampered one
 * is not, and a captured-and-replayed one falls out of the five minute window.
 * A missing secret answers 503, never 200, because an unverifiable delivery
 * must look broken to Clerk and be visible in the endpoint's error rate.
 *
 * THE RULES. The handler writes the same columns the sign-in linkers write, so
 * it inherits their safety rules: never overwrite a differing clerkUserId
 * (audit instead), never guess between two rows, one Clerk user to at most one
 * contact instance-wide, never create a team_members row.
 *
 * THE SILENCE. A membership event can CREATE a contact row. Liam's rule, 2026
 * -09-06: no real client and no teammate receives anything from this system
 * until he has verified it. So the creation path is pinned as sending nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── The route's D1 half, stubbed. Section C exercises the real handler. ──────
const processed: { svixId: string; type: string | null }[] = []
vi.mock('@/lib/clerk-webhook-server', () => ({
  processClerkWebhook: vi.fn((svixId: string, envelope: { type?: string | null }) => {
    processed.push({ svixId, type: envelope.type ?? null })
    return Promise.resolve({ outcome: 'applied', actions: [] })
  }),
}))

import { POST } from '@/app/api/webhooks/clerk/route'
import {
  parseSvixSignatureHeader,
  svixSignForTest,
  verifySvixSignature,
} from '@/lib/svix-verify'
import {
  handleClerkWebhookEvent,
  type ClerkWebhookAction,
  type ClerkWebhookDeps,
  type ContactRow,
  type TeamMemberRow,
} from '@/lib/clerk-webhook'

/** A real Svix secret shape: `whsec_` + base64. */
const SECRET = 'whsec_' + btoa('a-thirty-two-byte-test-signing-key')

async function signedHeaders(id: string, body: string, timestampSeconds: number) {
  const sig = await svixSignForTest(SECRET, `${id}.${timestampSeconds}.${body}`)
  return {
    'svix-id': id,
    'svix-timestamp': String(timestampSeconds),
    'svix-signature': `v1,${sig}`,
  }
}

function makeRequest(body: string, headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/clerk', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// A. The signature protocol
// ─────────────────────────────────────────────────────────────────────────────

describe('svix signature verification', () => {
  const body = JSON.stringify({ type: 'user.created', data: { id: 'user_1' } })
  const now = 1_757_000_000_000 // fixed clock, so the window is deterministic
  const ts = Math.floor(now / 1000)

  it('accepts a genuine delivery', async () => {
    const headers = await signedHeaders('msg_1', body, ts)
    const res = await verifySvixSignature({
      headers: { id: 'msg_1', timestamp: String(ts), signature: headers['svix-signature'] },
      body,
      secret: SECRET,
      nowMs: now,
    })
    expect(res.ok).toBe(true)
  })

  it('signs `${id}.${timestamp}.${body}`, so a changed body no longer matches', async () => {
    const headers = await signedHeaders('msg_1', body, ts)
    const res = await verifySvixSignature({
      headers: { id: 'msg_1', timestamp: String(ts), signature: headers['svix-signature'] },
      body: body.replace('user_1', 'user_attacker'),
      secret: SECRET,
      nowMs: now,
    })
    expect(res).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects a signature made with a different secret', async () => {
    const other = 'whsec_' + btoa('a-completely-different-signing-key')
    const sig = await svixSignForTest(other, `msg_1.${ts}.${body}`)
    const res = await verifySvixSignature({
      headers: { id: 'msg_1', timestamp: String(ts), signature: `v1,${sig}` },
      body,
      secret: SECRET,
      nowMs: now,
    })
    expect(res).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects a stale delivery outside the five minute window, even correctly signed', async () => {
    const staleTs = ts - 6 * 60
    const headers = await signedHeaders('msg_1', body, staleTs)
    const res = await verifySvixSignature({
      headers: { id: 'msg_1', timestamp: String(staleTs), signature: headers['svix-signature'] },
      body,
      secret: SECRET,
      nowMs: now,
    })
    expect(res).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('accepts a delivery at the edge of the window and rejects one just past it', async () => {
    for (const [offset, expected] of [[299, true], [301, false]] as const) {
      const t = ts - offset
      const headers = await signedHeaders('msg_edge', body, t)
      const res = await verifySvixSignature({
        headers: { id: 'msg_edge', timestamp: String(t), signature: headers['svix-signature'] },
        body,
        secret: SECRET,
        nowMs: now,
      })
      expect(res.ok).toBe(expected)
    }
  })

  it('reads every v1 signature in a space separated header and ignores other versions', () => {
    expect(parseSvixSignatureHeader('v1,aaa v2,bbb v1,ccc')).toEqual(['aaa', 'ccc'])
    expect(parseSvixSignatureHeader('v2,bbb')).toEqual([])
  })

  it('accepts when the RIGHT signature is not the first one offered (key rotation)', async () => {
    const good = await svixSignForTest(SECRET, `msg_rot.${ts}.${body}`)
    const res = await verifySvixSignature({
      headers: { id: 'msg_rot', timestamp: String(ts), signature: `v1,bm90LXRoZS1vbmU= v1,${good}` },
      body,
      secret: SECRET,
      nowMs: now,
    })
    expect(res.ok).toBe(true)
  })

  it('rejects a non-numeric timestamp rather than reading it as a number', async () => {
    const res = await verifySvixSignature({
      headers: { id: 'msg_1', timestamp: '1757000000abc', signature: 'v1,x' },
      body,
      secret: SECRET,
      nowMs: now,
    })
    expect(res).toEqual({ ok: false, reason: 'malformed_timestamp' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B. The route
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/clerk', () => {
  const body = JSON.stringify({ type: 'user.created', data: { id: 'user_1' } })

  beforeEach(() => {
    processed.length = 0
    process.env.CLERK_WEBHOOK_SECRET = SECRET
  })

  it('answers 503, never 200, when the secret is not configured', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET
    const res = await POST(makeRequest(body, await signedHeaders('msg_a', body, Math.floor(Date.now() / 1000))))
    expect(res.status).toBe(503)
    expect(processed).toHaveLength(0)
  })

  it('accepts and processes a genuine delivery', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const res = await POST(makeRequest(body, await signedHeaders('msg_b', body, ts)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, outcome: 'applied' })
    expect(processed).toEqual([{ svixId: 'msg_b', type: 'user.created' }])
  })

  it('rejects a tampered body with 401 and never reaches the handler', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const headers = await signedHeaders('msg_c', body, ts)
    const res = await POST(makeRequest(body.replace('user_1', 'user_evil'), headers))
    expect(res.status).toBe(401)
    expect(processed).toHaveLength(0)
  })

  it('rejects a replayed old delivery with 401 even though its signature is valid', async () => {
    const staleTs = Math.floor(Date.now() / 1000) - 10 * 60
    const res = await POST(makeRequest(body, await signedHeaders('msg_d', body, staleTs)))
    expect(res.status).toBe(401)
    expect(processed).toHaveLength(0)
  })

  it('rejects a delivery with no svix headers at all', async () => {
    const res = await POST(makeRequest(body, {}))
    expect(res.status).toBe(400)
    expect(processed).toHaveLength(0)
  })

  it('never leaks an internal error message when the handler throws', async () => {
    const mod = await import('@/lib/clerk-webhook-server')
    vi.mocked(mod.processClerkWebhook).mockRejectedValueOnce(new Error('D1_ERROR: table contacts missing'))
    const ts = Math.floor(Date.now() / 1000)
    const res = await POST(makeRequest(body, await signedHeaders('msg_e', body, ts)))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('D1_ERROR')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C. The rules
// ─────────────────────────────────────────────────────────────────────────────

interface Harness {
  deps: ClerkWebhookDeps
  contacts: ContactRow[]
  members: TeamMemberRow[]
  audits: { action: string; entityId: string | null; metadata: Record<string, unknown> }[]
  delivered: Set<string>
  created: { orgId: string; name: string; email: string; clerkUserId: string | null }[]
}

function harness(init?: {
  contacts?: ContactRow[]
  members?: TeamMemberRow[]
  orgs?: Record<string, string>
  tahiClerkOrgId?: string | null
}): Harness {
  const contacts = init?.contacts ?? []
  const members = init?.members ?? []
  const orgs = init?.orgs ?? { org_clerk_acme: 'org_acme' }
  const audits: Harness['audits'] = []
  const delivered = new Set<string>()
  const created: Harness['created'] = []

  const deps: ClerkWebhookDeps = {
    wasDelivered: (id) => Promise.resolve(delivered.has(id)),
    recordDelivery: (id) => { delivered.add(id); return Promise.resolve() },
    findContactByClerkUser: (uid) =>
      Promise.resolve(contacts.find(c => c.clerkUserId === uid) ?? null),
    findContactsByEmail: (email) =>
      Promise.resolve(contacts.filter(c => c.email.toLowerCase() === email)),
    findContactsByOrgAndEmail: (orgId, email) =>
      Promise.resolve(contacts.filter(c => c.orgId === orgId && c.email.toLowerCase() === email)),
    linkContact: (id, uid) => {
      const row = contacts.find(c => c.id === id)
      // Compare-and-set on NULL, exactly like the D1 wiring.
      if (!row || row.clerkUserId !== null) return Promise.resolve(false)
      row.clerkUserId = uid
      return Promise.resolve(true)
    },
    unlinkContact: (id, uid) => {
      const row = contacts.find(c => c.id === id)
      if (!row || row.clerkUserId !== uid) return Promise.resolve(false)
      row.clerkUserId = null
      return Promise.resolve(true)
    },
    createContact: (input) => {
      created.push(input)
      const id = `c_new_${created.length}`
      contacts.push({ id, orgId: input.orgId, email: input.email, clerkUserId: input.clerkUserId })
      return Promise.resolve(id)
    },
    findTeamMemberByClerkUser: (uid) =>
      Promise.resolve(members.find(m => m.clerkUserId === uid) ?? null),
    findTeamMembersByEmail: (email) =>
      Promise.resolve(members.filter(m => m.email.toLowerCase() === email)),
    linkTeamMember: (id, uid) => {
      const row = members.find(m => m.id === id)
      if (!row || row.clerkUserId !== null) return Promise.resolve(false)
      row.clerkUserId = uid
      return Promise.resolve(true)
    },
    findOrgByClerkOrgId: (clerkOrgId) =>
      Promise.resolve(orgs[clerkOrgId] ? { id: orgs[clerkOrgId] } : null),
    audit: (entry) => {
      audits.push({ action: entry.action, entityId: entry.entityId, metadata: entry.metadata })
      return Promise.resolve()
    },
    tahiClerkOrgId: init?.tahiClerkOrgId === undefined ? 'org_clerk_tahi' : init.tahiClerkOrgId,
  }

  return { deps, contacts, members, audits, delivered, created }
}

function userEvent(id: string, emails: { address: string; verified: boolean }[]) {
  return {
    type: 'user.created',
    data: {
      id,
      primary_email_address_id: 'idn_0',
      email_addresses: emails.map((e, i) => ({
        id: `idn_${i}`,
        email_address: e.address,
        verification: { status: e.verified ? 'verified' : 'unverified' },
      })),
    },
  }
}

function membershipEvent(
  type: 'organizationMembership.created' | 'organizationMembership.deleted',
  args: { clerkOrgId: string; userId: string; identifier: string; first?: string; last?: string },
) {
  return {
    type,
    data: {
      organization: { id: args.clerkOrgId, name: 'Acme' },
      public_user_data: {
        user_id: args.userId,
        identifier: args.identifier,
        first_name: args.first ?? null,
        last_name: args.last ?? null,
      },
      role: 'org:member',
    },
  }
}

function kinds(actions: ClerkWebhookAction[]): string[] {
  return actions.map(a => a.kind)
}

describe('handleClerkWebhookEvent', () => {
  it('user.created claims the waiting contact row by verified email', async () => {
    const h = harness({
      contacts: [{ id: 'c_1', orgId: 'org_acme', email: 'Jane@Acme.com', clerkUserId: null }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_1',
      envelope: userEvent('user_jane', [{ address: 'jane@acme.com', verified: true }]),
    })

    expect(res.outcome).toBe('applied')
    expect(h.contacts[0].clerkUserId).toBe('user_jane')
    expect(kinds(res.actions)).toContain('contact_linked')
    expect(h.audits.map(a => a.action)).toContain('contact.webhook_linked')
  })

  it('user.created ignores an UNVERIFIED address, so it cannot claim a seat', async () => {
    const h = harness({
      contacts: [{ id: 'c_1', orgId: 'org_acme', email: 'jane@acme.com', clerkUserId: null }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_1',
      envelope: userEvent('user_attacker', [{ address: 'jane@acme.com', verified: false }]),
    })

    expect(h.contacts[0].clerkUserId).toBeNull()
    expect(res.actions).toEqual([{ kind: 'noop', reason: 'no_verified_email' }])
  })

  it('user.updated also links the studio roster row for a hire', async () => {
    const h = harness({
      members: [{ id: 'tm_1', email: 'nathan@tahi.studio', clerkUserId: null }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_2',
      envelope: {
        ...userEvent('user_nathan', [{ address: 'nathan@tahi.studio', verified: true }]),
        type: 'user.updated',
      },
    })

    expect(h.members[0].clerkUserId).toBe('user_nathan')
    expect(kinds(res.actions)).toContain('team_member_linked')
  })

  it('NEVER overwrites a non-null clerkUserId that differs, and audits the conflict', async () => {
    const h = harness({
      contacts: [{ id: 'c_1', orgId: 'org_acme', email: 'jane@acme.com', clerkUserId: 'user_original' }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_3',
      envelope: userEvent('user_impostor', [{ address: 'jane@acme.com', verified: true }]),
    })

    expect(h.contacts[0].clerkUserId).toBe('user_original')
    const conflict = res.actions.find(a => a.kind === 'conflict')
    expect(conflict).toMatchObject({ reason: 'stored_id_differs', storedClerkUserId: 'user_original' })
    expect(h.audits.some(a => a.action === 'clerk_webhook.identity_conflict')).toBe(true)
  })

  it('refuses to guess between two rows sharing an email, and audits that too', async () => {
    const h = harness({
      contacts: [
        { id: 'c_1', orgId: 'org_acme', email: 'jane@acme.com', clerkUserId: null },
        { id: 'c_2', orgId: 'org_beta', email: 'jane@acme.com', clerkUserId: null },
      ],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_4',
      envelope: userEvent('user_jane', [{ address: 'jane@acme.com', verified: true }]),
    })

    expect(h.contacts.every(c => c.clerkUserId === null)).toBe(true)
    expect(res.actions.find(a => a.kind === 'conflict')).toMatchObject({ reason: 'ambiguous_email' })
    expect(h.audits.some(a => a.action === 'clerk_webhook.identity_conflict')).toBe(true)
  })

  it('organizationMembership.created creates a member contact, linked, with nothing sent', async () => {
    const h = harness()
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_5',
      envelope: membershipEvent('organizationMembership.created', {
        clerkOrgId: 'org_clerk_acme',
        userId: 'user_new',
        identifier: 'Sam@Acme.com',
        first: 'Sam',
        last: 'Reed',
      }),
    })

    expect(h.created).toEqual([{
      orgId: 'org_acme',
      name: 'Sam Reed',
      email: 'sam@acme.com',
      clerkUserId: 'user_new',
    }])
    expect(res.actions).toEqual([
      { kind: 'contact_created', contactId: 'c_new_1', orgId: 'org_acme', email: 'sam@acme.com', linked: true },
    ])
    // The row is deny-by-default and the audit says outright that no mail moved.
    const audit = h.audits.find(a => a.action === 'contact.webhook_created')
    expect(audit?.metadata).toMatchObject({ portalRole: 'member', emailSent: false })
  })

  it('organizationMembership.created claims an existing pending row rather than duplicating it', async () => {
    const h = harness({
      contacts: [{ id: 'c_pending', orgId: 'org_acme', email: 'sam@acme.com', clerkUserId: null }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_6',
      envelope: membershipEvent('organizationMembership.created', {
        clerkOrgId: 'org_clerk_acme', userId: 'user_new', identifier: 'sam@acme.com',
      }),
    })

    expect(h.created).toHaveLength(0)
    expect(h.contacts[0].clerkUserId).toBe('user_new')
    expect(kinds(res.actions)).toEqual(['contact_linked'])
  })

  it('a studio membership claims a roster row and NEVER creates a contact', async () => {
    const h = harness({
      members: [{ id: 'tm_1', email: 'nathan@tahi.studio', clerkUserId: null }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_7',
      envelope: membershipEvent('organizationMembership.created', {
        clerkOrgId: 'org_clerk_tahi', userId: 'user_nathan', identifier: 'nathan@tahi.studio',
      }),
    })

    expect(h.created).toHaveLength(0)
    expect(h.members[0].clerkUserId).toBe('user_nathan')
    expect(kinds(res.actions)).toEqual(['team_member_linked'])
  })

  it('a studio membership for someone with no roster row creates nothing at all', async () => {
    const h = harness()
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_8',
      envelope: membershipEvent('organizationMembership.created', {
        clerkOrgId: 'org_clerk_tahi', userId: 'user_stranger', identifier: 'stranger@example.com',
      }),
    })

    expect(h.created).toHaveLength(0)
    expect(res.actions).toEqual([{ kind: 'noop', reason: 'team_member_no_match' }])
  })

  it('does not link a second contact row for a user already linked elsewhere', async () => {
    const h = harness({
      contacts: [{ id: 'c_other', orgId: 'org_beta', email: 'jane@acme.com', clerkUserId: 'user_jane' }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_9',
      envelope: membershipEvent('organizationMembership.created', {
        clerkOrgId: 'org_clerk_acme', userId: 'user_jane', identifier: 'jane@acme.com',
      }),
    })

    // The seat is recorded so the studio can see it, but unlinked: several
    // portal routes resolve a contact by clerkUserId with no org filter.
    expect(h.created).toEqual([{
      orgId: 'org_acme', name: 'jane', email: 'jane@acme.com', clerkUserId: null,
    }])
    expect(res.actions).toEqual([
      { kind: 'contact_created', contactId: 'c_new_1', orgId: 'org_acme', email: 'jane@acme.com', linked: false },
    ])
  })

  it('an unprovisioned Clerk org creates nothing', async () => {
    const h = harness()
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_10',
      envelope: membershipEvent('organizationMembership.created', {
        clerkOrgId: 'org_clerk_unknown', userId: 'user_x', identifier: 'x@nowhere.com',
      }),
    })

    expect(h.created).toHaveLength(0)
    expect(res.actions).toEqual([{ kind: 'noop', reason: 'org_not_provisioned' }])
  })

  it('organizationMembership.deleted clears the link and KEEPS the row', async () => {
    const h = harness({
      contacts: [{ id: 'c_1', orgId: 'org_acme', email: 'jane@acme.com', clerkUserId: 'user_jane' }],
    })
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_11',
      envelope: membershipEvent('organizationMembership.deleted', {
        clerkOrgId: 'org_clerk_acme', userId: 'user_jane', identifier: 'jane@acme.com',
      }),
    })

    expect(h.contacts).toHaveLength(1)
    expect(h.contacts[0].clerkUserId).toBeNull()
    expect(kinds(res.actions)).toEqual(['contact_unlinked'])
    expect(h.audits.some(a => a.action === 'contact.webhook_unlinked')).toBe(true)
  })

  it('a deletion at one org never clears a link held at another', async () => {
    const h = harness({
      contacts: [{ id: 'c_1', orgId: 'org_beta', email: 'jane@acme.com', clerkUserId: 'user_jane' }],
    })
    await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_12',
      envelope: membershipEvent('organizationMembership.deleted', {
        clerkOrgId: 'org_clerk_acme', userId: 'user_jane', identifier: 'jane@acme.com',
      }),
    })
    expect(h.contacts[0].clerkUserId).toBe('user_jane')
  })

  it('replaying the same svix-id is a no-op: the second delivery changes nothing', async () => {
    const h = harness()
    const envelope = membershipEvent('organizationMembership.created', {
      clerkOrgId: 'org_clerk_acme', userId: 'user_new', identifier: 'sam@acme.com',
    })

    const first = await handleClerkWebhookEvent(h.deps, { svixId: 'msg_dup', envelope })
    const second = await handleClerkWebhookEvent(h.deps, { svixId: 'msg_dup', envelope })

    expect(first.outcome).toBe('applied')
    expect(second).toEqual({ outcome: 'replayed', actions: [] })
    expect(h.created).toHaveLength(1)
    expect(h.audits.filter(a => a.action === 'contact.webhook_created')).toHaveLength(1)
  })

  it('acknowledges an event type it does not handle without recording a delivery', async () => {
    const h = harness()
    const res = await handleClerkWebhookEvent(h.deps, {
      svixId: 'msg_13',
      envelope: { type: 'session.created', data: { id: 'sess_1' } },
    })
    expect(res).toEqual({ outcome: 'ignored', actions: [] })
    expect(h.delivered.size).toBe(0)
  })
})
