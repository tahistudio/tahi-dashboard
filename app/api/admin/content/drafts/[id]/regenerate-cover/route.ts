/**
 * POST /api/admin/content/drafts/[id]/regenerate-cover
 *
 * Regenerates the draft's cover image. Two modes:
 *   - 'flux' (default): Flux 1.1 Pro via Replicate, using the tuned
 *     reference-aligned prompt (forest base, diamond gradient, flat
 *     abstract scene, NO text).
 *   - 'svg': the deterministic on-brand SVG generator (editable, never
 *     glitches text). Stored as a data URI so it previews immediately.
 *
 * Lets Liam A/B the two approaches and re-roll Flux until one lands.
 *
 * Contract:
 *   POST { mode?: 'flux' | 'svg', prompt?: string }
 *     -> { coverUrl, mode, mocked?, costCents }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { generateCover, isReplicateConfigured } from '@/lib/replicate'
import { recordCost } from '@/lib/ai-cost'
import { generateCoverSvg } from '@/lib/blog-cover-svg'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { mode?: 'flux' | 'svg'; prompt?: string }
  const mode = body.mode === 'svg' ? 'svg' : 'flux'

  const database = await db()
  const [draft] = await database
    .select({
      id: schema.contentDrafts.id,
      title: schema.contentDrafts.title,
      metaDescription: schema.contentDrafts.metaDescription,
      postType: schema.contentDrafts.postType,
      ideaId: schema.contentDrafts.ideaId,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  // Topic for the SVG motif picker / Flux subject.
  let topic = draft.title ?? ''
  if (draft.ideaId) {
    const [idea] = await database
      .select({ targetKeyword: schema.contentIdeas.targetKeyword })
      .from(schema.contentIdeas)
      .where(eq(schema.contentIdeas.id, draft.ideaId))
      .limit(1)
    if (idea?.targetKeyword) topic = idea.targetKeyword
  }

  if (mode === 'svg') {
    const svg = generateCoverSvg({ title: draft.title ?? 'Untitled', topic })
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    await database.update(schema.contentDrafts).set({
      coverSvgUrl: dataUri,
      coverTemplate: 'svg-generator',
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.contentDrafts.id, id))
    return NextResponse.json({ coverUrl: dataUri, mode: 'svg', mocked: false, costCents: 0 })
  }

  // Flux
  const subject = body.prompt?.trim()
    || `the theme of "${draft.title}"${draft.metaDescription ? ` (${draft.metaDescription})` : ''}`
  try {
    const cover = await generateCover(subject, { aspectRatio: '16:9' })
    const costCents = await recordCost(database, {
      scope: 'draft', scopeId: id, stage: 'flux_cover_regen',
      provider: 'replicate', model: 'black-forest-labs/flux-1.1-pro',
      callUnits: 1,
      note: cover.mocked ? 'mocked (no REPLICATE_API_TOKEN)' : `regen ${cover.predictionId}`,
    })
    await database.update(schema.contentDrafts).set({
      coverSvgUrl: cover.url,
      coverTemplate: cover.mocked ? 'mock' : 'flux-1.1-pro',
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.contentDrafts.id, id))
    return NextResponse.json({ coverUrl: cover.url, mode: 'flux', mocked: cover.mocked ?? false, costCents })
  } catch (err) {
    return NextResponse.json({
      error: 'Cover generation failed',
      detail: err instanceof Error ? err.message : String(err),
      replicateConfigured: isReplicateConfigured(),
    }, { status: 502 })
  }
}
