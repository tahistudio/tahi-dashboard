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

const KEYS = [
  'content.autoBackfillEnabled',
  'content.autoRewriteBody',
  'content.glossaryDefaultTier',  // 'schema' | 'audit' | 'full' — what auto-cron runs
  'content.glossaryAutoPublish',  // true = auto-create Webflow item from generated entry
] as const

export interface BackfillSettings {
  autoBackfillEnabled: boolean
  autoRewriteBody: boolean
  glossaryDefaultTier: 'schema' | 'audit' | 'full'
  glossaryAutoPublish: boolean
}

async function readSettings(database: Awaited<ReturnType<typeof db>>): Promise<BackfillSettings> {
  const rows = await database
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, KEYS as unknown as string[]))
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? null
  const bool = (k: string) => {
    const v = get(k)
    return v === 'true' || v === '1'
  }
  const tier = get('content.glossaryDefaultTier')
  const tierValue: 'schema' | 'audit' | 'full' = tier === 'audit' || tier === 'full' ? tier : 'schema'
  return {
    autoBackfillEnabled: bool('content.autoBackfillEnabled'),
    autoRewriteBody: bool('content.autoRewriteBody'),
    glossaryDefaultTier: tierValue,
    glossaryAutoPublish: bool('content.glossaryAutoPublish'),
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
  const body = (await req.json().catch(() => ({}))) as Partial<BackfillSettings>
  const database = await db()
  if (typeof body.autoBackfillEnabled === 'boolean') {
    await writeSetting(database, 'content.autoBackfillEnabled', body.autoBackfillEnabled ? 'true' : 'false')
  }
  if (typeof body.autoRewriteBody === 'boolean') {
    await writeSetting(database, 'content.autoRewriteBody', body.autoRewriteBody ? 'true' : 'false')
  }
  if (body.glossaryDefaultTier === 'schema' || body.glossaryDefaultTier === 'audit' || body.glossaryDefaultTier === 'full') {
    await writeSetting(database, 'content.glossaryDefaultTier', body.glossaryDefaultTier)
  }
  if (typeof body.glossaryAutoPublish === 'boolean') {
    await writeSetting(database, 'content.glossaryAutoPublish', body.glossaryAutoPublish ? 'true' : 'false')
  }
  return NextResponse.json(await readSettings(database))
}
