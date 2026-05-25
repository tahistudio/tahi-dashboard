/**
 * POST /api/public/section-views
 *
 * Public ingest for per-section dwell events from the schedule / proposal /
 * contract public viewer. The viewer batches IntersectionObserver
 * enter/exit pairs and POSTs them in chunks.
 *
 * Body: {
 *   resourceType: 'schedule' | 'proposal' | 'contract',
 *   resourceId: string,
 *   shareToken: string,
 *   sessionId: string,
 *   events: Array<{ sectionId: string; enteredAt: string; exitedAt: string; dwellMs: number }>
 * }
 *
 * Validation:
 *   - shareToken must correspond to a currently-shared resource
 *   - resourceId must match the token's resource
 *   - events array capped at 50 per POST
 *   - dwellMs clamped to [0, 600000] (10 min) per event
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const MAX_EVENTS = 50
const MAX_DWELL_MS = 600_000

async function validateToken(
  database: D1,
  resourceType: string,
  shareToken: string,
): Promise<string | null> {
  if (resourceType === 'schedule') {
    const [row] = await database
      .select({ id: schema.projectSchedules.id, status: schema.projectSchedules.status })
      .from(schema.projectSchedules)
      .where(eq(schema.projectSchedules.publicShareToken, shareToken))
      .limit(1)
    if (!row || row.status !== 'shared') return null
    return row.id
  }
  // Phase 2 / 3 — extend for proposal / contract.
  return null
}

export async function POST(req: NextRequest) {
  let body: {
    resourceType?: string
    resourceId?: string
    shareToken?: string
    sessionId?: string
    events?: Array<{ sectionId?: string; enteredAt?: string; exitedAt?: string; dwellMs?: number }>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { resourceType, resourceId, shareToken, sessionId, events } = body
  if (!resourceType || !resourceId || !shareToken || !sessionId || !Array.isArray(events)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (events.length === 0) {
    return NextResponse.json({ inserted: 0 })
  }
  if (events.length > MAX_EVENTS) {
    return NextResponse.json({ error: `Too many events (max ${MAX_EVENTS})` }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const validResourceId = await validateToken(database, resourceType, shareToken)
  if (!validResourceId || validResourceId !== resourceId) {
    return NextResponse.json({ error: 'Invalid token / resource' }, { status: 403 })
  }

  const nowIso = new Date().toISOString()
  const rows = events
    .filter(e => typeof e.sectionId === 'string' && e.sectionId.length > 0 && typeof e.enteredAt === 'string')
    .map(e => ({
      id: crypto.randomUUID(),
      resourceType,
      resourceId,
      sessionId,
      sectionId: e.sectionId!,
      dwellMs: Math.max(0, Math.min(MAX_DWELL_MS, Math.round(e.dwellMs ?? 0))),
      enteredAt: e.enteredAt!,
      exitedAt: e.exitedAt ?? null,
      createdAt: nowIso,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 })
  }

  // Batch insert.
  await database.insert(schema.shareSectionViews).values(rows)
  return NextResponse.json({ inserted: rows.length })
}
