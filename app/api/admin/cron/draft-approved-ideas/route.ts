/**
 * POST /api/admin/cron/draft-approved-ideas
 *
 * Phase I · Slice 2 follow-on cron. Finds content ideas that are
 * approved but don't have an existing draft yet, and kicks off the
 * drafting pipeline for them. Runs sequentially — one idea per tick —
 * so a single slow Anthropic call can't stall the next.
 *
 * DISABLED BY DEFAULT. Master toggle: setting key
 * `content.draftingEnabled = 'true'`. Until Liam trusts the loop he
 * runs it manually via /settings/crons (Run now) or by hitting the
 * idea's draft route from the Ideas tab.
 *
 * Body / query:
 *   ?force=1                    — bypass content.draftingEnabled
 *   { max?: number }            — max ideas to draft per run (default 1,
 *                                 cap 3). Kept low so the cron never
 *                                 burns through the daily Anthropic
 *                                 budget unattended.
 *
 * Auth: TAHI_CRON_SECRET or admin session (same as every other cron).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, eq, inArray, notInArray, isNull, sql } from 'drizzle-orm'
import { assertCronAuth, logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface BodyShape {
  max?: number
}

async function readSetting(database: Awaited<ReturnType<typeof db>>, key: string): Promise<string | null> {
  const [row] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)
  return row?.value ?? null
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const auth = await assertCronAuth(req)
  if (!auth.ok) return auth.response!

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'
  const body = (await req.json().catch(() => ({}))) as BodyShape
  const maxPerRun = (() => {
    const n = body.max ?? 1
    if (!Number.isFinite(n) || n < 1) return 1
    return Math.min(3, Math.floor(n))
  })()

  type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const database = await db() as unknown as D1
  const realDb = database as unknown as Awaited<ReturnType<typeof db>>

  // Master toggle
  if (!force) {
    const enabled = await readSetting(realDb, 'content.draftingEnabled')
    if (enabled !== 'true') {
      const summary = { skipped: 'content.draftingEnabled is not true' }
      await logCronRun(database, 'draft-approved-ideas', 'skipped', Date.now() - t0, summary, null)
      return NextResponse.json(summary)
    }
  }

  // Find approved ideas without an existing draft. We subquery on
  // content_drafts.idea_id rather than join + group so the query stays
  // index-friendly on D1.
  const existingDraftIdeaIds = await realDb
    .select({ ideaId: schema.contentDrafts.ideaId })
    .from(schema.contentDrafts)

  const blockedIds = existingDraftIdeaIds
    .map(r => r.ideaId)
    .filter((v): v is string => !!v)

  const where = blockedIds.length > 0
    ? and(
        eq(schema.contentIdeas.status, 'approved'),
        notInArray(schema.contentIdeas.id, blockedIds),
      )
    : eq(schema.contentIdeas.status, 'approved')

  const queue = await realDb
    .select({ id: schema.contentIdeas.id, title: schema.contentIdeas.title })
    .from(schema.contentIdeas)
    .where(where)
    .orderBy(asc(schema.contentIdeas.createdAt))
    .limit(maxPerRun)

  if (queue.length === 0) {
    const summary = { drafted: 0, skipped: 'no approved ideas without drafts' }
    await logCronRun(database, 'draft-approved-ideas', 'success', Date.now() - t0, summary, null)
    return NextResponse.json(summary)
  }

  // Build the URL we'll loopback to. We trigger the existing per-idea
  // route rather than duplicate orchestration logic. The cron secret
  // forwards on so the recursive call passes auth.
  const origin = new URL(req.url).origin
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  if (cronSecret) {
    headers['x-cron-secret'] = cronSecret
  } else {
    // Forward the caller's cookie so the admin-session auth path works
    // when a logged-in admin runs the cron from /settings/crons.
    const cookie = req.headers.get('cookie')
    if (cookie) headers.cookie = cookie
    const auth = req.headers.get('authorization')
    if (auth) headers.authorization = auth
  }

  const results: Array<{ ideaId: string; ok: boolean; status?: string; error?: string }> = []
  for (const idea of queue) {
    try {
      const res = await fetch(`${origin}/api/admin/content/ideas/${idea.id}/draft`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({})) as { status?: string; error?: string }
      results.push({
        ideaId: idea.id,
        ok: res.ok,
        status: json.status,
        error: res.ok ? undefined : (json.error ?? `HTTP ${res.status}`),
      })
    } catch (err) {
      results.push({
        ideaId: idea.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const summary = {
    drafted: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  }
  await logCronRun(database, 'draft-approved-ideas', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
  // Silence unused-import warnings; these are kept for clarity / future use.
  void inArray
  void isNull
  void sql
}
