import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'

// GET /api/admin/automations/log?ruleId=xxx&limit=50
// Returns automation execution log entries.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const ruleId = url.searchParams.get('ruleId')
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50')))

  const database = await db()

  const logs = ruleId
    ? await database
        .select()
        .from(schema.automationLog)
        .where(eq(schema.automationLog.ruleId, ruleId))
        .orderBy(desc(schema.automationLog.executedAt))
        .limit(limit)
    : await database
        .select()
        .from(schema.automationLog)
        .orderBy(desc(schema.automationLog.executedAt))
        .limit(limit)

  return NextResponse.json({ logs })
}
