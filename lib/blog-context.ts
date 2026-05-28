/**
 * Blog + sitemap context for the round-table pipeline — Phase I · Slice 9.
 *
 * Gives the writer + reviewers GROUND TRUTH about every live, linkable
 * page on tahi.studio so they:
 *   1. Only ever link to URLs that genuinely exist (no hallucinated links)
 *   2. Always use relative /path links (never https://www.tahi.studio/...)
 *      so a domain move / CMS migration doesn't break every link
 *   3. Know what's already been published to cross-link naturally
 *
 * Source of truth is the `blog_health` table — it's populated by the
 * Health-tab sitemap scan and contains EVERY live URL (blog posts, pillar
 * pages, glossary terms, etc.), which is broader + more accurate than the
 * Webflow Blog Posts collection alone. We enrich blog entries with
 * titles/summaries from Webflow where available.
 *
 * Module-scoped cache so 20+ reviewer calls in one run don't each re-query.
 */

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getBlogPostsCollectionId, listCollectionItems, type WebflowCollectionItem } from '@/lib/webflow'

export type LinkKind = 'blog' | 'glossary' | 'pillar' | 'page'

export interface LinkablePage {
  relativeUrl: string          // '/blog/foo' | '/glossary/bar' | '/services' ...
  kind: LinkKind
  title: string                // best-effort label
}

export interface BlogContextPost {
  relativeUrl: string
  title: string
  summary: string
  publishedAt: string | null
}

export interface BlogContext {
  /** Every live, linkable URL on the site (the authoritative set). */
  linkable: LinkablePage[]
  /** Recent blog posts with summaries, for narrative awareness. */
  recent: BlogContextPost[]
  loadedAt: string
}

let cached: BlogContext | null = null
let cachedAt = 0
const CACHE_TTL_MS = 10 * 60 * 1000

function readField<T = string>(item: WebflowCollectionItem, key: string): T | null {
  const v = item.fieldData[key]
  return v == null ? null : (v as T)
}

/** Strip the domain to a relative path and trim trailing slash. */
function toRelative(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/(^|\.)tahi\.studio$/i.test(u.hostname)) return null
    let p = u.pathname.replace(/\/+$/, '')
    if (p === '') p = '/'
    return p
  } catch {
    // Already relative?
    if (url.startsWith('/')) return url.replace(/\/+$/, '') || '/'
    return null
  }
}

function classify(relativeUrl: string): LinkKind {
  const p = relativeUrl.toLowerCase()
  if (p.startsWith('/blog/')) return 'blog'
  if (p.startsWith('/glossary/') || p.startsWith('/glossary')) return 'glossary'
  // Top-level single-segment marketing pages tend to be pillars/services.
  const segs = p.split('/').filter(Boolean)
  if (segs.length === 1) return 'pillar'
  return 'page'
}

