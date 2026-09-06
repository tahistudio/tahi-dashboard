/**
 * POST /api/webhooks/clerk
 *
 * Clerk -> D1 identity backfill. The gap it closes: `contacts.clerkUserId` and
 * `teamMembers.clerkUserId` were only ever written from a browser, by the
 * sign-in linkers that run in app/(dashboard)/layout.tsx. A second-seat
 * teammate who accepts a Clerk organisation invitation but never reaches the
 * dashboard (an onboarding gate, a redirect loop, a bounced first load) was
 * therefore stuck at the gate forever, with a valid session and no identity
 * behind it. Clerk tells us the account and the membership exist the moment
 * they do; this route writes the link with no browser involved.
 *
 * WHAT IT HANDLES
 *   user.created / user.updated                  claim a contact and/or a
 *                                                roster row by VERIFIED email
 *   organizationMembership.created               link (or create) the client's
 *                                                contact row at that org
 *   organizationMembership.deleted               clear the link, KEEP the row
 * Every other event type is acknowledged with 200 and dropped, so Clerk does
 * not retry things we do not act on.
 *
 * The rules that decide each of those live in lib/clerk-webhook.ts (never
 * overwrite a differing id, never guess between two rows, one Clerk user to at
 * most one contact instance-wide, never create a team_members row). This file
 * is only the door: verify, parse, delegate, answer.
 *
 * NO EMAIL IS SENT ON ANY PATH HERE, including the contact-creation one.
 *
 * ── Required env ──────────────────────────────────────────────────────────────
 *   CLERK_WEBHOOK_SECRET   The `whsec_...` signing secret from the endpoint's
 *                          page in the Clerk dashboard. Unset -> 503 with a
 *                          one-line reason, never a 200: an unverifiable
 *                          delivery must look broken to Clerk (and retry) and
 *                          be visible in the endpoint's error rate, rather than
 *                          being silently swallowed.
 *
 * ── Operator setup ────────────────────────────────────────────────────────────
 *   1. Set CLERK_WEBHOOK_SECRET on the dashboard worker (staging AND production).
 *   2. In the Clerk dashboard -> Webhooks, add an endpoint pointing at
 *      https://<host>/api/webhooks/clerk subscribed to exactly:
 *      user.created, user.updated, organizationMembership.created,
 *      organizationMembership.deleted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readSvixHeaders, verifySvixSignature } from '@/lib/svix-verify'
import { processClerkWebhook } from '@/lib/clerk-webhook-server'
import type { ClerkWebhookEnvelope } from '@/lib/clerk-webhook'

// Prevent build-time static analysis (env vars unavailable at build).
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Read the RAW body BEFORE any parsing: the signature is over these bytes,
  // and a re-serialised object will not reproduce them.
  const body = await req.text()

  const secret = process.env.CLERK_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SECRET is not configured; refusing delivery')
    return NextResponse.json(
      { error: 'Clerk webhook secret is not configured on this environment' },
      { status: 503 },
    )
  }

  const headers = readSvixHeaders(req.headers)
  if (!headers) {
    return NextResponse.json({ error: 'Missing svix signature headers' }, { status: 400 })
  }

  const verdict = await verifySvixSignature({ headers, body, secret })
  if (!verdict.ok) {
    // Reason to the log, generic message to the caller. 400 for a delivery we
    // could not even shape-check, 401 for one that failed the signature.
    console.error('[clerk-webhook] rejected delivery:', verdict.reason, headers.id)
    const shapeProblem =
      verdict.reason === 'malformed_timestamp' ||
      verdict.reason === 'no_v1_signature' ||
      verdict.reason === 'missing_headers'
    return NextResponse.json(
      { error: shapeProblem ? 'Malformed signature headers' : 'Invalid signature' },
      { status: shapeProblem ? 400 : 401 },
    )
  }

  let envelope: ClerkWebhookEnvelope
  try {
    envelope = JSON.parse(body) as ClerkWebhookEnvelope
  } catch {
    // Signed but unparseable. 400 rather than a retry loop over a body that
    // will never parse.
    return NextResponse.json({ error: 'Malformed webhook payload' }, { status: 400 })
  }

  try {
    const result = await processClerkWebhook(headers.id, envelope)
    return NextResponse.json({ success: true, outcome: result.outcome })
  } catch (err) {
    // Internal detail stays internal. A 500 makes Clerk retry, which is what we
    // want: every write in the handler is idempotent, so a retry converges.
    console.error('[clerk-webhook] handler failed for', headers.id, err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
