/**
 * POST /api/webhooks/slack/events
 *
 * Slack's Events API endpoint for the Tahi app: DMs, app mentions and files
 * shared in a DM. The events URL in the app manifest points here.
 *
 * ── The shape of this route ───────────────────────────────────────────────────
 *   1. Read the RAW body once. Slack signs the bytes, so JSON.parse then
 *      re-stringify would fail every signature.
 *   2. Verify the signature BEFORE anything is parsed, written or resolved.
 *      There is no bearer token on an inbound Slack delivery: the signature is
 *      the authentication. A worker with no SLACK_SIGNING_SECRET answers 500
 *      rather than 401, so a half-finished install is debuggable rather than
 *      looking like Slack's fault.
 *   3. Echo the url_verification challenge. This is the one reply Slack reads
 *      as prose, and without it the events URL never turns green.
 *   4. Answer 200 inside three seconds and do the work in ctx.waitUntil.
 *      Slack retries anything slower, up to three times, so an awaited
 *      handler would answer one DM three times.
 *   5. Dedupe on event_id AT THE ROUTE, because a retry is exactly what the
 *      dedupe defends against and a retry never reaches a handler.
 *
 * Every other envelope type answers 200 as well: a 4xx makes Slack retry
 * something we are never going to act on.
 *
 * Secrets: SLACK_SIGNING_SECRET (verification) and SLACK_BOT_TOKEN (the
 * replies). See docs/superpowers/plans/2026-09-22-slack-app-manifest.md.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifySlackRequest } from '@/lib/slack/verify'
import { deferSlackWork } from '@/lib/slack/defer'
import {
  handleSlackEvent,
  isHandledEvent,
  rememberSlackEvent,
  type SlackEventEnvelope,
} from '@/lib/slack/dispatch'

// Prevent build-time static analysis: the signing secret is read at runtime.
export const dynamic = 'force-dynamic'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: Request) {
  const rawBody = await req.text()

  const verdict = await verifySlackRequest(req.headers, rawBody)
  if (!verdict.ok) {
    if (verdict.reason === 'not_configured') {
      return NextResponse.json({ error: 'Slack signing secret not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const envelope = parsed as SlackEventEnvelope

  // The handshake. Slack reads the bare challenge back, nothing else.
  if (envelope.type === 'url_verification') {
    return NextResponse.json({ challenge: typeof envelope.challenge === 'string' ? envelope.challenge : '' })
  }

  if (envelope.type !== 'event_callback') {
    return NextResponse.json({ ok: true })
  }

  // Not ours to answer: no dedupe row spent, because an event we never act on
  // cannot be acted on twice.
  if (!isHandledEvent(envelope.event)) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  const eventId = envelope.event_id ?? null
  await deferSlackWork(async () => {
    const database = (await db()) as Drizzle
    if (!(await rememberSlackEvent(database, eventId))) return
    await handleSlackEvent(database, envelope)
  })

  return NextResponse.json({ ok: true })
}
