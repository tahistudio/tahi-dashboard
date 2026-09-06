/**
 * POST /api/admin/emails/preview
 *
 * Mail every template this platform sends to the caller, filled with sample
 * data, so the designs can be checked as a set and personalisation can be
 * proved rather than assumed.
 *
 * HOW TO RUN IT. Signed in as a super admin on the deployed portal, open the
 * console on any dashboard page and run:
 *
 *   await fetch('/api/admin/emails/preview', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({}),
 *   }).then(r => r.json())
 *
 * That sends the whole set to your own address. To re-check one variant after
 * a fix, pass `only`:
 *
 *   body: JSON.stringify({ only: ['invoice-sent', 'new-message-studio'] })
 *
 * Every subject is prefixed `[PREVIEW]`, so the run is filterable and
 * deletable in one go and can never be mistaken for a real send.
 *
 * BODY
 *   to?:   string     Address to send to. Defaults to the caller's own.
 *   only?: string[]   Variant keys (see lib/email-previews.ts). Default: all.
 *
 * RESPONSE
 *   {
 *     sent:   [{ key, template, liveSender, subject }],
 *     failed: [{ key, error }],
 *     from,
 *   }
 *
 * `liveSender: false` marks a template nothing in the tree sends yet, so a
 * reviewer is not left to assume every email in the run is one a client can
 * receive today.
 *
 * Each preview goes out as multipart: the HTML the template renders plus the
 * plain text alternative rendered from the same element, which is what the
 * wired notification sends do. An HTML-only preview would not be the message a
 * client actually receives, and a broken text part could never show up in the
 * design check.
 *
 * TWO GUARDS, BOTH DELIBERATE.
 *
 *   1. Super admin only, resolved through lib/permissions the same way
 *      /api/admin/danger/export does. This endpoint can put the whole template
 *      set into an inbox on one call, which is a small mail cannon; the MCP
 *      service token resolves to `admin` (not `super_admin`) and is
 *      intentionally not allowed to fire it. No separate feature gate is needed
 *      because a super admin passes every feature gate by invariant
 *      (lib/require-feature.ts).
 *
 *   2. The destination must be ONE address ending `@tahi.studio`. The sample data names a
 *      plausible client and reads like real work, so a typo in `to` would put a
 *      fake invoice for a fake orchard in a real client's inbox. The domain
 *      check makes that impossible rather than unlikely.
 *
 * Sends are sequential with a small gap, because Resend's default limit is two
 * requests a second and the set is twenty-odd variants. A rate-limited send is
 * retried once with backoff; anything else is reported in `failed` and the run
 * carries on, so one broken template never hides the rest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { clerkClient } from '@clerk/nextjs/server'

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { resolvePermissions } from '@/lib/permissions'
import { SERVICE_USER_ID } from '@/lib/team-identity'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { emailFromAddress, sendEmail } from '@/lib/email'
import { plainTextAlternative } from '@/lib/email-plain-text'
import {
  buildSamplePreviews,
  isEmailPreviewKey,
  summarisePreviews,
  type EmailPreview,
} from '@/lib/email-previews'
import { normaliseAddress } from '@/lib/email-allowlist'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The only domain a preview may be delivered to. */
const ALLOWED_DOMAIN = '@tahi.studio'

/** Resend's default allowance is two a second; stay under it. */
const SEND_GAP_MS = 600
const RATE_LIMIT_BACKOFF_MS = 1500

/** Typed loose on purpose: this is parsed JSON, not something we validated. */
interface PreviewRequestBody {
  to?: unknown
  only?: unknown[]
}

interface FailedPreview {
  key: string
  error: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimited(error: string | undefined): boolean {
  if (!error) return false
  return /rate.?limit|too many requests|\b429\b/i.test(error)
}

/** The greeting name, from an address or a full name, never empty. */
function firstNameFrom(name: string | null, email: string): string {
  const trimmed = name?.trim()
  if (trimmed) {
    const first = trimmed.split(/\s+/)[0]
    if (first) return first
  }
  const local = email.split('@')[0] ?? ''
  const word = local.split(/[._-]/)[0]
  if (!word) return 'there'
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * The caller's own address: their `team_members` row first (it is the roster
 * the studio maintains), then Clerk's primary email as the fallback for a Tahi
 * login that has not been linked to a roster row yet.
 */
async function resolveCallerIdentity(
  drizzle: D1,
  userId: string | null,
): Promise<{ email: string; name: string | null } | null> {
  if (!userId || userId === SERVICE_USER_ID) return null

  try {
    const [member] = await drizzle
      .select({ name: schema.teamMembers.name, email: schema.teamMembers.email })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    if (member?.email?.trim()) {
      return { email: member.email.trim(), name: member.name ?? null }
    }
  } catch (err) {
    console.warn('[email-preview] team member lookup failed:', err)
  }

  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const primary =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0]
    const email = primary?.emailAddress?.trim()
    if (!email) return null
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null
    return { email, name }
  } catch (err) {
    console.warn('[email-preview] Clerk lookup failed:', err)
    return null
  }
}

