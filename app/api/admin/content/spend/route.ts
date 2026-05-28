/**
 * GET /api/admin/content/spend
 *
 * AI cost summary for the content engine. Aggregates ai_cost_log by:
 *   - last 24h, 7d, 30d, all time
 *   - by stage (writer, editor, sonnet reviewers, etc)
 *   - by provider (anthropic, perplexity, openai, replicate)
 *   - per-draft top spenders
 *
 * Used by /content-studio header strip + a future cost dashboard.
 *
 * Contract:
 *   {
 *     totals: { day, week, month, allTime } (cents each),
 *     byProvider: { anthropic, openai, perplexity, replicate } (cents),
 *     byStage: [{ stage, cents, calls }],
 *     topDrafts: [{ draftId, title, cents, status }],
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { gte, eq, sql, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db()
  const now = Date.now()
  const dayCutoff = new Date(now - 86_400_000).toISOString()
  const weekCutoff = new Date(now - 7 * 86_400_000).toISOString()
  const monthCutoff = new Date(now - 30 * 86_400_000).toISOString()

  // Totals
  const [day] = await database
    .select({ total: sql<number>`COALESCE(SUM(${schema.aiCostLog.estimatedUsdCents}), 0)` })
    .from(schema.aiCostLog)
    .where(gte(schema.aiCostLog.createdAt, dayCutoff))
  const [week] = await database
    .select({ total: sql<number>`COALESCE(SUM(${schema.aiCostLog.estimatedUsdCents}), 0)` })
    .from(schema.aiCostLog)
    .where(gte(schema.aiCostLog.createdAt, weekCutoff))
  const [month] = await database
    .select({ total: sql<number>`COALESCE(SUM(${schema.aiCostLog.estimatedUsdCents}), 0)` })
    .from(schema.aiCostLog)
    .where(gte(schema.aiCostLog.createdAt, monthCutoff))
  const [allTime] = await database
    .select({ total: sql<number>`COALESCE(SUM(${schema.aiCostLog.estimatedUsdCents}), 0)` })
    .from(schema.aiCostLog)

  // By provider (last 30 days)
  const byProviderRaw = await database
    .select({
      provider: schema.aiCostLog.provider,
      total: sql<number>`COALESCE(SUM(${schema.aiCostLog.estimatedUsdCents}), 0)`,
    })
    .from(schema.aiCostLog)
    .where(gte(schema.aiCostLog.createdAt, monthCutoff))
    .groupBy(schema.aiCostLog.provider)
  const byProvider: Record<string, number> = {
    anthropic: 0, openai: 0, perplexity: 0, replicate: 0,
  }
  for (const r of byProviderRaw) byProvider[r.provider] = Number(r.total ?? 0)

  // By stage (last 30 days)
  const byStage = await database
    .select({
      stage: schema.aiCostLog.stage,
      cents: sql<number>`COALESCE(SUM(${schema.aiCostLog.estimatedUsdCents}), 0)`,
      calls: sql<number>`COUNT(*)`,
    })
    .from(schema.aiCostLog)
    .where(gte(schema.aiCostLog.createdAt, monthCutoff))
    .groupBy(schema.aiCostLog.stage)

  // Top 10 drafts by spend, all time
  const topDraftsRaw = await database
    .select({
      draftId: schema.aiCostLog.scopeId,
      cents: sql<number>`COALESCE(SUM(${schema.aiCostLog.estimatedUsdCents}), 0)`,
    })
    .from(schema.aiCostLog)
    .where(eq(schema.aiCostLog.scope, 'draft'))
    .groupBy(schema.aiCostLog.scopeId)
    .orderBy(desc(sql<number>`SUM(${schema.aiCostLog.estimatedUsdCents})`))
    .limit(10)

  const draftMeta = new Map<string, { title: string | null; status: string }>()
  if (topDraftsRaw.length > 0) {
    const draftIds = topDraftsRaw.map(d => d.draftId).filter((id): id is string => id != null)
    if (draftIds.length > 0) {
      const drafts = await database
        .select({
          id: schema.contentDrafts.id,
          title: schema.contentDrafts.title,
          status: schema.contentDrafts.status,
        })
        .from(schema.contentDrafts)
      for (const d of drafts) {
        if (draftIds.includes(d.id)) {
          draftMeta.set(d.id, { title: d.title, status: d.status })
        }
      }
    }
  }

  const topDrafts = topDraftsRaw.map(d => ({
    draftId: d.draftId,
    cents: Number(d.cents ?? 0),
    title: d.draftId ? (draftMeta.get(d.draftId)?.title ?? null) : null,
    status: d.draftId ? (draftMeta.get(d.draftId)?.status ?? 'unknown') : 'unknown',
  }))

  return NextResponse.json({
    totals: {
      day: Number(day?.total ?? 0),
      week: Number(week?.total ?? 0),
      month: Number(month?.total ?? 0),
      allTime: Number(allTime?.total ?? 0),
    },
    byProvider,
    byStage: byStage.map(s => ({
      stage: s.stage,
      cents: Number(s.cents ?? 0),
      calls: Number(s.calls ?? 0),
    })),
    topDrafts,
  })
}
