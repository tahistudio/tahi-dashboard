/**
 * POST /api/admin/task-suggestions/[id]/decide
 *
 * One decision, recorded once. Approve applies the change through the same
 * code the task routes use and posts the Tahi bot line; Tweak in the UI is an
 * approve carrying the edited proposal, so the row records what was actually
 * applied rather than what the model first wrote.
 *
 * Two founders clicking Approve on the same row is expected rather than an
 * error: the second click comes back `changed: false` with the row as it
 * stands. See lib/task-suggestions.ts#decideSuggestion.
 *
 * FOUR ACTIONS since CN.1d. `attach` re-points a create suggestion at work
 * that already exists and leaves it pending, and an approve may carry
 * `force: true`, which is the human saying they have read the duplicate
 * warning and want the row created anyway.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  decideSuggestion,
  guardSuggestion,
  loadSuggestion,
  snoozePreset,
  type DecisionInput,
  type DecisionVia,
} from '@/lib/task-suggestions'

interface DecideBody {
  action?: string
  /** An edited proposal, which turns Approve into Tweak. */
  proposal?: unknown
  snooze?: 'tonight' | 'this_week' | { until?: string }
  /** The surface the decision was made on. Defaults to the dashboard. */
  via?: string
  /**
   * "Approve anyway" (CN.1d section 3). Only read on an approve, and only
   * ever sent after the human has been shown what it would duplicate.
   */
  force?: boolean
  /** The request or task an attach points this create suggestion at. */
  target?: { kind?: string; id?: string }
}

const VIAS: readonly string[] = ['dashboard', 'slack', 'mcp']
const TARGET_KINDS: readonly string[] = ['request', 'task']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as DecideBody

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const row = await loadSuggestion(drizzle, id)
  if (!row) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })

  const denied = await guardSuggestion(drizzle, userId, row)
  if (denied) return denied

  let decision: DecisionInput
  if (body.action === 'approve') {
    // `force` is only ever added when it is true: an approve that carries
    // `force: false` and one that carries nothing are the same decision, and
    // the row should record the same thing for both.
    decision = {
      action: 'approve',
      ...(body.proposal !== undefined ? { proposalOverride: body.proposal } : {}),
      ...(body.force === true ? { force: true } : {}),
    }
  } else if (body.action === 'attach') {
    const kind = body.target?.kind
    const targetId = typeof body.target?.id === 'string' ? body.target.id.trim() : ''
    if (!kind || !TARGET_KINDS.includes(kind) || !targetId) {
      return NextResponse.json({ error: 'An attach needs a request or task to attach to' }, { status: 400 })
    }
    decision = { action: 'attach', target: { kind: kind as 'request' | 'task', id: targetId } }
  } else if (body.action === 'reject') {
    decision = { action: 'reject' }
  } else if (body.action === 'snooze') {
    const until = resolveSnooze(body.snooze)
    if (!until) {
      return NextResponse.json({ error: 'A snooze needs a time' }, { status: 400 })
    }
    decision = { action: 'snooze', until }
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const via: DecisionVia = typeof body.via === 'string' && VIAS.includes(body.via)
    ? body.via as DecisionVia
    : 'dashboard'

  const result = await decideSuggestion(drizzle, id, decision, { actorId: userId ?? '', via })
  if (!result) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })

  return NextResponse.json({
    suggestion: result.suggestion,
    changed: result.changed,
    appliedTaskId: result.appliedTaskId ?? null,
    // The request an approved suggestion created or changed (CN.1b). A row is
    // never both, so exactly one of the two is ever non-null.
    appliedRequestId: result.appliedRequestId ?? null,
    // Why an approve came back unchanged when the human can fix it:
    // 'contact_required' on a hand-off with nobody named yet,
    // 'possible_duplicate' on a create the client already has (CN.1d).
    error: result.error ?? null,
    // What that duplicate is, so the inbox can name it without a second read.
    similar: result.similar ?? null,
  })
}

/** A preset name, or an explicit instant, or nothing at all. */
function resolveSnooze(snooze: DecideBody['snooze']): string | null {
  if (snooze === 'tonight' || snooze === 'this_week') return snoozePreset(snooze)
  if (snooze && typeof snooze === 'object' && typeof snooze.until === 'string' && snooze.until.trim()) {
    return snooze.until.trim()
  }
  return null
}
