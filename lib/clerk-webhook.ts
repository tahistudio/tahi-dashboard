/**
 * lib/clerk-webhook.ts - what a Clerk webhook delivery is allowed to change.
 *
 * WHY THIS EXISTS
 * `contacts.clerkUserId` and `teamMembers.clerkUserId` are the join between a
 * Clerk login and every identity the product has for that person: portal role,
 * notification delivery, message authorship, data scoping. Until now the only
 * writers were browser-side: lib/contact-link-server.ts and
 * lib/team-link-server.ts run from the dashboard layout, on a page load. That
 * covers the person who reaches the dashboard, and nobody else. A second-seat
 * teammate accepted into a client's Clerk organisation but bounced by an
 * onboarding gate never renders that layout, so their row was never claimed and
 * they stayed at the gate with no identity behind it.
 *
 * A webhook closes that: Clerk tells us the moment the account or the
 * membership exists, with no browser involved.
 *
 * SHAPE. Same split as lib/team-link.ts / lib/team-link-server.ts, for the same
 * reason: this file is the decision, takes its I/O through `ClerkWebhookDeps`,
 * imports nothing from Clerk / D1 / Next, and is therefore readable and
 * testable on its own. lib/clerk-webhook-server.ts is the D1 wiring.
 *
 * HARD RULES (they mirror the sign-in linkers deliberately, because the two
 * paths write the same columns and must never disagree):
 *   - VERIFIED EMAIL ONLY on user.* events. An unverified address can be
 *     attacker controlled, so it can never claim a row.
 *   - NEVER OVERWRITE a non-null clerkUserId that differs. The sign-in linkers
 *     may CORRECT a stale id, because there a live Clerk session proves the
 *     caller owns the mailbox right now. A webhook proves only that Clerk sent
 *     us a payload, so it downgrades to: leave the row alone, write an audit
 *     row, let a human look.
 *   - ONE CLERK USER LINKS TO AT MOST ONE CONTACT ROW, INSTANCE WIDE. Several
 *     portal routes resolve a contact by clerkUserId with no org filter
 *     (app/api/portal/requests, app/api/uploads/confirm), so a second linked
 *     row is a cross-tenant hazard. See lib/contact-link-server.ts.
 *   - TWO ROWS SHARING AN EMAIL LINK NEITHER. Guessing hands the wrong portal
 *     role to the wrong person.
 *   - NEVER CREATES A team_members ROW. A login may only CLAIM a row an admin
 *     already made. Contacts are different: a client's own Clerk organisation
 *     IS the authority on who works there, so a membership we have no row for
 *     creates one, deny by default (portalRole 'member', isPrimary 0).
 *   - NO EMAIL, EVER, on any path here. Nothing in this file or its server twin
 *     touches lib/email-delivery.ts, Resend, or a Clerk invitation. A row
 *     appearing in the roster must not put a message in anyone's inbox.
 */

/** Event types this handler acts on. Everything else is acknowledged and dropped. */
export const HANDLED_CLERK_EVENTS = [
  'user.created',
  'user.updated',
  'organizationMembership.created',
  'organizationMembership.deleted',
] as const

export type HandledClerkEvent = (typeof HANDLED_CLERK_EVENTS)[number]

export function isHandledClerkEvent(type: string): type is HandledClerkEvent {
  return (HANDLED_CLERK_EVENTS as readonly string[]).includes(type)
}

// ── Payload shapes ───────────────────────────────────────────────────────────
// Every field optional: this is untrusted JSON off the wire, narrowed here
// rather than asserted. Clerk's own SDK types are not imported because that
// would drag @clerk/backend into a module that must stay dependency free.

export interface ClerkEmailAddressPayload {
  id?: string | null
  email_address?: string | null
  verification?: { status?: string | null } | null
}

export interface ClerkUserPayload {
  id?: string | null
  email_addresses?: ClerkEmailAddressPayload[] | null
  primary_email_address_id?: string | null
  first_name?: string | null
  last_name?: string | null
}

export interface ClerkMembershipPayload {
  organization?: { id?: string | null; name?: string | null } | null
  public_user_data?: {
    user_id?: string | null
    identifier?: string | null
    first_name?: string | null
    last_name?: string | null
  } | null
  role?: string | null
}

