/**
 * GET /api/admin/content/coverage-audit
 *
 * Scoreboard of which existing Webflow content has full schema +
 * FAQ markup + author + dateModified + related items vs. what's
 * missing. Lets us see the backfill target before running it, and
 * verify progress after each batch.
 *
 * Walks ALL blog posts + ALL glossary terms in Webflow, runs the
 * JSON-LD validator against each item's `schema` field, and
 * inventories which CMS fields are populated.
 *
 * Query params:
 *   ?type=blog | glossary | all  (default: all)
 *   ?limit=N                     (default: 200 — cap per type)
 *
 * Response shape:
 *   {
 *     blog: {
 *       total, withSchema, schemaValid, withFaq, withAuthor,
 *       withDateModified, withRelatedPosts, withCategory,
 *       avgEmDashes, avgBannedWords,
 *       items: [...]
 *     },
 *     glossary: { ...same shape },
 *     overall: { fullyHealthy, partiallyBroken, totallyMissing }
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  listCollectionItems, getBlogPostsCollectionId, getGlossaryCollectionId,
} from '@/lib/webflow'
import { validateJsonLd } from '@/lib/schema-validate'

export const dynamic = 'force-dynamic'

interface ItemAudit {
  id: string
  slug: string
  name: string
  hasSchema: boolean
  schemaValid: boolean | null
  schemaErrors: number
  hasFaqSchema: boolean
  hasAuthor: boolean
  hasDateModified: boolean
  hasRelatedRefs: boolean
  hasCategory: boolean
  emDashes: number
  bannedWords: number
}

interface TypeAudit {
  total: number
  withSchema: number
  schemaValid: number
  withFaq: number
  withAuthor: number
  withDateModified: number
  withRelatedRefs: number
  withCategory: number
  totalEmDashes: number
  totalBannedWords: number
  items: ItemAudit[]
}

const BANNED_WORD_RE = /\b(delve|leverage|robust|seamless|comprehensive|navigate the complexities|in today's fast-paced|in conclusion|game-changer|circle back|elevate)\b/gi

function auditItem(item: { id: string; fieldData: Record<string, unknown> }): ItemAudit {
  const f = item.fieldData
  const schemaStr = (f['schema'] as string | undefined) ?? ''
  const bodyHtml = (f['post-body'] as string | undefined) ?? (f['definition'] as string | undefined) ?? (f['body'] as string | undefined) ?? ''
  const name = (f['name'] as string | undefined) ?? (f['title'] as string | undefined) ?? '(untitled)'
  const slug = (f['slug'] as string | undefined) ?? ''

  let schemaValid: boolean | null = null
  let schemaErrors = 0
  let hasFaqSchema = false
  const hasSchema = schemaStr.length > 0
  if (hasSchema) {
    const v = validateJsonLd(schemaStr)
    schemaValid = v.valid
    schemaErrors = v.errors.length
    hasFaqSchema = /"@type"\s*:\s*"FAQPage"/.test(schemaStr)
  }

  // Common author / date / related field name probes — Webflow varies
  // (post-author / author, last-updated / date-modified, related-posts /
  // related-terms / related). We check all the common ones.
  const hasAuthor = Boolean(
    f['post-author'] ?? f['author'] ?? f['authors']
  )
  const hasDateModified = Boolean(
    f['last-updated'] ?? f['date-modified'] ?? f['updated-at'] ?? f['updated']
  )
  const hasRelatedRefs = Array.isArray(f['related-posts'])
    || Array.isArray(f['related-terms'])
    || Array.isArray(f['related-blog-posts'])
    || Array.isArray(f['related'])
  const hasCategory = Boolean(
    f['main-category'] ?? f['category'] ?? f['categories']
  )

  const bodyText = bodyHtml.replace(/<[^>]+>/g, ' ')
  const emDashes = (bodyText.match(/[—–]/g) ?? []).length
  const bannedWords = (bodyText.match(BANNED_WORD_RE) ?? []).length

  return {
    id: item.id, slug, name,
    hasSchema, schemaValid, schemaErrors,
    hasFaqSchema, hasAuthor, hasDateModified,
    hasRelatedRefs, hasCategory,
    emDashes, bannedWords,
  }
}

async function auditCollection(collectionId: string, limit: number): Promise<TypeAudit> {
  const items: TypeAudit['items'] = []
  let offset = 0
  while (items.length < limit) {
    const page = await listCollectionItems(collectionId, { offset, limit: Math.min(100, limit - items.length) })
    if (page.items.length === 0) break
    for (const it of page.items) items.push(auditItem(it))
    if (page.items.length < 100) break
    offset += page.items.length
  }
  return {
    total: items.length,
    withSchema: items.filter(i => i.hasSchema).length,
    schemaValid: items.filter(i => i.schemaValid === true).length,
    withFaq: items.filter(i => i.hasFaqSchema).length,
    withAuthor: items.filter(i => i.hasAuthor).length,
    withDateModified: items.filter(i => i.hasDateModified).length,
    withRelatedRefs: items.filter(i => i.hasRelatedRefs).length,
    withCategory: items.filter(i => i.hasCategory).length,
    totalEmDashes: items.reduce((a, i) => a + i.emDashes, 0),
    totalBannedWords: items.reduce((a, i) => a + i.bannedWords, 0),
    items,
  }
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'all'
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '200', 10) || 200))

  const out: { blog?: TypeAudit; glossary?: TypeAudit; durationMs: number } = { durationMs: 0 }
  const t0 = Date.now()

  if (type === 'blog' || type === 'all') {
    try {
      const blogId = await getBlogPostsCollectionId()
      out.blog = await auditCollection(blogId, limit)
    } catch (err) {
      console.error('coverage audit / blog failed', err)
    }
  }
  if (type === 'glossary' || type === 'all') {
    try {
      const glossId = await getGlossaryCollectionId()
      out.glossary = await auditCollection(glossId, limit)
    } catch (err) {
      console.error('coverage audit / glossary failed', err)
    }
  }
  out.durationMs = Date.now() - t0
  return NextResponse.json(out)
}
