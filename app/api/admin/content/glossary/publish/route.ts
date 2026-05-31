/**
 * POST /api/admin/content/glossary/publish
 *
 * Takes a generated glossary entry (from /api/admin/content/glossary/
 * generate) and creates a NEW Webflow item in the Glossaries collection
 * as a draft (isDraft: true). Liam reviews in Webflow Designer, then
 * hits Publish there to take it live.
 *
 * Also regenerates the schema field via buildGlossarySchema so the new
 * item ships with full JSON-LD on day one.
 *
 * Body: the GeneratedGlossaryEntry JSON shape from /generate (plus an
 * optional `existingItemId` to UPDATE in place rather than create new —
 * used by the "Upgrade existing term" Tier 3 flow).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  getGlossaryCollectionId, createCollectionItem, patchCollectionItem,
  loadBlogReferenceLookups,
} from '@/lib/webflow'
import { buildGlossarySchema } from '@/lib/glossary-schema'

export const dynamic = 'force-dynamic'

const TAHI_BASE = 'https://www.tahi.studio'

interface PublishBody {
  term: string
  alsoKnownAs?: string[]
  definition: string
  bodyMarkdown: string
  faqs?: Array<{ question: string; answer: string }>
  examples?: string[]
  commonMistakes?: string[]
  citations?: Array<{ url: string; title?: string }>
  relatedTerms?: string[]
  metaTitle?: string
  metaDescription?: string
  authorSlug?: 'liam' | 'staci'
  category?: string
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  /** When set, UPDATE this Webflow item instead of creating new. */
  existingItemId?: string
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

/** Render markdown body into HTML for Webflow's rich text field. Very
 *  minimal — Webflow accepts most HTML; we just need paragraphs,
 *  headings, lists, and links. */
