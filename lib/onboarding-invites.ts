/**
 * Onboarding invite tokens.
 *
 * Flow: Tahi creates the client (a D1 `organisations` row) first, then mints an
 * opaque, non-guessable token. The link (/onboarding?token=... for a client,
 * /welcome?token=... for a teammate) carries the engagement context through
 * sign-in and, on first use, joins the user to the pre-created org with NO
 * payment step. The persona is read from the token row server-side, never from
 * a spoofable `?p=` query param.
 */
import { schema } from '@/db/d1'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { publicUrl } from '@/lib/app-url'
import { clerkClient } from '@clerk/nextjs/server'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Generate an opaque, URL-safe, non-guessable invite token. 24 bytes of
 * crypto-random entropy (~192 bits) base64url-encoded.
 */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface InviteContext {
  id: string
  token: string
  flow: 'client' | 'team'
  orgId: string | null
  persona: string | null
  contractId: string | null
  scheduleId: string | null
  proposalId: string | null
  contactEmail: string | null
  contactName: string | null
  /** Resolved org display name (client flow), for the welcome copy. */
  companyName: string | null
  expired: boolean
  used: boolean
}

/** Resolve an invite token to its server-trusted context, or null if unknown. */
export async function resolveInvite(database: D1, token: string): Promise<InviteContext | null> {
  const [row] = await database
    .select()
    .from(schema.onboardingInvites)
    .where(eq(schema.onboardingInvites.token, token))
    .limit(1)
  if (!row) return null

  let companyName: string | null = null
  if (row.orgId) {
    const [org] = await database
      .select({ name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, row.orgId))
      .limit(1)
    companyName = org?.name ?? null
  }

  const expired = row.expiresAt ? Date.parse(row.expiresAt) < Date.now() : false
  return {
    id: row.id,
    token: row.token,
    flow: row.flow === 'team' ? 'team' : 'client',
    orgId: row.orgId ?? null,
    persona: row.persona ?? null,
    contractId: row.contractId ?? null,
    scheduleId: row.scheduleId ?? null,
    proposalId: row.proposalId ?? null,
    contactEmail: row.contactEmail ?? null,
    contactName: row.contactName ?? null,
    companyName,
    expired,
    used: !!row.usedAt,
  }
}

// ---------------------------------------------------------------------------
// Minting and link building
//
// Shared by the three product callers that hand a client their way in: the mint
// route (POST /api/admin/onboarding-invites), the welcome/invite email route,
// and admin client creation. Keeping it here rather than in a route module is
// what lets all three agree on one token shape, one expiry and one link, and is
// required by the App Router rule that a route.ts exports HTTP verbs only.
// ---------------------------------------------------------------------------

/** Personas an admin may attach to a client invite. */
export const CLIENT_PERSONAS = ['retainer', 'project', 'existing_project', 'existing_retainer'] as const
export type ClientPersona = (typeof CLIENT_PERSONAS)[number]

/** Default lifetime of an invite link, so an invite is never immortal. */
export const INVITE_EXPIRY_DAYS = 14

export function isClientPersona(value: string | null | undefined): value is ClientPersona {
  return !!value && (CLIENT_PERSONAS as readonly string[]).includes(value)
}

/**
 * Pick the persona for a client the studio has already agreed terms with.
 *
 * The `existing_*` half is the important one: it tells the onboarding scene the
 * commercial conversation already happened, so a client the studio set up is
 * never shown a payment step on their own workspace. Pass `alreadyEngaged:
 * false` only for a self-serve style invite where the client still has to pick
 * and pay for a plan.
 */
export function personaForPlanType(
  planType: string | null | undefined,
  alreadyEngaged = true,
): ClientPersona {
  const retainer = planType === 'maintain' || planType === 'scale'
  if (alreadyEngaged) return retainer ? 'existing_retainer' : 'existing_project'
  return retainer ? 'retainer' : 'project'
}

/** The in-app path an invite token resolves to, by flow. */
export function invitePath(token: string, flow: 'client' | 'team'): string {
  return flow === 'team' ? `/welcome?token=${token}` : `/onboarding?token=${token}`
}

/** Fully qualified invite link, safe to put in an email. */
export function inviteLink(token: string, flow: 'client' | 'team'): string {
  return publicUrl(invitePath(token, flow))
}

