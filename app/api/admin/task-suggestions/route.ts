/**
 * GET /api/admin/task-suggestions
 *
 * The inbox read: what a call proposed, still waiting on a founder.
 *
 * Scoped like every other task surface (Rule 11): a scoped team member sees
 * their own clients' suggestions plus the studio's own, which carry no client
 * at all. The rules live in lib/task-suggestions.ts; this route reads the
 * query string and applies the scope.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { countSuggestions, listSuggestions } from '@/lib/task-suggestions'

const STATUSES = ['pending', 'snoozed', 'applied', 'rejected', 'failed', 'expired', 'all']
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const requestedStatus = url.searchParams.get('status')
  const status = requestedStatus && STATUSES.includes(requestedStatus) ? requestedStatus : 'pending'
  const callId = url.searchParams.get('callId')

  const requestedLimit = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
    : DEFAULT_LIMIT

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // null means unrestricted; anything else, including [], is a filter that
  // still admits the studio's own org-less rows.
  const scoped = await resolveAccessScoping(drizzle, userId)
  const orgIds = scoped === null ? 'all' as const : scoped

  const items = await listSuggestions(drizzle, { status, callId, orgIds, limit })
  const counts = await countSuggestions(drizzle, { orgIds })

  return NextResponse.json({ items, counts })
}
