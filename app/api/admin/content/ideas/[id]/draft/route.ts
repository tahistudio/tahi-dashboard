/**
 * POST /api/admin/content/ideas/[id]/draft
 *
 * The Phase I · Slice 2 drafting orchestrator. Kicks off the full
 * multi-agent chain for a single content idea:
 *
 *   research -> link-validate -> writer + reviewers + EIC -> schema
 *   additions -> hreflang -> cover SVG -> R2 upload -> mark idea drafted
 *
 * Idempotency: if the idea already has a `ready` draft, re-running
 * returns the existing row unchanged unless `force=true` is passed in
 * the body. A `failed` draft can always be re-run (it gets replaced).
 *
 * This route is long-running (5 Anthropic calls + web fetches). The
 * function is configured for the maximum Cloudflare Workers timeout so
 * the chain has room to land. Long-term we'll move to a queue.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { loadAiContextDocs } from '@/lib/ai-context'
import { researchIdea } from '@/lib/blog-researcher'
import { validateExternalLinks } from '@/lib/link-validator'
import { runDraftingPipeline, type DraftingInput } from '@/lib/blog-writer'
import { buildBlogSchemaAdditions, buildHreflangBlock } from '@/lib/blog-schema'
import { buildBlogCover, uploadCoverToR2 } from '@/lib/blog-cover'

export const dynamic = 'force-dynamic'
// Cloudflare Workers cap. Set high so the agent chain has room.
export const maxDuration = 60

const TAHI_BLOG_BASE = 'https://www.tahi.studio/blog'
const SITEMAP_URL = 'https://www.tahi.studio/sitemap.xml'

// ── Sitemap loader (inline so we don't HTTP-loopback) ─────────────────────

async function fetchSitemapUrls(rootUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  const res = await fetch(rootUrl, {
    headers: { Accept: 'application/xml, text/xml, */*' },
  })
  if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status} ${rootUrl}`)
  const xml = await res.text()
  const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).map(m => m[1])
  const isIndex = /<sitemapindex/i.test(xml)
  if (!isIndex) return locs
  const urls: string[] = []
  for (const sub of locs) {
    try {
      urls.push(...await fetchSitemapUrls(sub, depth + 1))
    } catch {
      // Swallow sub-fetch failures so a single broken sub-sitemap doesn't
      // sink the whole drafting pipeline.
    }
  }
  return urls
}

// ── Slug helper ──────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ── Word count helper ────────────────────────────────────────────────────

function countWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`\[\]()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .length
}

// ── Author lookup ────────────────────────────────────────────────────────

interface AuthorInfo {
  name: string
  jobTitle: string
  linkedIn?: string | null
  bio?: string | null
  image?: string | null
}

function authorInfoFor(slug: 'liam' | 'staci'): AuthorInfo {
  if (slug === 'staci') {
    return {
      name: 'Staci Miller',
      jobTitle: 'Co-founder, Design',
      linkedIn: null,
      bio: null,
      image: null,
    }
  }
  return {
    name: 'Liam Miller',
    jobTitle: 'Founder, Tahi Studio',
    linkedIn: null,
    bio: null,
    image: null,
  }
}

// ── Status update helper ─────────────────────────────────────────────────

type DraftStatus = 'queued' | 'researching' | 'drafting' | 'reviewing' | 'finalising' | 'ready' | 'failed'

async function setDraftStatus(
  database: Awaited<ReturnType<typeof db>>,
  draftId: string,
  status: DraftStatus,
  patch: Partial<typeof schema.contentDrafts.$inferInsert> = {},
) {
  await database
    .update(schema.contentDrafts)
    .set({
      status,
      ...patch,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.contentDrafts.id, draftId))
}

// ── Route ────────────────────────────────────────────────────────────────

interface BodyShape {
  force?: boolean
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Idea id is required' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as BodyShape
  const force = body.force === true

  const database = await db()

