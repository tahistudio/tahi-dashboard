/**
 * POST /api/admin/content/ideas/manual
 *
 * Creates a content idea from Liam's manual input (instead of from the
 * weekly ideation cron). Same shape as cron-generated ideas; lands as
 * `status='approved'` by default so it skips triage and goes straight
 * to the drafting queue when the next draft cron runs (or when Liam
 * clicks "Draft now").
 *
 * Also runs duplicate detection against existing ideas + published posts
 * via OpenAI embeddings (cosine similarity). Returns flagged duplicates
 * in the response so the UI can surface them BEFORE the user commits;
 * the route only persists if `?force=1` or no duplicates above the
 * similarity threshold.
 *
 * Contract:
 *   POST { title, angle?, targetKeyword?, clusterId?, rationale?, status? }
 *     -> 200 { idea, duplicates?: [{ title, slug?, similarity, source }] }
 *        when duplicates.length > 0 and force=0, idea is NOT persisted
 *        and `idea` is null
 *     -> 201 { idea } on success
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, isNotNull } from 'drizzle-orm'
import { embed, cosineSimilarity, isOpenAIConfigured } from '@/lib/openai'
import { recordCost } from '@/lib/ai-cost'
import { listCollectionItems } from '@/lib/webflow'
import { isoWeekLabel } from '@/lib/iso-week'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85

interface ManualIdeaBody {
  title?: string
  angle?: string
  targetKeyword?: string
  clusterId?: string
  rationale?: string
  status?: 'proposed' | 'approved'
  /** When true, skip duplicate detection and persist regardless. */
  force?: boolean
}

interface DuplicateMatch {
  source: 'existing_idea' | 'published_post'
  title: string
  slug?: string
  ideaId?: string
  similarity: number
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as ManualIdeaBody
  const title = body.title?.trim()
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

  const database = await db()

  // Duplicate detection: compute embedding for the new title + angle,
  // compare against existing ideas + Webflow blog post titles.
  let duplicates: DuplicateMatch[] = []
  if (!body.force) {
    try {
      duplicates = await detectDuplicates(database, title, body.angle ?? null)
    } catch (err) {
      // Embedding service down — log + continue. Don't block manual idea
      // creation on duplicate detection failure.
      console.error('Duplicate detection failed', err)
    }
  }

  if (duplicates.length > 0 && !body.force) {
    return NextResponse.json({
      idea: null,
      duplicates,
      message: `Found ${duplicates.length} near-duplicate${duplicates.length === 1 ? '' : 's'}. Re-submit with force=true to create anyway.`,
    }, { status: 200 })
  }

  const id = crypto.randomUUID()
  await database.insert(schema.contentIdeas).values({
    id,
    clusterId: body.clusterId ?? null,
    title,
    angle: body.angle?.trim() || null,
    targetKeyword: body.targetKeyword?.trim() || null,
    sourceSignal: 'manual',
    signalSources: null,
    recommendedWordCount: null,
    rationale: body.rationale?.trim() || 'Manually added by Liam',
    brand: null,
    score: null,
    status: body.status ?? 'approved',
    weekLabel: isoWeekLabel(),
    liamOpinion: null,
    liamAnswers: null,
  })

  return NextResponse.json({
    idea: { id, title, status: body.status ?? 'approved' },
    duplicates: [],
  }, { status: 201 })
}

async function detectDuplicates(
  database: Awaited<ReturnType<typeof db>>,
  title: string,
  angle: string | null,
): Promise<DuplicateMatch[]> {
  if (!isOpenAIConfigured()) {
    // Fall back to title substring match. Crude but fails closed.
    return await substringFallback(database, title)
  }

  const newText = angle ? `${title}. ${angle}` : title
  const newEmbedding = await embed(newText)
  let embedTokens = newEmbedding.inputTokens

  // Existing ideas (not rejected)
  const ideas = await database
    .select({
      id: schema.contentIdeas.id,
      title: schema.contentIdeas.title,
      angle: schema.contentIdeas.angle,
    })
    .from(schema.contentIdeas)
    .where(isNotNull(schema.contentIdeas.title))

  const ideaTexts = ideas.map(i => i.angle ? `${i.title}. ${i.angle}` : i.title)
  const ideaEmbeddings = await Promise.all(ideaTexts.map(t => embed(t)))
  embedTokens += ideaEmbeddings.reduce((s, e) => s + e.inputTokens, 0)

  const matches: DuplicateMatch[] = []
  for (let i = 0; i < ideas.length; i++) {
    const sim = cosineSimilarity(newEmbedding.vector, ideaEmbeddings[i].vector)
    if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
      matches.push({
        source: 'existing_idea',
        ideaId: ideas[i].id,
        title: ideas[i].title,
        similarity: Math.round(sim * 100) / 100,
      })
    }
  }

  // Published posts (Webflow blog collection titles)
  try {
    const { items } = await listCollectionItems(BLOG_POSTS_COLLECTION_ID, { limit: 100, offset: 0 })
    const postTitles = items.map(it => ({
      title: (it.fieldData.name as string) ?? '',
      slug: (it.fieldData.slug as string) ?? '',
      summary: (it.fieldData['summary-2'] as string) ?? (it.fieldData['post-description'] as string) ?? '',
    })).filter(p => p.title)
    const postTexts = postTitles.map(p => p.summary ? `${p.title}. ${p.summary.slice(0, 200)}` : p.title)
    const postEmbeddings = await Promise.all(postTexts.map(t => embed(t)))
    embedTokens += postEmbeddings.reduce((s, e) => s + e.inputTokens, 0)
    for (let i = 0; i < postTitles.length; i++) {
      const sim = cosineSimilarity(newEmbedding.vector, postEmbeddings[i].vector)
      if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
        matches.push({
          source: 'published_post',
          title: postTitles[i].title,
          slug: postTitles[i].slug,
          similarity: Math.round(sim * 100) / 100,
        })
      }
    }
  } catch (err) {
    console.error('Webflow listCollectionItems failed during duplicate check', err)
  }

  matches.sort((a, b) => b.similarity - a.similarity)

  // Record cost — embedding calls aren't free at scale even though
  // per-call cost is tiny. Logs to ai_cost_log for the spend dashboard.
  try {
    await recordCost(database, {
      scope: 'ideation',
      stage: 'duplicate_detection_embedding',
      provider: 'openai',
      model: 'text-embedding-3-small',
      inputTokens: embedTokens,
      note: `${ideas.length + (matches.filter(m => m.source === 'published_post').length)} comparisons`,
    })
  } catch { /* don't block on cost log failure */ }

  return matches.slice(0, 8)
}

async function substringFallback(
  database: Awaited<ReturnType<typeof db>>,
  title: string,
): Promise<DuplicateMatch[]> {
  const norm = title.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (norm.length === 0) return []
  const ideas = await database
    .select({ id: schema.contentIdeas.id, title: schema.contentIdeas.title })
    .from(schema.contentIdeas)
  const matches: DuplicateMatch[] = []
  for (const idea of ideas) {
    const ideaLower = idea.title.toLowerCase()
    const overlap = norm.filter(w => ideaLower.includes(w)).length / norm.length
    if (overlap >= 0.6) {
      matches.push({
        source: 'existing_idea',
        ideaId: idea.id,
        title: idea.title,
        similarity: Math.round(overlap * 100) / 100,
      })
    }
  }
  matches.sort((a, b) => b.similarity - a.similarity)
  return matches.slice(0, 8)
}
