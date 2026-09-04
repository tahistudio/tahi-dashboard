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
