/**
 * Webflow field finalisation — Phase I · Slice 9.
 *
 * Closes the CMS-field gaps the round-table pipeline left empty:
 *   - main-category / other-categories  (mapped to a REAL Webflow category)
 *   - schema (JSON-LD, generated + validated)
 *   - hreflang-block
 *
 * Called after the structuring step (in the orchestrator + the restructure
 * endpoint) so a draft reaches Webflow with every field populated, not just
 * the body. Pure-ish: reads the draft + Webflow categories, writes the
 * extras back onto the draft.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadBlogReferenceLookups } from '@/lib/webflow'
import {
  buildBlogSchemaAdditions, buildHreflangBlock, detectPostType, extractEntities,
  type SchemaInput,
} from '@/lib/blog-schema'
import { validateJsonLd, type SchemaValidationResult } from '@/lib/schema-validate'
import { validateAllLinks } from '@/lib/link-validator'

type Database = Awaited<ReturnType<typeof db>>

const TAHI_BLOG_BASE = 'https://www.tahi.studio/blog'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export interface LinkCheck {
  total: number
  okCount: number
  deadCount: number
  dead: Array<{ url: string; status: number | null; reason: string }>
  checkedAt: string
}

export interface FinalizeResult {
  mainCategorySlug: string | null
  otherCategorySlugs: string[]
  schemaValid: boolean
  schemaErrors: SchemaValidationResult['errors']
  schemaWarnings: SchemaValidationResult['warnings']
  hreflangSet: boolean
  linkCheck: LinkCheck
}

/** Resolve the best Webflow category slug for a cluster/topic. Matches
 *  against the LIVE category list so we always land on a real category
 *  (publish requires one). Falls back to the first category if nothing
 *  matches, so publish is never blocked. */
function resolveCategory(
  clusterName: string,
  categorySlugs: string[],
): { main: string | null; rest: string[] } {
  if (categorySlugs.length === 0) return { main: null, rest: [] }
  const clusterSlug = slugify(clusterName)
  const clusterWords = clusterName.toLowerCase().split(/\s+/).filter(w => w.length > 3)

  // 1) exact slug match
  let main = categorySlugs.find(s => s === clusterSlug) ?? null
  // 2) slug contains / contained-by
  if (!main) main = categorySlugs.find(s => s.includes(clusterSlug) || clusterSlug.includes(s)) ?? null
  // 3) word overlap
  if (!main) {
    main = categorySlugs.find(s => clusterWords.some(w => s.includes(w))) ?? null
  }
  // 4) fallback: first category (never block publish on a missing match)
  if (!main) main = categorySlugs[0]
  return { main, rest: [] }
}