export interface ClerkWebhookEnvelope {
  type?: string | null
  data?: unknown
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface ContactRow {
  id: string
  orgId: string
  email: string
  clerkUserId: string | null
}

export interface TeamMemberRow {
  id: string
  email: string
  clerkUserId: string | null
}

export interface NewContactInput {
  orgId: string
  name: string
  email: string
  clerkUserId: string | null
}

// ── Outcomes ─────────────────────────────────────────────────────────────────

export type ClerkConflictReason =
  /** The row holds a different, non-null clerkUserId. Left untouched. */
  | 'stored_id_differs'
  /** Two or more rows carry this email. Neither linked. */
  | 'ambiguous_email'
  /** This Clerk user already owns a row at another org. No second link made. */
  | 'user_linked_elsewhere'

export type ClerkWebhookAction =
  | { kind: 'contact_linked'; contactId: string; orgId: string; email: string }
  | { kind: 'contact_created'; contactId: string; orgId: string; email: string; linked: boolean }
  | { kind: 'contact_unlinked'; contactId: string; orgId: string }
  | { kind: 'team_member_linked'; teamMemberId: string; email: string }
  | {
      kind: 'conflict'
      subject: 'contact' | 'team_member'
      reason: ClerkConflictReason
      id: string | null
      email: string
      storedClerkUserId: string | null
      incomingClerkUserId: string
      matchedIds?: string[]
    }
  | { kind: 'noop'; reason: string }

export interface ClerkWebhookResult {
  /** 'ignored' = event type we do not handle. 'replayed' = seen this svix-id. */
  outcome: 'ignored' | 'replayed' | 'applied'
  actions: ClerkWebhookAction[]
}

export interface ClerkAuditEntry {
  action: string
  entityType: 'contact' | 'team_member' | 'clerk_webhook'
  entityId: string | null
  metadata: Record<string, unknown>
}

export interface ClerkWebhookDeps {
  /** True when this svix-id has already been applied. Drives replay safety. */
  wasDelivered: (svixId: string) => Promise<boolean>
  /** Mark this svix-id applied. Called once, AFTER the writes. */
  recordDelivery: (svixId: string, eventType: string, actions: ClerkWebhookAction[]) => Promise<void>

  /** Any contact, at any org, already pointing at this Clerk user. */
  findContactByClerkUser: (clerkUserId: string) => Promise<ContactRow | null>
  /** Case-insensitive, instance wide. Receives an already-lowercased email. */
  findContactsByEmail: (emailLower: string) => Promise<ContactRow[]>
  /** Case-insensitive, scoped to one org. Receives an already-lowercased email. */
  findContactsByOrgAndEmail: (orgId: string, emailLower: string) => Promise<ContactRow[]>
  /** MUST be a compare-and-set on clerk_user_id IS NULL. True only if it wrote. */
  linkContact: (contactId: string, clerkUserId: string) => Promise<boolean>
  /** MUST be a compare-and-set on the CURRENT id. True only if it wrote. */
  unlinkContact: (contactId: string, clerkUserId: string) => Promise<boolean>
  /** Insert a roster row. Returns the new id. Never sends anything. */
  createContact: (input: NewContactInput) => Promise<string>

  findTeamMemberByClerkUser: (clerkUserId: string) => Promise<TeamMemberRow | null>
  findTeamMembersByEmail: (emailLower: string) => Promise<TeamMemberRow[]>
  /** MUST be a compare-and-set on clerk_user_id IS NULL. True only if it wrote. */
  linkTeamMember: (teamMemberId: string, clerkUserId: string) => Promise<boolean>

  /** Resolve a Clerk organisation id to the D1 organisations row. */
  findOrgByClerkOrgId: (clerkOrgId: string) => Promise<{ id: string } | null>

  audit: (entry: ClerkAuditEntry) => Promise<void>