  // 1) Load idea + cluster
  const [idea] = await database
    .select()
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.id, id))
    .limit(1)
  if (!idea) {
    return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  }

  let cluster: { id: string; name: string; slug: string; description: string | null } | null = null
  if (idea.clusterId) {
    const [c] = await database
      .select({
        id: schema.contentClusters.id,
        name: schema.contentClusters.name,
        slug: schema.contentClusters.slug,
        description: schema.contentClusters.description,
      })
      .from(schema.contentClusters)
      .where(eq(schema.contentClusters.id, idea.clusterId))
      .limit(1)
    if (c) cluster = c
  }
  if (!cluster) {
    return NextResponse.json({
      error: 'Idea has no cluster assigned. Re-run ideation or attach a cluster before drafting.',
    }, { status: 400 })
  }

  // 2) Check existing draft
  const [existingDraft] = await database
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.ideaId, id))
    .orderBy(desc(schema.contentDrafts.createdAt))
    .limit(1)

  if (existingDraft && existingDraft.status === 'ready' && !force) {
    return NextResponse.json({
      ok: true,
      draftId: existingDraft.id,
      status: existingDraft.status,
      reused: true,
      message: 'Idea already has a ready draft. Pass { force: true } to re-draft.',
    })
  }

  // Reuse an existing row if we're re-running a failed draft; otherwise
  // insert a fresh one so each attempt has its own audit trail.
  let draftId: string
  const now = new Date().toISOString()
  if (existingDraft && (existingDraft.status === 'failed' || force)) {
    draftId = existingDraft.id
    await database
      .update(schema.contentDrafts)
      .set({
        status: 'researching',
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(schema.contentDrafts.id, draftId))
  } else {
    draftId = crypto.randomUUID()
    await database.insert(schema.contentDrafts).values({
      id: draftId,
      ideaId: id,
      status: 'researching',
      createdAt: now,
      updatedAt: now,
    })
  }

  try {
    // 3) Load Tahi context docs
    const docs = await loadAiContextDocs(['icp', 'brandDna', 'tone', 'liamVoice', 'aiTells', 'services'])

    // 4) Load sitemap URLs in parallel with research
    const sitemapPromise = fetchSitemapUrls(SITEMAP_URL).catch(() => [] as string[])

    // 5) Research with web search
    const research = await researchIdea({
      idea: {
        title: idea.title,
        angle: idea.angle,
        targetKeyword: idea.targetKeyword,
        rationale: idea.rationale,
      },
      cluster: {
        name: cluster.name,
        slug: cluster.slug,
        description: cluster.description,
      },
    })

    await setDraftStatus(database, draftId, 'drafting', {
      researchSummary: research.researchSummary,
    })

    // 6) Validate external citation URLs strict-200
    const validation = await validateExternalLinks(
      research.candidateCitations.map(c => c.url),
    )
    const validatedCitations = validation.valid.map(v => ({ url: v.url }))

    await database
      .update(schema.contentDrafts)
      .set({
        validatedCitations: JSON.stringify(validatedCitations),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contentDrafts.id, draftId))

    // 7) Build the writer input + run the chain
    const siteUrlInventory = Array.from(new Set(await sitemapPromise))

    let liamAnswers: Array<{ q: string; a: string }> | null = null
    if (idea.liamAnswers) {
      try {
        const parsed = JSON.parse(idea.liamAnswers)
        if (Array.isArray(parsed)) {
          liamAnswers = parsed
            .filter((q): q is { q: string; a: string } =>
              !!q && typeof q === 'object'
              && typeof (q as { q?: unknown }).q === 'string'
              && typeof (q as { a?: unknown }).a === 'string',
            )
            .filter(q => q.a.trim().length > 0)
        }
      } catch {
        // ignore malformed JSON — drafting can proceed without
      }
    }

    const draftingInput: DraftingInput = {
      idea: {
        title: idea.title,
        angle: idea.angle,
        targetKeyword: idea.targetKeyword,
        recommendedWordCount: idea.recommendedWordCount,
        rationale: idea.rationale,
        brand: idea.brand,
      },
      cluster: {
        name: cluster.name,
        slug: cluster.slug,
        description: cluster.description,
      },
      liamOpinion: idea.liamOpinion,
      liamAnswers,
      siteUrlInventory,
      tahiContextDocs: {
        icp: docs.icp,
        brandDna: docs.brandDna,
        toneOfVoice: docs.tone,
        liamVoice: docs.liamVoice,
        aiTells: docs.aiTells,
        services: docs.services,
      },
      validatedCitations,
      researchSummary: research.researchSummary,
    }

    await setDraftStatus(database, draftId, 'reviewing')
    const pipeline = await runDraftingPipeline(draftingInput)

    await setDraftStatus(database, draftId, 'finalising', {
      bodyMarkdown: pipeline.bodyMarkdown,
      bodyHtml: pipeline.bodyHtml,
      title: pipeline.title,
      metaTitle: pipeline.metaTitle,
      metaDescription: pipeline.metaDescription,
      postExcerpt: pipeline.postExcerpt,
      shortenedName: pipeline.shortenedName,
      summary: pipeline.summary,
      keyTakeaways: pipeline.keyTakeaways,
      faqsJson: JSON.stringify(pipeline.faqs),
      postType: pipeline.postType,
      salesNotes: pipeline.salesNotes,
      readabilityNotes: pipeline.readabilityNotes,
      contentScore: pipeline.contentScore,
      scoreBreakdown: JSON.stringify(pipeline.scoreBreakdown),
      authorSlug: idea.brand?.toLowerCase() === 'staci' ? 'staci' : 'liam',
      mainCategorySlug: cluster.slug,
    })

    // 8) Schema additions (JSON-LD)
    const author = authorInfoFor(idea.brand?.toLowerCase() === 'staci' ? 'staci' : 'liam')
    const slug = slugify(pipeline.shortenedName || pipeline.title)
    const canonicalUrl = `${TAHI_BLOG_BASE}/${slug}`
    const wordCount = countWords(pipeline.bodyMarkdown)
    const publishedAt = new Date().toISOString()

    const schemaOut = buildBlogSchemaAdditions({
      url: canonicalUrl,
      title: pipeline.title,
      metaDescription: pipeline.metaDescription,
      bodyMarkdown: pipeline.bodyMarkdown,
      bodyHtml: pipeline.bodyHtml,
      publishedAt,
      updatedAt: publishedAt,
      authorName: author.name,
      authorJobTitle: author.jobTitle,
      authorLinkedIn: author.linkedIn,
      authorBio: author.bio,
      authorImage: author.image,
      imageUrl: '',                 // populated post-cover-upload below
      mainCategory: cluster.name,
      categories: [cluster.name],
      wordCount,
      faqs: pipeline.faqs.map(f => ({ question: f.q, answer: f.a })),
      postType: pipeline.postType,
      citations: validatedCitations,
    })

    // 9) Hreflang block
    const hreflangBlock = buildHreflangBlock(canonicalUrl)

    // 10) Build + upload SVG cover
    let coverSvgUrl: string | null = null
    let coverTemplate: string | null = null
    try {
      const { env } = await getCloudflareContext({ async: true })
      const storage = (env as unknown as { STORAGE?: R2Bucket })
      if (storage?.STORAGE) {
        const cover = buildBlogCover({ title: pipeline.title })
        const uploaded = await uploadCoverToR2(
          { STORAGE: storage.STORAGE },
          cover.filename.replace(/\.svg$/i, ''),
          cover.svg,
        )
        coverSvgUrl = uploaded.url
        coverTemplate = cover.template
      }
    } catch (err) {
      // Cover failure is non-fatal — the draft still ships, Liam can
      // regenerate the cover from the SlideOver. Surface the reason in
      // logs so we can debug.
      console.error('cover generation failed', err)
    }

    // If we got a cover URL, re-emit the JSON-LD with the image populated.
    // Re-runs are deterministic, so this is cheap.
    let finalSchemaJsonLd = schemaOut.jsonLdString
    if (coverSvgUrl) {
      const reEmitted = buildBlogSchemaAdditions({
        url: canonicalUrl,
        title: pipeline.title,
        metaDescription: pipeline.metaDescription,
        bodyMarkdown: pipeline.bodyMarkdown,
        bodyHtml: pipeline.bodyHtml,
        publishedAt,
        updatedAt: publishedAt,
        authorName: author.name,
        authorJobTitle: author.jobTitle,
        authorLinkedIn: author.linkedIn,
        authorBio: author.bio,
        authorImage: author.image,
        imageUrl: coverSvgUrl,
        mainCategory: cluster.name,
        categories: [cluster.name],
        wordCount,
        faqs: pipeline.faqs.map(f => ({ question: f.q, answer: f.a })),
        postType: pipeline.postType,
        citations: validatedCitations,
      })
      finalSchemaJsonLd = reEmitted.jsonLdString
    }

    // 11) Persist final fields + flip to ready
    const readyAt = new Date().toISOString()
    await database
      .update(schema.contentDrafts)
      .set({
        status: 'ready',
        schemaJsonLd: finalSchemaJsonLd,
        hreflangBlock,
        coverSvgUrl,
        coverTemplate,
        errorMessage: null,
        updatedAt: readyAt,
      })
      .where(eq(schema.contentDrafts.id, draftId))

    // 12) Mark idea as drafted
    await database
      .update(schema.contentIdeas)
      .set({
        status: 'drafted',
        updatedAt: readyAt,
      })
      .where(eq(schema.contentIdeas.id, id))

    return NextResponse.json({
      ok: true,
      draftId,
      status: 'ready',
      contentScore: pipeline.contentScore,
      scoreBreakdown: pipeline.scoreBreakdown,
      validatedCitations,
      invalidCitations: validation.invalid,
      tokensUsed: pipeline.tokensUsed,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('drafting pipeline failed', err)
    try {
      await database
        .update(schema.contentDrafts)
        .set({
          status: 'failed',
          errorMessage: message.slice(0, 1000),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.contentDrafts.id, draftId))
    } catch {
      // best effort — never break the response on a logging failure
    }
    return NextResponse.json({
      ok: false,
      draftId,
      status: 'failed',
      error: 'Drafting pipeline failed',
      detail: message,
    }, { status: 500 })
  }
  // Re-export utilities used in this file just to keep tree-shaking
  // honest about side-effect-free imports.
  void inArray
  void and
}