export async function finalizeWebflowFields(database: Database, draftId: string): Promise<FinalizeResult> {
  const [draft] = await database
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, draftId))
    .limit(1)
  if (!draft) throw new Error('Draft not found')

  // Resolve cluster name via the idea.
  let clusterName = ''
  if (draft.ideaId) {
    const [idea] = await database
      .select({ clusterId: schema.contentIdeas.clusterId, title: schema.contentIdeas.title })
      .from(schema.contentIdeas)
      .where(eq(schema.contentIdeas.id, draft.ideaId))
      .limit(1)
    if (idea?.clusterId) {
      const [cluster] = await database
        .select({ name: schema.contentClusters.name, slug: schema.contentClusters.slug })
        .from(schema.contentClusters)
        .where(eq(schema.contentClusters.id, idea.clusterId))
        .limit(1)
      clusterName = cluster?.name ?? cluster?.slug ?? ''
    }
  }

  // Live Webflow categories.
  let categorySlugs: string[] = []
  try {
    const refs = await loadBlogReferenceLookups()
    categorySlugs = Array.from(refs.categoriesBySlug.keys())
  } catch {
    categorySlugs = []
  }
  const { main: mainCategorySlug, rest: otherCategorySlugs } = resolveCategory(clusterName, categorySlugs)

  // Canonical URL for schema + hreflang (slug derives from title, matching
  // the publish route's slugify).
  const slug = slugify(draft.title ?? draft.shortenedName ?? draftId)
  const url = `${TAHI_BLOG_BASE}/${slug}`

  // Build JSON-LD from the structured fields.
  const faqs: Array<{ q: string; a: string }> = (() => {
    try { return JSON.parse(draft.faqsJson ?? '[]') } catch { return [] }
  })()
  const bodyMarkdown = draft.bodyMarkdown ?? ''
  const bodyHtml = draft.bodyHtml ?? ''
  const now = new Date().toISOString()
  const title = draft.title ?? ''
  const entities = extractEntities(bodyMarkdown)
  const schemaInput: SchemaInput = {
    url,
    title,
    metaDescription: draft.metaDescription ?? draft.summary ?? '',
    bodyMarkdown,
    bodyHtml,
    publishedAt: draft.publishedAt ?? now,
    updatedAt: now,
    // authorSlug is set by the strategist ('liam' | 'staci'). Map to the
    // full name so blog-schema's AUTHOR_PROFILES lookup hits. Fallback
    // is Liam if the slug is missing/unknown.
    authorName: draft.authorSlug === 'staci' ? 'Staci Bonnie' : 'Liam Miller',
    authorJobTitle: draft.authorSlug === 'staci' ? 'Co-Founder and Head of Design' : 'Co-Founder and CEO',
    imageUrl: draft.coverSvgUrl ?? `${TAHI_BLOG_BASE}`,
    mainCategory: clusterName || (mainCategorySlug ?? 'General'),
    wordCount: bodyMarkdown.split(/\s+/).filter(Boolean).length,
    faqs: faqs.map(f => ({ question: f.q, answer: f.a })),
    postType: detectPostType(title, bodyMarkdown),
    mentions: entities.mentions,
    aboutEntities: entities.aboutEntities,
    citations: entities.citations,
  }

  let schemaJsonLd = ''
  let validation: SchemaValidationResult = { valid: true, errors: [], warnings: [] }
  try {
    const out = buildBlogSchemaAdditions(schemaInput)
    schemaJsonLd = out.jsonLdString
    validation = validateJsonLd(schemaJsonLd)
  } catch (err) {
    validation = { valid: false, errors: [{ severity: 'error', node: 'generator', field: '-', message: err instanceof Error ? err.message : 'schema gen failed' }], warnings: [] }
  }

  const hreflangBlock = buildHreflangBlock(url)

  // FINAL link gate — HTTP-check every link (internal + external) for 200.
  // No dead links (404/401/403/redirect/timeout) ship.
  let linkCheck: LinkCheck = { total: 0, okCount: 0, deadCount: 0, dead: [], checkedAt: now }
  try {
    const res = await validateAllLinks(bodyHtml)
    linkCheck = {
      total: res.total,
      okCount: res.okCount,
      deadCount: res.deadCount,
      dead: res.dead.map(d => ({ url: d.url, status: d.status, reason: d.reason })),
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error('validateAllLinks failed', err)
  }

  // Persist the link-check result into scoreBreakdown JSON so the draft
  // detail page can surface dead links without a schema migration.
  let scoreBreakdown: Record<string, unknown> = {}
  try { scoreBreakdown = JSON.parse(draft.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
  scoreBreakdown.linkCheck = linkCheck

  await database.update(schema.contentDrafts).set({
    mainCategorySlug,
    otherCategorySlugs: JSON.stringify(otherCategorySlugs),
    schemaJsonLd,
    hreflangBlock,
    scoreBreakdown: JSON.stringify(scoreBreakdown),
    updatedAt: now,
  }).where(eq(schema.contentDrafts.id, draftId))

  return {
    mainCategorySlug,
    otherCategorySlugs,
    schemaValid: validation.valid,
    schemaErrors: validation.errors,
    schemaWarnings: validation.warnings,
    hreflangSet: hreflangBlock.length > 0,
    linkCheck,
  }
}
