/**
 * Blog context for the round-table pipeline — Phase I · Slice 9.
 *
 * Gives the writer + strategist + internal-link reviewer ground truth
 * about the existing blog so they:
 *   1. Only ever link to slugs that actually exist (no hallucinated URLs)
 *   2. Always use relative /slug links (never https://www.tahi.studio/slug)
 *      so a future domain move / CMS migration doesn't break every link
 *   3. Know what's already been written (recent posts) to avoid repeating
 *      ground + to cross-link naturally
 *
 * Source of truth is the live Webflow Blog Posts collection. Module-scoped
 * cache (like loadBlogReferenceLookups) so 20+ reviewer calls in one
 * pipeline run don't each re-fetch the whole collection.
 */

import { getBlogPostsCollectionId, listCollectionItems, type WebflowCollectionItem } from '@/lib/webflow'

export interface BlogContextPost {
  slug: string
  relativeUrl: string          // always '/slug' form
  title: string
  summary: string
  publishedAt: string | null
}

export interface BlogContext {
  /** Every published slug, for accurate internal linking. */
  posts: BlogContextPost[]
  /** Most recent ~15 by published date, for narrative awareness. */
  recent: BlogContextPost[]
  loadedAt: string
}

let cached: BlogContext | null = null
let cachedAt = 0
const CACHE_TTL_MS = 10 * 60 * 1000  // 10 min — fresh enough within a pipeline run

function readField<T = string>(item: WebflowCollectionItem, key: string): T | null {
  const v = item.fieldData[key]
  return v == null ? null : (v as T)
}

export async function loadBlogContext(force = false): Promise<BlogContext> {
  if (!force && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached

  const collectionId = await getBlogPostsCollectionId()
  const posts: BlogContextPost[] = []
  let offset = 0
  for (let i = 0; i < 10; i++) {
    const { items, total } = await listCollectionItems(collectionId, { limit: 100, offset })
    for (const it of items) {
      const slug = (readField<string>(it, 'slug') ?? '').trim()
      if (!slug) continue
      posts.push({
        slug,
        relativeUrl: `/${slug}`,
        title: readField<string>(it, 'name') ?? slug,
        // Field slugs are the post-rename ones (see blog-schema-input.ts).
        summary: (readField<string>(it, 'summary-2')
          ?? readField<string>(it, 'post-description')
          ?? readField<string>(it, 'meta-description-2')
          ?? '').slice(0, 240),
        publishedAt: it.lastPublished ?? readField<string>(it, 'published-on') ?? null,
      })
    }
    if (items.length < 100) break
    offset += items.length
    if (offset >= total) break
  }

  const recent = [...posts]
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 15)

  cached = { posts, recent, loadedAt: new Date().toISOString() }
  cachedAt = Date.now()
  return cached
}

/** Compact prompt block listing every linkable slug + recent-post context.
 *  Dropped into the writer + strategist + internal-link reviewer prompts. */
export function renderBlogContextForPrompt(ctx: BlogContext): string {
  const slugList = ctx.posts
    .map(p => `- ${p.relativeUrl} — ${p.title}`)
    .join('\n')
  const recentList = ctx.recent
    .map(p => `- ${p.relativeUrl} — ${p.title}${p.summary ? `: ${p.summary}` : ''}`)
    .join('\n')
  return `## Internal linking rules (STRICT)
- Internal links MUST use the relative form /slug (e.g. /webflow-vs-wordpress). NEVER write the full domain (https://www.tahi.studio/...). Relative links survive a domain move; absolute ones don't.
- You may ONLY link to slugs in the list below. Do not invent slugs. If you want to reference a topic with no matching post, mention it without a link.

## Every linkable blog slug (${ctx.posts.length})
${slugList || '(none yet)'}

## Recent posts (context — what we've already covered; cross-link these where natural)
${recentList || '(none yet)'}
`
}
