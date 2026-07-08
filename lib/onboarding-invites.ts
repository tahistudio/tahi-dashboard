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
import { eq } from 'drizzle-orm'

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