export interface CreateInviteOptions {
  flow: 'client' | 'team'
  orgId?: string | null
  persona?: string | null
  contractId?: string | null
  scheduleId?: string | null
  proposalId?: string | null
  contactEmail?: string | null
  contactName?: string | null
  expiresInDays?: number
  createdById?: string | null
}

export interface MintedInvite {
  id: string
  token: string
  path: string
  link: string
  expiresAt: string
  /** True when a live invite was handed back instead of a freshly minted one. */
  reused: boolean
}

/**
 * Mint and persist a fresh invite. Authorisation is the caller's job: this is a
 * writer, not a guard.
 */
export async function createInvite(
  database: D1,
  opts: CreateInviteOptions,
): Promise<MintedInvite> {
  const id = crypto.randomUUID()
  const token = generateInviteToken()
  const now = new Date().toISOString()
  const days = opts.expiresInDays && opts.expiresInDays > 0 ? opts.expiresInDays : INVITE_EXPIRY_DAYS
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString()
  const isClient = opts.flow === 'client'

  await database.insert(schema.onboardingInvites).values({
    id,
    token,
    flow: opts.flow,
    orgId: isClient ? opts.orgId ?? null : null,
    persona: isClient ? opts.persona ?? null : null,
    contractId: opts.contractId ?? null,
    scheduleId: opts.scheduleId ?? null,
    proposalId: opts.proposalId ?? null,
    contactEmail: opts.contactEmail?.trim().toLowerCase() || null,
    contactName: opts.contactName?.trim() || null,
    expiresAt,
    createdById: opts.createdById ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id,
    token,
    path: invitePath(token, opts.flow),
    link: inviteLink(token, opts.flow),
    expiresAt,
    reused: false,
  }
}

/**
 * The newest unused, unexpired client invite bound to this org and email.
 *
 * Re-sending a welcome must not spray a contact with a new token every time,
 * and must not invalidate the link already sitting in their inbox.
 */
export async function findLiveClientInvite(
  database: D1,
  orgId: string,
  email: string,
): Promise<MintedInvite | null> {
  const emailLower = email.trim().toLowerCase()
  if (!emailLower) return null

  const rows = await database
    .select()
    .from(schema.onboardingInvites)
    .where(and(
      eq(schema.onboardingInvites.orgId, orgId),
      eq(schema.onboardingInvites.contactEmail, emailLower),
      isNull(schema.onboardingInvites.usedAt),
    ))
    .orderBy(desc(schema.onboardingInvites.createdAt))

  const now = Date.now()
  for (const row of rows) {
    if (row.flow === 'team') continue
    if (row.expiresAt && Date.parse(row.expiresAt) < now) continue
    return {
      id: row.id,
      token: row.token,
      path: invitePath(row.token, 'client'),
      link: inviteLink(row.token, 'client'),
      expiresAt: row.expiresAt ?? '',
      reused: true,
    }
  }
  return null
}

/** Reuse a live invite for this contact, or mint one. */
export async function ensureClientInvite(
  database: D1,
  opts: CreateInviteOptions & { orgId: string; contactEmail: string },
): Promise<MintedInvite> {
  const existing = await findLiveClientInvite(database, opts.orgId, opts.contactEmail)
  if (existing) return existing
  return createInvite(database, opts)
}

// ---------------------------------------------------------------------------
// Seat vs first contact
//
// A token minted for an already-established client org (every invite POST
// /api/portal/people and POST /api/portal/invites send: the caller sending it
// is themselves a contact at that org already) needs a different landing than
// one minted for a brand-new org that has nobody on it yet (the studio's
// client-detail "invite" button, before anyone has accepted). The distinction
// is read from the ORG'S OWN roster, never the token's `flow` string or its
// `persona`: a persona is optional and a seat invite never carries one, but
// relying on that as the signal would silently break the day a caller does
// set one, and `flow` only ever distinguishes client vs team, not seat vs
// founder.
// ---------------------------------------------------------------------------

/**
 * Pure decision: does this org already have someone else in it, other than
 * the person this invite is for? True once any contact row's email differs
 * from the invite's own - the admin who sent the invite, an earlier seat, a
 * migrated roster row. False for a genuinely brand-new org (no contacts at
 * all yet, or only the invitee's own not-yet-accepted pending row).
 */
export function hasOtherOrgContact(
  contacts: { email: string | null }[],
  inviteEmail: string | null,
): boolean {
  const emailLower = inviteEmail?.trim().toLowerCase() ?? null
  return contacts.some(c => (c.email?.trim().toLowerCase() ?? null) !== emailLower)
}

/**
 * D1-backed seat decision for a client invite's target org. True = seat (the
 * org already has someone else on it; accept immediately, no wizard). False =
 * first contact (a brand-new org; today's onboarding wizard still applies).
 */
export async function isSeatInvite(
  database: D1,
  orgId: string,
  inviteEmail: string | null,
): Promise<boolean> {
  const rows = await database
    .select({ email: schema.contacts.email })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, orgId))
  return hasOtherOrgContact(rows, inviteEmail)
}

