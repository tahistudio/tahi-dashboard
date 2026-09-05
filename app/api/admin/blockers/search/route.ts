import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isBlockerSubjectType } from '@/lib/blockers'
import { searchBlockerCandidates } from '@/lib/blockers-server'

// ── GET /api/admin/blockers/search?q=&excludeType=&excludeId= ───────────────
// Open tasks and requests the caller may actually reach, for the blocker
// picker. Access-scoped the same way the tasks and requests lists are, which
// is why this exists rather than reusing /api/admin/search.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const excludeType = url.searchParams.get('excludeType')
  const excludeId = url.searchParams.get('excludeId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const exclude = isBlockerSubjectType(excludeType) && excludeId
    ? { type: excludeType, id: excludeId }
    : null

  return NextResponse.json({
    candidates: await searchBlockerCandidates(drizzle, userId, q, exclude),
  })
}
