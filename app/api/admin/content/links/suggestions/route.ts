/**
 * GET /api/admin/content/links/suggestions
 *
 * Phase I · Slice 6 — Lists patches grouped by target URL.
 *
 * Default: pending rows only. Pass ?status=all to include applied +
 * rejected (audit history). Includes the diff data the UI needs to
 * render each suggestion's before / after preview.
 *
 * Contract:
 *   GET /api/admin/content/links/suggestions
 *   GET /api/admin/content/links/suggestions?status=all
 *   200: {
 *     targets: Array<{
 *       targetUrl: string,
 *       targetTitle: string | null,
 *       targetPublishedAt: string | null,
 *       inboundLinkCount: number,        // existing inbound links count from blog_health
 *       suggestions: Array<{
 *         id, sourceWebflowId, sourceUrl, sourceTitle,
 *         matchPhrase, contextBefore, contextAfter,
 *         proposedAnchorText, justification, confidence,
 *         status, appliedAt, createdAt
 *       }>
 *     }>,
 *     totals: { pending, approved, applied, rejected }
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface SuggestionRow {
  id: string
  targetUrl: string
  targetTitle: string | null
  targetPublishedAt: string | null
  sourceWebflowId: string
  sourceUrl: string
  sourceTitle: string | null
  matchPhrase: string
  contextBefore: string | null
  contextAfter: string | null
  proposedAnchorText: string
  justification: string | null
  confidence: number
  status: string
  appliedAt: string | null
  createdAt: string
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const statusFilter = (searchParams.get('status') ?? 'pending').toLowerCase()

  const database = await db()

  // Pull suggestions. Default to pending only, but expose all/applied/etc
  // via the query param.
  const baseSelect = {
    id: schema.linkSuggestions.id,
    targetUrl: schema.linkSuggestions.targetUrl,
    targetTitle: schema.linkSuggestions.targetTitle,
    targetPublishedAt: schema.linkSuggestions.targetPublishedAt,
    sourceWebflowId: schema.linkSuggestions.sourceWebflowId,
    sourceUrl: schema.linkSuggestions.sourceUrl,
    sourceTitle: schema.linkSuggestions.sourceTitle,
    matchPhrase: schema.linkSuggestions.matchPhrase,
    contextBefore: schema.linkSuggestions.contextBefore,
    contextAfter: schema.linkSuggestions.contextAfter,
    proposedAnchorText: schema.linkSuggestions.proposedAnchorText,
    justification: schema.linkSuggestions.justification,
    confidence: schema.linkSuggestions.confidence,
    status: schema.linkSuggestions.status,
    appliedAt: schema.linkSuggestions.appliedAt,
    createdAt: schema.linkSuggestions.createdAt,
  }

  let rows: SuggestionRow[]
  try {
    if (statusFilter === 'all') {
      rows = await database
        .select(baseSelect)
        .from(schema.linkSuggestions)
        .orderBy(desc(schema.linkSuggestions.createdAt)) as SuggestionRow[]
    } else {
      const allowed = ['pending', 'approved', 'applied', 'rejected']
      const status = allowed.includes(statusFilter) ? statusFilter : 'pending'
      rows = await database
        .select(baseSelect)
        .from(schema.linkSuggestions)
        .where(eq(schema.linkSuggestions.status, status))
        .orderBy(desc(schema.linkSuggestions.createdAt)) as SuggestionRow[]
    }
  } catch (err) {
    console.error('link suggestions select failed', err)
    rows = []
  }

  // Group by target URL.
  const grouped = new Map<string, {
    targetUrl: string
    targetTitle: string | null
    targetPublishedAt: string | null
    suggestions: SuggestionRow[]
  }>()
  for (const r of rows) {
    let g = grouped.get(r.targetUrl)
    if (!g) {
      g = {
        targetUrl: r.targetUrl,
        targetTitle: r.targetTitle,
        targetPublishedAt: r.targetPublishedAt,
        suggestions: [],
      }
      grouped.set(r.targetUrl, g)
    }
    g.suggestions.push(r)
  }

  // Sort each target's suggestions by confidence desc.
  for (const g of grouped.values()) {
    g.suggestions.sort((a, b) => b.confidence - a.confidence)
  }

  // Inbound link counts from blog_health (best-effort, matched on URL).
  const urls = Array.from(grouped.keys())
  const inboundByUrl = new Map<string, number>()
  if (urls.length > 0) {
    try {
      const healthRows = await database
        .select({
          url: schema.blogHealth.url,
          inbound: schema.blogHealth.inboundInternalLinks,
        })
        .from(schema.blogHealth)
        .where(inArray(schema.blogHealth.url, urls))
      for (const h of healthRows) inboundByUrl.set(h.url, h.inbound ?? 0)
    } catch {
      // optional — leave the map empty
    }
  }

  const targets = Array.from(grouped.values())
    .map(g => ({
      targetUrl: g.targetUrl,
      targetTitle: g.targetTitle,
      targetPublishedAt: g.targetPublishedAt,
      inboundLinkCount: inboundByUrl.get(g.targetUrl) ?? 0,
      suggestions: g.suggestions,
    }))
    // Most-recent target first (by the freshest publish date, NULL last).
    .sort((a, b) => {
      const ap = a.targetPublishedAt ?? ''
      const bp = b.targetPublishedAt ?? ''
      return bp.localeCompare(ap)
    })

  const totals = { pending: 0, approved: 0, applied: 0, rejected: 0 }
  for (const r of rows) {
    if (r.status in totals) totals[r.status as keyof typeof totals]++
  }

  return NextResponse.json({ targets, totals })
}
