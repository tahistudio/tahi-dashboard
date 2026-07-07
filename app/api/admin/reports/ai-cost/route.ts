/**
 * GET /api/admin/reports/ai-cost
 *
 * Cross-surface AI token spend. Aggregates from the columns we already
 * track (no extra schema needed):
 *   - leads.aiTokensSpent       (cron scoring + Sonnet enrichment + draft-reply)
 *   - ai_reply_drafts.tokensSpent (per-draft, already rolled into leads.aiTokensSpent
 *                                  but useful for a per-draft breakdown)
 *
 * Returns:
 *   {
 *     totals: {
 *       allTime: { tokens, leads, drafts },
 *       last30Days: { tokens, leads, drafts },
 *     },
 *     topLeads: [{ id, name, company, tokens, score }] // 10 most-spent
 *     bySurface: {
 *       reply_drafts: { count, tokens },
 *       enrichment: { tokensEstimate }  // derived from leads with enrichedAt set
 *     }
 *   }
 *
 * Cost estimate is informational only. Real billed cost depends on
 * Anthropic pricing per model. Rough rule of thumb at the time of
 * writing (USD): Haiku 4.5 ≈ $1/M input, $5/M output. Sonnet 4.6 ≈
 * $3/M input, $15/M output. We surface tokens (not dollars) because
 * pricing changes faster than the dashboard.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, gte, isNotNull, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'financial_reports')
  if (denied) return denied

  const database = await db()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()

  // All-time aggregates
  const [allTimeLeads] = await database
    .select({
      tokens: sql<number>`COALESCE(SUM(${schema.leads.aiTokensSpent}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.leads)

  const [allTimeDrafts] = await database
    .select({
      tokens: sql<number>`COALESCE(SUM(${schema.aiReplyDrafts.tokensSpent}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.aiReplyDrafts)

  // Last 30 days — leads gauged by lastAiRunAt within the window
  const [last30Leads] = await database
    .select({
      tokens: sql<number>`COALESCE(SUM(${schema.leads.aiTokensSpent}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.leads)
    .where(gte(schema.leads.lastAiRunAt, thirtyDaysAgo))

  const [last30Drafts] = await database
    .select({
      tokens: sql<number>`COALESCE(SUM(${schema.aiReplyDrafts.tokensSpent}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.aiReplyDrafts)
    .where(gte(schema.aiReplyDrafts.createdAt, thirtyDaysAgo))

  // Top 10 leads by spend
  const topLeads = await database
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      company: schema.leads.company,
      tokens: schema.leads.aiTokensSpent,
      score: schema.leads.aiScore,
      enrichedAt: schema.leads.enrichedAt,
    })
    .from(schema.leads)
    .where(isNotNull(schema.leads.aiTokensSpent))
    .orderBy(desc(schema.leads.aiTokensSpent))
    .limit(10)

  // Surface breakdown — drafts have their own tokens column we can
  // sum directly; enrichment is harder to isolate because it's rolled
  // into leads.aiTokensSpent. We estimate by counting enriched leads
  // and using a heuristic (~50k tokens per enrichment with web_search).
  const [enrichedCount] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.leads)
    .where(isNotNull(schema.leads.enrichedAt))

  return NextResponse.json({
    totals: {
      allTime: {
        tokens: Number(allTimeLeads?.tokens ?? 0) + Number(allTimeDrafts?.tokens ?? 0),
        leadTokens: Number(allTimeLeads?.tokens ?? 0),
        draftTokens: Number(allTimeDrafts?.tokens ?? 0),
        leads: Number(allTimeLeads?.count ?? 0),
        drafts: Number(allTimeDrafts?.count ?? 0),
      },
      last30Days: {
        tokens: Number(last30Leads?.tokens ?? 0) + Number(last30Drafts?.tokens ?? 0),
        leadTokens: Number(last30Leads?.tokens ?? 0),
        draftTokens: Number(last30Drafts?.tokens ?? 0),
        leads: Number(last30Leads?.count ?? 0),
        drafts: Number(last30Drafts?.count ?? 0),
      },
    },
    topLeads: topLeads.map(l => ({
      id: l.id,
      name: l.name,
      company: l.company,
      tokens: l.tokens,
      score: l.score,
      enriched: !!l.enrichedAt,
    })),
    enrichmentSurface: {
      enrichedLeads: Number(enrichedCount?.count ?? 0),
      estimatedTokens: Number(enrichedCount?.count ?? 0) * 50_000,  // rough
    },
    pricingNote: 'Rough cost guide: Haiku 4.5 = $1/M input + $5/M output. Sonnet 4.6 = $3/M input + $15/M output. With prompt caching the steady-state is ~10% of these for the cached prefix.',
  })
}
