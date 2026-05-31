/**
 * GET / POST /api/admin/content/backfill-settings
 *
 * Two-key settings for the weekly auto-backfill cron:
 *   content.autoBackfillEnabled    (bool, default false)
 *   content.autoRewriteBody        (bool, default false)
 *
 * The Backfill tab toggles these. The cron checks the master flag
 * and skips entirely when disabled, so this is a hard off-switch.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const KEYS = ['content.autoBackfillEnabled', 'content.autoRewriteBody'] as const

async function readSettings(database: Awaited<ReturnType<typeof db>>): Promise<{ autoBackfillEnabled: boolean; autoRewriteBody: boolean }> {
  const rows = await database
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, KEYS as unknown as string[]))
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? null
  const bool = (k: string) => {
    const v = get(k)
    return v === 'true' || v === '1'
  }
  return {
    autoBackfillEnabled: bool('content.autoBackfillEnabled'),
    autoRewriteBody: bool('content.autoRewriteBody'),
  }
}

async function writeSetting(database: Awaited<ReturnType<typeof db>>, key: string, value: string): Promise<void> {
  const [existing] = await database
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)
  if (existing) {
    await database.update(schema.settings).set({ value, updatedAt: new Date().toISOString() }).where(eq(schema.settings.key, key))
  } else {
    await database.insert(schema.settings).values({
      key, value,
      updatedAt: new Date().toISOString(),
    })
  }
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const database = await db()
  return NextResponse.json(await readSettings(database))
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { autoBackfillEnabled?: boolean; autoRewriteBody?: boolean }
  const database = await db()
  if (typeof body.autoBackfillEnabled === 'boolean') {
    await writeSetting(database, 'content.autoBackfillEnabled', body.autoBackfillEnabled ? 'true' : 'false')
  }
  if (typeof body.autoRewriteBody === 'boolean') {
    await writeSetting(database, 'content.autoRewriteBody', body.autoRewriteBody ? 'true' : 'false')
  }
  return NextResponse.json(await readSettings(database))
}