function titleFromPath(relativeUrl: string): string {
  const last = relativeUrl.split('/').filter(Boolean).pop() ?? relativeUrl
  return last.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export async function loadBlogContext(force = false): Promise<BlogContext> {
  if (!force && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached

  const database = await db()

  // 1) Authoritative linkable set from the sitemap scan (blog_health).
  let healthRows: Array<{ url: string }> = []
  try {
    healthRows = await database.select({ url: schema.blogHealth.url }).from(schema.blogHealth)
  } catch {
    healthRows = []
  }

  const seen = new Set<string>()
  const linkable: LinkablePage[] = []
  for (const r of healthRows) {
    const rel = toRelative(r.url)
    if (!rel || rel === '/') continue
    if (seen.has(rel)) continue
    seen.add(rel)
    linkable.push({ relativeUrl: rel, kind: classify(rel), title: titleFromPath(rel) })
  }

  // 2) Enrich blog entries + build the recent list from Webflow (titles +
  //    summaries). Best-effort — if Webflow is unreachable we still have
  //    the URL set from health.
  const recent: BlogContextPost[] = []
  try {
    const collectionId = await getBlogPostsCollectionId()
    let offset = 0
    const webflowPosts: BlogContextPost[] = []
    for (let i = 0; i < 10; i++) {
      const { items, total } = await listCollectionItems(collectionId, { limit: 100, offset })
      for (const it of items) {
        const slug = (readField<string>(it, 'slug') ?? '').trim()
        if (!slug) continue
        const rel = `/blog/${slug}`
        const title = readField<string>(it, 'name') ?? titleFromPath(rel)
        const summary = (readField<string>(it, 'summary-2')
          ?? readField<string>(it, 'post-description')
          ?? readField<string>(it, 'meta-description-2')
          ?? '').slice(0, 220)
        const publishedAt = it.lastPublished ?? readField<string>(it, 'published-on') ?? null
        webflowPosts.push({ relativeUrl: rel, title, summary, publishedAt })
        // Backfill a title onto the linkable entry if health had a bare one.
        const match = linkable.find(l => l.relativeUrl === rel)
        if (match) match.title = title
        else if (!seen.has(rel)) { seen.add(rel); linkable.push({ relativeUrl: rel, kind: 'blog', title }) }
      }
      if (items.length < 100) break
      offset += items.length
      if (offset >= total) break
    }
    recent.push(...[...webflowPosts]
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .slice(0, 15))
  } catch {
    // No Webflow enrichment available — proceed with the health set.
  }

  cached = { linkable, recent, loadedAt: new Date().toISOString() }
  cachedAt = Date.now()
  return cached
}

/** Compact prompt block listing every live linkable URL grouped by type
 *  + recent-post context. Dropped into the writer + reviewer prompts. */
export function renderBlogContextForPrompt(ctx: BlogContext): string {
  const byKind = (kind: LinkKind) => ctx.linkable
    .filter(l => l.kind === kind)
    .map(l => `- ${l.relativeUrl} — ${l.title}`)
    .join('\n')

  const recentList = ctx.recent
    .map(p => `- ${p.relativeUrl} — ${p.title}${p.summary ? `: ${p.summary}` : ''}`)
    .join('\n')

  return `## Internal linking rules (STRICT — do not break)
- You may ONLY link to URLs in the lists below. These are the live pages on tahi.studio.
- NEVER invent or guess a URL. If there is no matching page for a topic you want to link, mention it in plain text with NO link.
- ALWAYS use the relative form shown (e.g. /blog/foo, /glossary/bar). Never write the full domain.
- Link glossary terms to their /glossary URL the first time they appear. Link pillar pages where relevant. Cross-link related blog posts.

## Pillar pages (${ctx.linkable.filter(l => l.kind === 'pillar').length})
${byKind('pillar') || '(none found)'}

## Glossary terms (${ctx.linkable.filter(l => l.kind === 'glossary').length})
${byKind('glossary') || '(none found)'}

## Blog posts (${ctx.linkable.filter(l => l.kind === 'blog').length})
${byKind('blog') || '(none found)'}

## Other live pages (${ctx.linkable.filter(l => l.kind === 'page').length})
${byKind('page') || '(none)'}

## Recent posts (what we've already covered; cross-link where natural)
${recentList || '(none yet)'}
`
}

/** Returns the set of valid relative link targets — used to validate +
 *  strip fabricated internal links from a finished draft. */
export function linkableUrlSet(ctx: BlogContext): Set<string> {
  return new Set(ctx.linkable.map(l => l.relativeUrl.toLowerCase()))
}

export interface LinkSanitizeResult {
  markdown: string
  removed: Array<{ text: string; url: string }>
  normalised: number   // count of absolute tahi links rewritten to relative
}

/** Deterministic guard against fabricated internal links. Scans markdown
 *  for [text](url) links that point at tahi.studio (absolute) or are
 *  relative (/path). For each:
 *    - external (non-tahi) links: left untouched
 *    - tahi/relative links whose path IS in the live set: kept, rewritten
 *      to the relative form
 *    - tahi/relative links NOT in the live set: UNLINKED (becomes plain
 *      text) and recorded in `removed`
 *  Runs after generation so a hallucinated link can never reach Webflow. */
export function sanitizeInternalLinks(markdown: string, valid: Set<string>): LinkSanitizeResult {
  const removed: Array<{ text: string; url: string }> = []
  let normalised = 0

  const out = markdown.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (full, text: string, url: string) => {
    // Determine if this is an internal (tahi) link.
    let path: string | null = null
    let isInternal = false
    if (/^https?:\/\//i.test(url)) {
      try {
        const u = new URL(url)
        if (/(^|\.)tahi\.studio$/i.test(u.hostname)) {
          isInternal = true
          path = u.pathname.replace(/\/+$/, '') || '/'
        }
      } catch { /* leave as-is */ }
    } else if (url.startsWith('/')) {
      isInternal = true
      path = url.replace(/\/+$/, '') || '/'
    }

    if (!isInternal || !path) return full  // external link — untouched

    if (valid.has(path.toLowerCase())) {
      // Keep, but normalise to the relative form.
      if (/^https?:\/\//i.test(url)) normalised++
      return `[${text}](${path})`
    }
    // Fabricated / unknown internal link — unlink it.
    removed.push({ text, url })
    return text
  })

  return { markdown: out, removed, normalised }
}
