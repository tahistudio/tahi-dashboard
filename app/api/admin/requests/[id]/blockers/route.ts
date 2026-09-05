import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isBlockerSubjectType } from '@/lib/blockers'
import { addBlocker, guardSubject, listBlockers } from '@/lib/blockers-server'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/requests/[id]/blockers ──────────────────────────────────
// Both directions: what this request waits on, and what waits on it.
//
// Admin only, and there is deliberately no portal twin. A client never sees a
// blocker, not even the count: "your request is stuck on three internal
// things" is a leak whether or not the titles come with it.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const subject = { type: 'request' as const, id }
  const denied = await guardSubject(drizzle, userId, subject)
  if (denied) return denied

  return NextResponse.json(await listBlockers(drizzle, subject))
}

// ── POST /api/admin/requests/[id]/blockers ─────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { blockerType?: string; blockerId?: string }

  if (!isBlockerSubjectType(body.blockerType)) {
    return NextResponse.json({ error: 'blockerType must be task or request' }, { status: 400 })
  }
  if (!body.blockerId?.trim()) {
    return NextResponse.json({ error: 'blockerId is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  return addBlocker(
    drizzle,
    userId,
    { type: 'request', id },
    { type: body.blockerType, id: body.blockerId },
  )
}