// ---------------------------------------------------------------------------
// Accepting a client invite
//
// Shared by POST /api/portal/accept-invite and the seat branch of
// app/(onboarding)/onboarding/page.tsx, so the two callers cannot drift: one
// does the email binding, the single-use claim, the Clerk membership and the
// contact link/promotion exactly once, and both callers only translate the
// result into their own response shape (a JSON error, or a plain problem
// page).
// ---------------------------------------------------------------------------

export type AcceptInviteStatus = 400 | 403 | 404 | 409 | 410

export type AcceptInviteResult =
  | { ok: true; orgId: string; clerkOrgId: string }
  | { ok: false; status: AcceptInviteStatus; error: string }

/**
 * Consume a client onboarding invite: join the signed-in user to the
 * pre-created org with no payment step.
 *
 * Security (the link is a bearer token, so we bind and claim it carefully):
 *   - Email binding: the signed-in user's verified primary email MUST equal
 *     the invite's contactEmail. A forwarded link is useless to anyone else.
 *   - Single-use, claimed ATOMICALLY (UPDATE ... WHERE used_at IS NULL) before
 *     any membership is granted, so two racing requests cannot both win.
 *   - Expiry enforced.
 *   - The first person to accept a brand-new org's invite creates its Clerk
 *     org; anyone joining an already-existing Clerk org is added as a plain
 *     member, never a Clerk admin.
 *   - The portal role (contacts.portalRole) is stricter still: see the
 *     `shouldOwn` block below.
 *
 * On success, also stamps the accepting user's own Clerk
 * publicMetadata.onboardingComplete so the dashboard's cheap per-user gate
 * (app/(dashboard)/layout.tsx) never sends this seat back to the client
 * wizard, even on a later sign-in where nothing about the ORG itself would
 * otherwise say so (see lib/org-onboarding.ts).
 *
 * Takes an ALREADY-RESOLVED invite, not a bare token: both callers
 * (POST /api/portal/accept-invite and the seat branch of
 * app/(onboarding)/onboarding/page.tsx) already need resolveInvite's result
 * for their own decisions (the seat-vs-first-contact check, the response
 * shape), so resolving it twice would be pure waste - and it keeps this
 * function's own D1 reads limited to the ones an acceptance actually
 * performs, independent of whatever resolveInvite's OWN query shape is.
 */