function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')  // defensive: convert stray H1 → H2
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .split(/\n\s*\n/)
    .map(block => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      if (trimmed.startsWith('<h')) return trimmed
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const items = trimmed.split('\n').map(l => l.replace(/^[-*]\s+/, '').trim()).filter(Boolean)
        return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
      }
      if (/^\d+\.\s/.test(trimmed)) {
        const items = trimmed.split('\n').map(l => l.replace(/^\d+\.\s+/, '').trim()).filter(Boolean)
        return `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`
      }
      return `<p>${trimmed.replace(/\n/g, ' ')}</p>`
    })
    .filter(Boolean)
    .join('\n')
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as PublishBody
  if (!body.term || !body.definition || !body.bodyMarkdown) {
    return NextResponse.json({ error: 'term, definition, bodyMarkdown required' }, { status: 400 })
  }

  const collectionId = await getGlossaryCollectionId()
  const slug = slugify(body.term)
  const url = `${TAHI_BASE}/resources/glossary/${slug}`
  const now = new Date().toISOString()

  // Main body — examples get inlined; common-mistakes + external-sources
  // go to their own dedicated rich-text fields below (Webflow displays
  // them as separate template sections).
  const bodyParts: string[] = [body.bodyMarkdown]
  if (body.examples && body.examples.length > 0) {
    bodyParts.push(`\n## Examples\n\n${body.examples.map(e => `- ${e}`).join('\n')}`)
  }
  const fullMarkdown = bodyParts.join('\n')
  const fullHtml = markdownToHtml(fullMarkdown)
  const commonMistakesHtml = body.commonMistakes && body.commonMistakes.length > 0
    ? `<ul>${body.commonMistakes.map(m => `<li>${m}</li>`).join('')}</ul>`
    : null
  const externalSourcesHtml = body.citations && body.citations.length > 0
    ? `<ul>${body.citations.map(c => `<li><a href="${c.url}">${c.title ?? c.url}</a></li>`).join('')}</ul>`
    : null

  // Resolve Webflow References (Team Members for author, Categories for
  // primary-category). loadBlogReferenceLookups gives us the maps.
  // Failures are tolerated — refs just won't be set.
  let authorRefId: string | null = null
  let primaryCategoryRefId: string | null = null
  try {
    const refs = await loadBlogReferenceLookups()
    const authorName = body.authorSlug === 'staci' ? 'staci' : 'liam'
    authorRefId = refs.authorsByNamePart.get(authorName)
      ?? (authorName === 'staci' ? (refs.authorsByNamePart.get('bonnie') ?? null) : null)
    if (body.category) {
      const catKey = body.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      primaryCategoryRefId = refs.categoriesBySlug.get(catKey)
        ?? refs.categoriesByName.get(body.category.toLowerCase())
        ?? null
    }
  } catch { /* refs unavailable — skip the reference fields */ }

  // Generate schema from the new content.
  const schemaResult = buildGlossarySchema({
    url,
    term: body.term,
    definition: body.definition,
    bodyMarkdown: fullMarkdown,
    bodyHtml: fullHtml,
    updatedAt: now,
    publishedAt: now,
    authorSlug: body.authorSlug ?? 'liam',
    category: body.category ?? null,
  })

  // Field payload aligned with the actual Glossaries collection
  // (verified via /inspect 2026-05-31, 19 fields). Per-field patch
  // isolates "unknown field" errors so the script keeps working if
  // any field is renamed later in Webflow.
  const baseFields: Record<string, unknown> = {
    name: body.term,
    slug,
    schema: schemaResult.jsonLdString,
    body: fullHtml,                                  // rich text — the real body field
    description: body.definition,                    // existing field (legacy items have this)
    definition: body.definition,                     // new field Liam added
  }
  if (body.metaTitle) baseFields['meta-title'] = body.metaTitle
  if (body.metaDescription) baseFields['meta-description-2'] = body.metaDescription
  if (body.alsoKnownAs && body.alsoKnownAs.length > 0) {
    baseFields['also-known-as'] = body.alsoKnownAs.join(', ')
  }
  if (body.difficulty) baseFields['difficulty'] = body.difficulty
  if (commonMistakesHtml) baseFields['common-mistakes'] = commonMistakesHtml
  if (externalSourcesHtml) baseFields['external-sources'] = externalSourcesHtml
  // Resolved references (Webflow expects item IDs, not slugs).
  if (authorRefId) baseFields['author'] = authorRefId
  if (primaryCategoryRefId) baseFields['primary-category'] = primaryCategoryRefId
  // No custom date fields — Webflow's built-in lastUpdated / lastPublished
  // auto-bump on any patch and feed schema dates on next backfill.

  // Per-field patches isolate "unknown field" failures so the rest still
  // land. This lets us ship the script before Liam has added every
  // optional field in Webflow Designer.
  const patchedFields: string[] = []
  const skippedFields: string[] = []

  if (body.existingItemId) {
    // Tier 3 rewrite of an existing item.
    for (const [k, v] of Object.entries(baseFields)) {
      try {
        await patchCollectionItem(collectionId, body.existingItemId, { [k]: v })
        patchedFields.push(k)
      } catch (err) {
        skippedFields.push(`${k}: ${err instanceof Error ? err.message.slice(0, 80) : 'fail'}`)
      }
    }
    return NextResponse.json({
      ok: true,
      mode: 'updated',
      itemId: body.existingItemId,
      url,
      patchedFields,
      skippedFields,
    })
  }

  // New item — Webflow create requires the REQUIRED fields up front
  // (verified via /inspect: name, slug, description, body). Then patch
  // optional fields one-by-one.
  const minimalFields = {
    name: baseFields.name,
    slug: baseFields.slug,
    description: baseFields.description,
    body: baseFields.body,
  }
  let created
  try {
    created = await createCollectionItem(collectionId, minimalFields)
  } catch (err) {
    return NextResponse.json({
      error: 'Webflow createCollectionItem failed',
      detail: err instanceof Error ? err.message.slice(0, 400) : String(err),
    }, { status: 502 })
  }
  patchedFields.push('name', 'slug', 'description', 'body')

  // Patch the rest one-by-one so unknown fields just skip.
  const minimalKeys = new Set(['name', 'slug', 'description', 'body'])
  for (const [k, v] of Object.entries(baseFields)) {
    if (minimalKeys.has(k)) continue
    try {
      await patchCollectionItem(collectionId, created.id, { [k]: v })
      patchedFields.push(k)
    } catch (err) {
      skippedFields.push(`${k}: ${err instanceof Error ? err.message.slice(0, 80) : 'fail'}`)
    }
  }

  return NextResponse.json({
    ok: true,
    mode: 'created',
    itemId: created.id,
    url,
    schemaCharsWritten: schemaResult.jsonLdString.length,
    faqsEmbedded: schemaResult.faqCount,
    patchedFields,
    skippedFields,
  })
}
