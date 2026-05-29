/**
 * GET  /api/admin/content/audits
 *   List all audit shadow drafts with their score + status.
 *
 * POST /api/admin/content/audits
 *   Create an audit shadow draft for a published Webflow blog post.
 *   Body: { webflowItemId: string } OR { slug: string }
 *
 *   Fetches the post from Webflow, synthesises a brief retroactively
 *   from the existing title + meta + body via Sonnet, creates a draft
 *   row with status='reviewing' (skipping research/strategist/headline/
 *   writer — the body already exists), and lets the auto-tick walk it
 *   through reviewers → editor → sign-off → 'audited'.
 *
 *   The shadow draft is keyed off audit_target_webflow_id; calling the
 *   endpoint again for the same Webflow item returns the existing audit.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'
import { getBlogPostsCollectionId, getCollectionItem, listCollectionItems } from '@/lib/webflow'
import { claudeJson } from '@/lib/anthropic-cost'
import { SONNET_MODEL } from '@/lib/ai-models'
import { parseStrategist, type StrategistOutput } from '@/lib/round-table-leads'

// Local HTML → markdown shim. Mirrors what lib/blog-schema-input does
// internally (that one isn't exported). Crude but good enough for the
// reviewer + strategist prompt input — we just need readable text.
function htmlToPseudoMarkdown(html: string): string {
  return html
    .replace(/<h([2-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, t: string) => `\n\n${'#'.repeat(Number(level))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<ul[^>]*>|<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>|<\/ol>/gi, '\n')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
import { DEFAULT_VOICE_WEIGHTS } from '@/lib/round-table-reviewers'

export const dynamic = 'force-dynamic'

const AUDIT_BRIEF_SYSTEM = `You synthesise a retroactive content brief from an EXISTING published blog post on a Webflow agency's site (Tahi Studio). The post is already live. Your job is to extract what the brief WOULD HAVE BEEN: intent, primary + secondary keywords, content bucket, voice weights, schema types, target word count (the current word count), and the angle. Do not propose changes — just describe what the article currently IS. This brief feeds 23 reviewers who will score the post; calibrate the contentBucket honestly so reviewers' bars are right (novel = strict originality, generic = clarity, data = methodology).`

const AUDIT_BRIEF_USER = (input: { title: string; metaDescription: string; bodyMarkdown: string; categoryName: string }) => `Title: ${input.title}
Meta description: ${input.metaDescription}
Category: ${input.categoryName}

## Body
${input.bodyMarkdown.slice(0, 12000)}

Respond JSON only:

{
  "intent": "tofu_educational|mofu_comparison|bofu_conversion|how_to|thought_leadership|listicle|case_study|refresh",
  "priority": "standard",
  "author": "liam|staci",
  "contentBucket": "generic|novel|data",
  "workingTitle": "the actual title above",
  "angle": "one-sentence what this article is actually arguing or covering",
  "targetWordCount": number,
  "primaryKeyword": "extracted from title + body",
  "secondaryKeywords": ["..."],
  "lsiTerms": ["..."],
  "schemaTypes": ["Article", "FAQPage"],
  "faqCount": number,
  "headings": [{ "level": 2, "text": "actual H2 text from body", "wordTarget": number, "mustCover": ["actual coverage in this section"] }],
  "internalLinkTargets": [],
  "outboundCitationTargets": number,
  "imageCount": number,
  "voiceWeights": {},
  "rationale": "what this article currently does + who wrote it (liam or staci) based on tone/topic"
}`

interface CreateAuditBody {
  webflowItemId?: string
  slug?: string
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db()
  const rows = await database
    .select({
      id: schema.contentDrafts.id,
      title: schema.contentDrafts.title,
      status: schema.contentDrafts.status,
      contentScore: schema.contentDrafts.contentScore,
      auditTargetWebflowId: schema.contentDrafts.auditTargetWebflowId,
      errorMessage: schema.contentDrafts.errorMessage,
      createdAt: schema.contentDrafts.createdAt,
      updatedAt: schema.contentDrafts.updatedAt,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.originSource, 'legacy_audit'))
    .orderBy(desc(schema.contentDrafts.updatedAt))
    .limit(200)

  return NextResponse.json({ audits: rows })
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as CreateAuditBody
  const slug = body.slug?.trim().replace(/^\//, '').replace(/^blog\//, '')
  let webflowItemId = body.webflowItemId?.trim()
  if (!webflowItemId && !slug) {
    return NextResponse.json({ error: 'Provide webflowItemId or slug' }, { status: 400 })
  }

  const database = await db()

  // Resolve the Webflow item.
  let collectionId: string
  try {
    collectionId = await getBlogPostsCollectionId()
  } catch {
    return NextResponse.json({ error: 'WEBFLOW_TOKEN not configured or Webflow unreachable' }, { status: 503 })
  }

  if (!webflowItemId && slug) {
    // Walk the collection to find the slug.
    try {
      let offset = 0
      for (let i = 0; i < 5; i++) {
        const { items, total } = await listCollectionItems(collectionId, { limit: 100, offset })
        for (const it of items) {
          const s = (it.fieldData?.slug as string | undefined) ?? ''
          if (s === slug) { webflowItemId = it.id; break }
        }
        if (webflowItemId) break
        if (items.length < 100) break
        offset += items.length
        if (offset >= total) break
      }
    } catch (err) {
      return NextResponse.json({ error: 'Failed to look up Webflow item by slug', detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
    }
  }
  if (!webflowItemId) {
    return NextResponse.json({ error: 'Webflow item not found for that slug' }, { status: 404 })
  }

  // Existing audit for this post? Return it (don't duplicate spend).
  const [existing] = await database
    .select({ id: schema.contentDrafts.id, status: schema.contentDrafts.status, contentScore: schema.contentDrafts.contentScore })
    .from(schema.contentDrafts)
    .where(and(
      eq(schema.contentDrafts.originSource, 'legacy_audit'),
      eq(schema.contentDrafts.auditTargetWebflowId, webflowItemId),
    ))
    .limit(1)
  if (existing) {
    return NextResponse.json({ ok: true, draftId: existing.id, status: existing.status, contentScore: existing.contentScore, message: 'Audit already exists for this Webflow item.' })
  }

  // Fetch the Webflow item.
  const item = await getCollectionItem(collectionId, webflowItemId).catch(() => null)
  if (!item) return NextResponse.json({ error: 'Webflow item fetch failed' }, { status: 502 })
  const f = item.fieldData as Record<string, unknown>
  const title = (f['name'] as string | undefined) ?? (f['meta-title'] as string | undefined) ?? 'Untitled'
  const metaDescription = (f['meta-description-2'] as string | undefined) ?? (f['post-description'] as string | undefined) ?? ''
  const bodyHtml = (f['post-body'] as string | undefined) ?? ''
  if (!bodyHtml) return NextResponse.json({ error: 'Webflow item has no post-body to audit' }, { status: 400 })
  const bodyMarkdown = htmlToPseudoMarkdown(bodyHtml)

  // Try to resolve category name (best-effort; reviewers can still run without it).
  let categoryName = ''
  try {
    const { loadBlogReferenceLookups } = await import('@/lib/webflow')
    const refs = await loadBlogReferenceLookups()
    const raw = f['main-category']
    if (typeof raw === 'string') categoryName = refs.categoryNameById.get(raw) ?? ''
  } catch { /* leave empty */ }

  // Synthesise the brief retroactively via Sonnet (no Perplexity needed).
  // We pre-create the draft row so the cost-log call has a scopeId to
  // hang on; then we update it with the brief once we have it.
  const draftId = crypto.randomUUID()
  const now = new Date().toISOString()
  // Audit drafts don't have a real "idea" — but the FK is NOT NULL. So we
  // create a sidecar idea row tagged so it's clearly an audit placeholder.
  await database.insert(schema.contentIdeas).values({
    title: `[AUDIT] ${title}`,
    angle: 'Retroactive audit of an existing published post',
    status: 'drafted',
    sourceSignal: 'legacy_audit',
  })
  // contentIdeas auto-generates id; pull it back out for the foreign key.
  const [insertedIdea] = await database
    .select({ id: schema.contentIdeas.id })
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.title, `[AUDIT] ${title}`))
    .orderBy(desc(schema.contentIdeas.createdAt))
    .limit(1)
  const ideaId = insertedIdea?.id ?? crypto.randomUUID()

  await database.insert(schema.contentDrafts).values({
    id: draftId,
    ideaId,
    status: 'queued',  // bumped below once brief is in
    title,
    metaTitle: title,
    metaDescription,
    bodyHtml,
    bodyMarkdown,
    originSource: 'legacy_audit',
    auditTargetWebflowId: webflowItemId,
    createdAt: now,
    updatedAt: now,
  })

  let brief: StrategistOutput
  try {
    const { result } = await claudeJson({
      database, scope: 'draft', scopeId: draftId, stage: 'audit_brief',
      model: SONNET_MODEL, maxTokens: 3500,
      skipCostCap: true,
      systemPrompt: AUDIT_BRIEF_SYSTEM,
      userPrompt: AUDIT_BRIEF_USER({ title, metaDescription, bodyMarkdown, categoryName }),
      parse: parseStrategist,
    })
    brief = result
  } catch (err) {
    return NextResponse.json({ error: 'Brief synthesis failed', detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }

  // Apply default voice weights for this intent + strategist overrides.
  const effectiveWeights = { ...(DEFAULT_VOICE_WEIGHTS[brief.intent] ?? {}), ...brief.voiceWeights }

  // Persist the brief + flip status to 'reviewing'. The auto-tick (or
  // the cron) will pick this up and run all 23 reviewers next.
  await database.update(schema.contentDrafts).set({
    status: 'reviewing',
    authorSlug: brief.author,
    postType: brief.intent,
    scoreBreakdown: JSON.stringify({ brief, voiceWeights: effectiveWeights }),
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.contentDrafts.id, draftId))

  return NextResponse.json({
    ok: true,
    draftId,
    status: 'reviewing',
    auditTargetWebflowId: webflowItemId,
    title,
    message: 'Audit created. The 23 reviewers will run next; open the round-table page to watch progress.',
  })
}