  /** NEXT_PUBLIC_TAHI_ORG_ID. Memberships here are studio staff, not clients. */
  tahiClerkOrgId: string | null | undefined
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Trim and lowercase an email for comparison. Null when unusable. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  return trimmed.length > 0 && trimmed.includes('@') ? trimmed : null
}

/**
 * Every VERIFIED address on a Clerk user payload, lowercased and deduped.
 *
 * Deliberately not just the primary: a hire whose roster row carries their work
 * address but whose Clerk primary is personal should still link, and both are
 * verified by Clerk before they appear here.
 */
export function verifiedEmails(user: ClerkUserPayload): string[] {
  const out = new Set<string>()
  for (const entry of user.email_addresses ?? []) {
    if (entry?.verification?.status !== 'verified') continue
    const email = normaliseEmail(entry.email_address)
    if (email) out.add(email)
  }
  return [...out]
}

/** Display name from a Clerk name pair, falling back to the email local part. */
export function displayName(
  first: string | null | undefined,
  last: string | null | undefined,
  email: string,
): string {
  const joined = `${first ?? ''} ${last ?? ''}`.trim()
  return joined.length > 0 ? joined : email.split('@')[0]
}

function conflict(
  subject: 'contact' | 'team_member',
  reason: ClerkConflictReason,
  args: {
    id: string | null
    email: string
    storedClerkUserId: string | null
    incomingClerkUserId: string
    matchedIds?: string[]
  },
): ClerkWebhookAction {
  return { kind: 'conflict', subject, reason, ...args }
}

async function auditConflict(deps: ClerkWebhookDeps, action: ClerkWebhookAction): Promise<void> {
  if (action.kind !== 'conflict') return
  await deps.audit({
    // One action name for every shape of "we refused to guess", so an operator
    // can read the whole class with a single prefix filter.
    action: 'clerk_webhook.identity_conflict',
    entityType: action.subject,
    entityId: action.id,
    metadata: {
      reason: action.reason,
      email: action.email,
      storedClerkUserId: action.storedClerkUserId,
      incomingClerkUserId: action.incomingClerkUserId,
      matchedIds: action.matchedIds ?? [],
    },
  })
}

// ── Contacts ─────────────────────────────────────────────────────────────────

/**
 * Claim the one contact row that carries any of this user's verified emails.
 *
 * Instance wide, because a user.* event carries no organisation. That is why
 * two rows sharing an address stop the whole thing: with no org to narrow by,
 * a guess could hand a stranger a seat at the wrong client.
 */
async function linkContactByEmails(
  deps: ClerkWebhookDeps,
  clerkUserId: string,
  emails: string[],
): Promise<ClerkWebhookAction[]> {
  const existing = await deps.findContactByClerkUser(clerkUserId)
  if (existing) return [{ kind: 'noop', reason: 'contact_already_linked' }]

  const byId = new Map<string, ContactRow>()
  for (const email of emails) {
    for (const row of await deps.findContactsByEmail(email)) byId.set(row.id, row)
  }
  const candidates = [...byId.values()]
  if (candidates.length === 0) return [{ kind: 'noop', reason: 'contact_no_match' }]

  if (candidates.length > 1) {
    const action = conflict('contact', 'ambiguous_email', {
      id: null,
      email: emails[0],
      storedClerkUserId: null,
      incomingClerkUserId: clerkUserId,
      matchedIds: candidates.map(c => c.id),
    })
    await auditConflict(deps, action)
    return [action]
  }

  const only = candidates[0]
  if (only.clerkUserId === clerkUserId) return [{ kind: 'noop', reason: 'contact_already_linked' }]
  if (only.clerkUserId) {
    const action = conflict('contact', 'stored_id_differs', {
      id: only.id,
      email: normaliseEmail(only.email) ?? emails[0],
      storedClerkUserId: only.clerkUserId,
      incomingClerkUserId: clerkUserId,
    })
    await auditConflict(deps, action)
    return [action]
  }

  const wrote = await deps.linkContact(only.id, clerkUserId)
  if (!wrote) return [{ kind: 'noop', reason: 'contact_lost_race' }]

  await deps.audit({
    action: 'contact.webhook_linked',
    entityType: 'contact',
    entityId: only.id,
    metadata: { orgId: only.orgId, email: normaliseEmail(only.email), matchedBy: 'verified_email' },
  })
  return [{
    kind: 'contact_linked',
    contactId: only.id,
    orgId: only.orgId,
    email: normaliseEmail(only.email) ?? emails[0],
  }]
}

// ── Team members ─────────────────────────────────────────────────────────────

/** Claim the one roster row carrying this email. Never creates one. */
async function linkTeamMemberByEmails(
  deps: ClerkWebhookDeps,
  clerkUserId: string,
  emails: string[],
): Promise<ClerkWebhookAction[]> {
  const existing = await deps.findTeamMemberByClerkUser(clerkUserId)
  if (existing) return [{ kind: 'noop', reason: 'team_member_already_linked' }]

  const byId = new Map<string, TeamMemberRow>()
  for (const email of emails) {
    for (const row of await deps.findTeamMembersByEmail(email)) byId.set(row.id, row)
  }
  const candidates = [...byId.values()]
  if (candidates.length === 0) return [{ kind: 'noop', reason: 'team_member_no_match' }]

  if (candidates.length > 1) {
    const action = conflict('team_member', 'ambiguous_email', {
      id: null,
      email: emails[0],
      storedClerkUserId: null,
      incomingClerkUserId: clerkUserId,
      matchedIds: candidates.map(c => c.id),
    })
    await auditConflict(deps, action)
    return [action]
  }

  const only = candidates[0]
  if (only.clerkUserId === clerkUserId) return [{ kind: 'noop', reason: 'team_member_already_linked' }]
  if (only.clerkUserId) {
    const action = conflict('team_member', 'stored_id_differs', {
      id: only.id,
      email: normaliseEmail(only.email) ?? emails[0],
      storedClerkUserId: only.clerkUserId,
      incomingClerkUserId: clerkUserId,
    })
    await auditConflict(deps, action)
    return [action]
  }

  const wrote = await deps.linkTeamMember(only.id, clerkUserId)
  if (!wrote) return [{ kind: 'noop', reason: 'team_member_lost_race' }]

  await deps.audit({
    action: 'team_member.webhook_linked',
    entityType: 'team_member',
    entityId: only.id,
    metadata: { email: normaliseEmail(only.email), matchedBy: 'verified_email' },
  })
  return [{ kind: 'team_member_linked', teamMemberId: only.id, email: normaliseEmail(only.email) ?? emails[0] }]
}

// ── Event handlers ───────────────────────────────────────────────────────────

async function handleUserEvent(
  deps: ClerkWebhookDeps,
  data: ClerkUserPayload,
): Promise<ClerkWebhookAction[]> {
  const clerkUserId = typeof data.id === 'string' && data.id ? data.id : null
  if (!clerkUserId) return [{ kind: 'noop', reason: 'no_user_id' }]

  const emails = verifiedEmails(data)
  if (emails.length === 0) return [{ kind: 'noop', reason: 'no_verified_email' }]

  // Both sides are attempted. A studio person can hold a roster row AND be a
  // contact somewhere (Liam is a contact on the dummy client), and refusing one
  // because the other matched would leave half an identity behind.
  return [
    ...await linkContactByEmails(deps, clerkUserId, emails),
    ...await linkTeamMemberByEmails(deps, clerkUserId, emails),
  ]
}

async function handleMembershipCreated(
  deps: ClerkWebhookDeps,
  data: ClerkMembershipPayload,
): Promise<ClerkWebhookAction[]> {
  const clerkOrgId = data.organization?.id ?? null
  const clerkUserId = data.public_user_data?.user_id ?? null
  if (!clerkOrgId || !clerkUserId) return [{ kind: 'noop', reason: 'incomplete_membership' }]

  // `identifier` is Clerk's own primary identifier for the member, which for
  // this instance is always the email they signed in with.
  const email = normaliseEmail(data.public_user_data?.identifier)
  if (!email) return [{ kind: 'noop', reason: 'no_member_email' }]

  // Studio org: this is a hire, not a client seat. Claim a roster row if one is
  // waiting; never create one (see the header rule).
  if (deps.tahiClerkOrgId && clerkOrgId === deps.tahiClerkOrgId) {
    return linkTeamMemberByEmails(deps, clerkUserId, [email])
  }

  const org = await deps.findOrgByClerkOrgId(clerkOrgId)
  if (!org) return [{ kind: 'noop', reason: 'org_not_provisioned' }]

  // Instance-wide probe first: one Clerk user, at most one contact row.
  const linkedElsewhere = await deps.findContactByClerkUser(clerkUserId)
  if (linkedElsewhere && linkedElsewhere.orgId === org.id) {
    return [{ kind: 'noop', reason: 'contact_already_linked' }]
  }

  const atOrg = await deps.findContactsByOrgAndEmail(org.id, email)
  if (atOrg.length > 1) {
    const action = conflict('contact', 'ambiguous_email', {
      id: null,
      email,
      storedClerkUserId: null,
      incomingClerkUserId: clerkUserId,
      matchedIds: atOrg.map(c => c.id),
    })
    await auditConflict(deps, action)
    return [action]
  }

  if (atOrg.length === 1) {
    const only = atOrg[0]
    if (only.clerkUserId === clerkUserId) return [{ kind: 'noop', reason: 'contact_already_linked' }]
    if (only.clerkUserId) {
      const action = conflict('contact', 'stored_id_differs', {
        id: only.id,
        email,
        storedClerkUserId: only.clerkUserId,
        incomingClerkUserId: clerkUserId,
      })
      await auditConflict(deps, action)
      return [action]
    }
    if (linkedElsewhere) {
      // The seat exists here but the person is already someone at another
      // client. Linking would be the second link this whole module refuses to
      // make, so the row stays open and a human decides.
      const action = conflict('contact', 'user_linked_elsewhere', {
        id: only.id,
        email,
        storedClerkUserId: null,
        incomingClerkUserId: clerkUserId,
        matchedIds: [linkedElsewhere.id],
      })
      await auditConflict(deps, action)
      return [action]
    }
    const wrote = await deps.linkContact(only.id, clerkUserId)
    if (!wrote) return [{ kind: 'noop', reason: 'contact_lost_race' }]
    await deps.audit({
      action: 'contact.webhook_linked',
      entityType: 'contact',
      entityId: only.id,
      metadata: { orgId: org.id, email, matchedBy: 'organization_membership' },
    })
    return [{ kind: 'contact_linked', contactId: only.id, orgId: org.id, email }]
  }

  // Nobody in the roster carries this address. The client's own Clerk org says
  // this person works there, so the row is created rather than dropped: deny by
  // default, and NO EMAIL of any kind is sent as a result.
  const linked = !linkedElsewhere
  const contactId = await deps.createContact({
    orgId: org.id,
    name: displayName(data.public_user_data?.first_name, data.public_user_data?.last_name, email),
    email,
    clerkUserId: linked ? clerkUserId : null,
  })
  await deps.audit({
    action: 'contact.webhook_created',
    entityType: 'contact',
    entityId: contactId,
    metadata: {
      orgId: org.id,
      email,
      portalRole: 'member',
      linked,
      // Recorded so the "created but not linked" case is legible later.
      linkedElsewhereContactId: linkedElsewhere?.id ?? null,
      emailSent: false,
    },
  })
  return [{ kind: 'contact_created', contactId, orgId: org.id, email, linked }]
}

async function handleMembershipDeleted(
  deps: ClerkWebhookDeps,
  data: ClerkMembershipPayload,
): Promise<ClerkWebhookAction[]> {
  const clerkOrgId = data.organization?.id ?? null
  const clerkUserId = data.public_user_data?.user_id ?? null
  if (!clerkOrgId || !clerkUserId) return [{ kind: 'noop', reason: 'incomplete_membership' }]

  // A studio membership removal does NOT clear teamMembers.clerkUserId. That
  // column is the roster's own record of who a person is, used by time entries,
  // authorship and assignment long after someone leaves; a stale id there grants
  // nothing (admin access is decided by the session's org id, which they no
  // longer have). Off-boarding a hire is a deliberate act on the team page.
  if (deps.tahiClerkOrgId && clerkOrgId === deps.tahiClerkOrgId) {
    return [{ kind: 'noop', reason: 'studio_membership_ignored' }]
  }

  const org = await deps.findOrgByClerkOrgId(clerkOrgId)
  if (!org) return [{ kind: 'noop', reason: 'org_not_provisioned' }]

  const linked = await deps.findContactByClerkUser(clerkUserId)
  if (!linked) return [{ kind: 'noop', reason: 'contact_not_linked' }]
  if (linked.orgId !== org.id) return [{ kind: 'noop', reason: 'linked_at_another_org' }]

  const wrote = await deps.unlinkContact(linked.id, clerkUserId)
  if (!wrote) return [{ kind: 'noop', reason: 'contact_lost_race' }]

  await deps.audit({
    action: 'contact.webhook_unlinked',
    entityType: 'contact',
    entityId: linked.id,
    metadata: { orgId: org.id, clerkUserId, rowKept: true },
  })
  return [{ kind: 'contact_unlinked', contactId: linked.id, orgId: org.id }]
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Apply one verified Clerk delivery.
 *
 * Replay safety is the svix-id ledger, checked BEFORE any work and written
 * AFTER it. The ordering is deliberate: if the process dies mid-way the ledger
 * row is absent, Svix retries, and every write above is idempotent by
 * construction (compare-and-set claims, create-only-when-absent), so the retry
 * converges rather than duplicating. Claiming the id first would instead turn a
 * half-applied delivery into a permanently lost one.
 */
export async function handleClerkWebhookEvent(
  deps: ClerkWebhookDeps,
  input: { svixId: string; envelope: ClerkWebhookEnvelope },
): Promise<ClerkWebhookResult> {
  const type = typeof input.envelope.type === 'string' ? input.envelope.type : ''
  if (!isHandledClerkEvent(type)) return { outcome: 'ignored', actions: [] }

  if (await deps.wasDelivered(input.svixId)) return { outcome: 'replayed', actions: [] }

  const data = (input.envelope.data ?? {}) as Record<string, unknown>

  let actions: ClerkWebhookAction[]
  if (type === 'user.created' || type === 'user.updated') {
    actions = await handleUserEvent(deps, data as ClerkUserPayload)
  } else if (type === 'organizationMembership.created') {
    actions = await handleMembershipCreated(deps, data as ClerkMembershipPayload)
  } else {
    actions = await handleMembershipDeleted(deps, data as ClerkMembershipPayload)
  }

  await deps.recordDelivery(input.svixId, type, actions)
  return { outcome: 'applied', actions }
}