/**
 * One send, with a single retry on the one failure worth retrying.
 *
 * The text alternative is rendered once, above the retry: it cannot change
 * between attempts and rendering is the expensive half of a send.
 */
async function sendPreview(
  to: string,
  preview: EmailPreview,
): Promise<{ success: boolean; error?: string }> {
  const subject = `[PREVIEW] ${preview.subject}`
  const text = await plainTextAlternative(preview.react)
  const context = { template: `preview-${preview.template}` }
  let result = await sendEmail(to, subject, preview.react, text, context)
  if (!result.success && isRateLimited(result.error)) {
    await sleep(RATE_LIMIT_BACKOFF_MS)
    result = await sendEmail(to, subject, preview.react, text, context)
  }
  return result
}

/**
 * A body key, named in the failure report. `only` arrives straight off
 * JSON.parse, so an entry can be any JSON value; a mistyped console call should
 * get the report this route already knows how to produce rather than a 500 out
 * of `.trim()`.
 */
function keyLabel(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return String(value)
}

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const drizzle = (await db()) as unknown as D1

  // Super admin only. See guard (1) in the docstring above.
  const access = await resolvePermissions(drizzle, auth)
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as PreviewRequestBody

  const caller = await resolveCallerIdentity(drizzle, auth.userId)
  const requested = (typeof body.to === 'string' ? body.to.trim() : '') || caller?.email || ''
  if (!requested) {
    return NextResponse.json(
      { error: 'No address to send to. Pass `to`, or link a team member row to this login.' },
      { status: 400 },
    )
  }

  // Guard (2): never a client's inbox, whatever was typed.
  //
  // Normalised FIRST. endsWith on the raw string was satisfied by
  // "jo@acme.com, business@tahi.studio", which is two addresses in one box and
  // used to be handed to Resend intact, so the guard read as a pass and the
  // client got the preview. normaliseAddress answers null for anything that is
  // not exactly one mailbox, which is the same rule the gate itself applies.
  const normalised = normaliseAddress(requested)
  if (!normalised || !normalised.endsWith(ALLOWED_DOMAIN)) {
    return NextResponse.json(
      { error: `Previews can only be sent to a single ${ALLOWED_DOMAIN} address.` },
      { status: 400 },
    )
  }

  const to = normalised
  // When `to` was overridden, greet whoever owns that address rather than the
  // caller: the preview is being read in that inbox, not this one.
  const greetName = caller && caller.email.toLowerCase() === to.toLowerCase() ? caller.name : null
  const firstName = firstNameFrom(greetName, to)

  const all = buildSamplePreviews({ to, firstName })

  const sent: EmailPreview[] = []
  const failed: FailedPreview[] = []

  let selected = all
  if (Array.isArray(body.only) && body.only.length > 0) {
    const wanted = new Set<string>()
    // Named separately from `wanted` so a key repeated in the body is reported
    // once, whether it turned out to be valid or not.
    const seen = new Set<string>()
    for (const raw of body.only) {
      if (typeof raw !== 'string') {
        failed.push({ key: keyLabel(raw), error: 'Template key must be a string' })
        continue
      }
      const key = raw.trim()
      if (seen.has(key)) continue
      seen.add(key)
      if (!isEmailPreviewKey(key)) {
        failed.push({ key, error: 'Unknown template key' })
        continue
      }
      wanted.add(key)
    }
    selected = all.filter((p) => wanted.has(p.key))
  }

  for (let i = 0; i < selected.length; i += 1) {
    const preview = selected[i]
    if (i > 0) await sleep(SEND_GAP_MS)
    try {
      const result = await sendPreview(to, preview)
      if (result.success) sent.push(preview)
      else failed.push({ key: preview.key, error: result.error ?? 'Unknown error' })
    } catch (err) {
      failed.push({ key: preview.key, error: err instanceof Error ? err.message : 'Send failed' })
    }
  }

  return NextResponse.json({
    sent: summarisePreviews(sent),
    failed,
    // Asked of lib/email.ts rather than rebuilt here, so a preview that landed
    // in spam can be traced to the identity that actually sent it.
    from: emailFromAddress(),
  })
}