export async function acceptClientInvite(
  database: D1,
  userId: string,
  invite: InviteContext | null,
): Promise<AcceptInviteResult> {
  if (!invite || invite.flow !== 'client' || !invite.orgId) {
    return { ok: false, status: 400, error: 'Invalid invite' }
  }
  if (invite.expired) {
    return { ok: false, status: 410, error: 'This invite has expired' }
  }
  if (!invite.contactEmail) {
    // An unbound invite cannot be safely claimed; the studio must re-issue it
    // with the invitee's email so we can verify who is accepting.
    return {
      ok: false,
      status: 400,
      error: 'This invite is not linked to an email. Ask the studio for a new link.',
    }
  }

  // Email binding: only the invited person (verified) may accept.
  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
  const userEmail = (primary?.emailAddress ?? '').toLowerCase()
  const verified = primary?.verification?.status === 'verified'
  if (!verified || userEmail !== invite.contactEmail.toLowerCase()) {
    return { ok: false, status: 403, error: 'This invite was sent to a different email address.' }
  }

  const [org] = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      clerkOrgId: schema.organisations.clerkOrgId,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, invite.orgId))
    .limit(1)
  if (!org) return { ok: false, status: 404, error: 'Organisation not found' }

  const now = new Date().toISOString()

  // Atomic single-use claim: only the request that flips used_at from NULL wins.
  const claimed = await database
    .update(schema.onboardingInvites)
    .set({ usedAt: now, usedByUserId: userId, updatedAt: now })
    .where(and(eq(schema.onboardingInvites.id, invite.id), isNull(schema.onboardingInvites.usedAt)))
    .returning({ id: schema.onboardingInvites.id })

  if (claimed.length === 0) {
    // Already used. Idempotent only if THIS user is the one who used it.
    const [row] = await database
      .select({ usedByUserId: schema.onboardingInvites.usedByUserId })
      .from(schema.onboardingInvites)
      .where(eq(schema.onboardingInvites.id, invite.id))
      .limit(1)
    if (row?.usedByUserId !== userId) {
      return { ok: false, status: 409, error: 'This invite has already been used.' }
    }
  }

  let clerkOrgId = org.clerkOrgId
  if (clerkOrgId) {
    // Join an existing Clerk org as a plain member (never auto-admin).
    try {
      await clerk.organizations.createOrganizationMembership({
        organizationId: clerkOrgId,
        userId,
        role: 'org:member',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!/already a member|already exists/i.test(msg)) {
        // Non-fatal: membership likely already present; continue.
      }
    }
  } else {
    // Lazily create the Clerk org; the first invited user becomes its admin (owner).
    const created = await clerk.organizations.createOrganization({ name: org.name, createdBy: userId })
    clerkOrgId = created.id
    await database
      .update(schema.organisations)
      .set({ clerkOrgId, updatedAt: now })
      .where(eq(schema.organisations.id, org.id))
  }

  // Link (or create) the contact row for this Clerk user. Best-effort
  // throughout: a failure here must not undo a membership that has already
  // been granted. See the route this was extracted from for the full history
  // of why: an invite to someone with no contact row used to link nothing at
  // all, and portalRole was never set, so even a founding member landed on
  // the 'member' default and was refused by their own workspace.
  const inviteEmail = invite.contactEmail.toLowerCase()
  try {
    const existing = await database
      .select({
        id: schema.contacts.id,
        email: schema.contacts.email,
        portalRole: schema.contacts.portalRole,
        isPrimary: schema.contacts.isPrimary,
      })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, org.id))

    const match = existing.find(c => c.email?.trim().toLowerCase() === inviteEmail)
    // Who gets to own the workspace: deliberately NOT "whoever accepts
    // first". Promotion needs BOTH a workspace with no administrator yet AND
    // a genuine claim to be its owner: either nobody is on the roster at all
    // (the true founding case), or the row this invite matches is the org's
    // primary contact.
    const orgHasAdmin = existing.some(c => c.portalRole === 'admin')
    const shouldOwn = !orgHasAdmin && (existing.length === 0 || !!match?.isPrimary)
    const portalRole = shouldOwn ? 'admin' : 'member'

    if (match) {
      await database
        .update(schema.contacts)
        .set({
          clerkUserId: userId,
          updatedAt: now,
          // Never demote: an existing admin stays an admin.
          ...(match.portalRole === 'admin' ? {} : { portalRole }),
        })
        .where(and(eq(schema.contacts.id, match.id), eq(schema.contacts.orgId, org.id)))
    } else {
      await database.insert(schema.contacts).values({
        id: crypto.randomUUID(),
        orgId: org.id,
        name: invite.contactName?.trim() || inviteEmail.split('@')[0],
        email: inviteEmail,
        clerkUserId: userId,
        isPrimary: existing.length === 0,
        portalRole,
        createdAt: now,
        updatedAt: now,
      })
    }
  } catch {
    // non-fatal
  }

  // Best-effort: mark THIS user as onboarded directly, so the dashboard's
  // cheap per-user gate never bounces this seat back to the client wizard,
  // regardless of what the org's own signals say (lib/org-onboarding.ts).
  try {
    if (!user.publicMetadata?.onboardingComplete) {
      await clerk.users.updateUser(userId, {
        publicMetadata: { ...user.publicMetadata, onboardingComplete: true },
      })
    }
  } catch {
    // non-fatal
  }

  return { ok: true, orgId: org.id, clerkOrgId: clerkOrgId as string }
}
