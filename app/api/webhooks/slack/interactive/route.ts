/**
 * POST /api/webhooks/slack/interactive
 *
 * Every button press and modal submit from the Tahi Slack app: Approve,
 * Tweak, Tonight, This week, Reject. The interactivity URL in the app
 * manifest points here.
 *
 * Same five rules as the events route (raw body, verify first, ack inside
 * three seconds, work in ctx.waitUntil, dedupe at the route) with two
 * differences that matter:
 *
 *   THE BODY IS FORM ENCODED. Slack posts `payload=<json>` as
 *   application/x-www-form-urlencoded, so the raw body is signed and parsed as
 *   a form, not as JSON.
 *
 *   THE DEDUPE KEY IS trigger_id. An interaction carries no event_id, and
 *   trigger_id is the one value unique per interaction. This is the guard that
 *   stops Slack's retry of a tapped Approve from deciding the same suggestion
 *   twice.
 *
 * The reply is a bare 200 with no body, which is what Slack wants for both
 * payload types: a message rewrite happens through chat.update from the
 * handler, not by returning a message here.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifySlackRequest } from '@/lib/slack/verify'
import { deferSlackWork } from '@/lib/slack/defer'
import {
  handleSlackInteraction,
  parseInteractivePayload,
  rememberSlackEvent,
} from '@/lib/slack/dispatch'
import { registerSuggestionActions } from '@/lib/slack/dispatch-actions'

// Prevent build-time static analysis: the signing secret is read at runtime.
export const dynamic = 'force-dynamic'

// The `sugg:*` buttons, claimed at module load rather than per request. The
// dispatcher resolves a handler by action id prefix and has no list of its
// own, so an unregistered prefix is a button that answers "not switched on
// yet". Importing the module registers it too; the explicit call is so that
// nothing here looks like an unused import and gets tidied away.
registerSuggestionActions()

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

  const payload = parseInteractivePayload(rawBody)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid interactive payload' }, { status: 400 })
  }

  const triggerId = typeof payload.trigger_id === 'string' ? payload.trigger_id : null
  await deferSlackWork(async () => {
    const database = (await db()) as Drizzle
    if (!(await rememberSlackEvent(database, triggerId))) return
    await handleSlackInteraction(database, payload)
  })

  return new NextResponse(null, { status: 200 })
}
