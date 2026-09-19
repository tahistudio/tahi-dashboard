/**
 * POST /api/admin/task-suggestions/decide-bulk
 *
 * "Approve all" on one call, which is the whole point of grouping the inbox
 * by call: six things were agreed, six things happen.
 *
 * EACH ID IS DECIDED ON ITS OWN. Never one transaction, and never an early
 * return: a row the caller cannot reach, a row that has already been decided
 * and a row whose apply fails all come back as their own result beside the
 * ones that worked. D1 has no cross-statement rollback to offer here anyway,
 * so an "all or nothing" claim would be a lie told to the operator.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decideSuggestion, guardSuggestion, loadSuggestion, type DecisionInput } from '@/lib/task-suggestions'

interface BulkBody {
  ids?: unknown
  action?: string
}

interface BulkResult {
  id: string
  changed: boolean
  status: string | null
  appliedTaskId?: string | null
  appliedRequestId?: string | null
  error?: string
}

const MAX_IDS = 100

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as BulkBody

  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'Bulk decides approve or reject' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No suggestions named' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `At most ${MAX_IDS} suggestions at a time` }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const decision: DecisionInput = body.action === 'approve' ? { action: 'approve' } : { action: 'reject' }
  const results: BulkResult[] = []

  for (const id of ids) {
    try {
      const row = await loadSuggestion(drizzle, id)
      if (!row) {
        results.push({ id, changed: false, status: null, error: 'Suggestion not found' })
        continue
      }

      const denied = await guardSuggestion(drizzle, userId, row)
      if (denied) {
        results.push({ id, changed: false, status: row.status, error: 'Forbidden' })
        continue
      }

      const result = await decideSuggestion(drizzle, id, decision, { actorId: userId ?? '', via: 'dashboard' })
      if (!result) {
        results.push({ id, changed: false, status: null, error: 'Suggestion not found' })
        continue
      }

      results.push({
        id,
        changed: result.changed,
        status: result.suggestion.status,
        appliedTaskId: result.appliedTaskId ?? null,
        appliedRequestId: result.appliedRequestId ?? null,
        // A refusal the human can fix (a hand-off with nobody named) reads as
        // the error on its own result, beside the applies that worked.
        error: result.error ?? result.suggestion.applyError ?? undefined,
      })
    } catch (err) {
      // One id falling over is one result, not a 500 for the other five.
      results.push({ id, changed: false, status: null, error: err instanceof Error ? err.message : 'Decision failed' })
    }
  }

  return NextResponse.json({ results })
}
