import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { generateBriefing, type BriefingResponse } from '@/lib/ai-briefing'

export const dynamic = 'force-dynamic'

// ── GET: return cached briefing if fresh ────────────────────────────────────

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db()
  const cached = await database.select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'ai_briefing_latest'))
    .limit(1)

  if (cached.length > 0 && cached[0].value) {
    try {
      const data = JSON.parse(cached[0].value) as BriefingResponse
      const generatedAt = new Date(data.generatedAt)
      const hoursAgo = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60)
      if (hoursAgo < 12) {
        return NextResponse.json(data)
      }
    } catch {
      // stale or corrupt, fall through
    }
  }

  return NextResponse.json({ stale: true, generatedAt: null })
}

// ── POST: generate a fresh briefing ─────────────────────────────────────────
// Thin wrapper around lib/ai-briefing.generateBriefing() so the cron
// endpoint can call the same code path directly. See Decision #043.

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const briefing = await generateBriefing()
    return NextResponse.json(briefing)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to generate briefing', detail: message }, { status: 500 })
  }
}
