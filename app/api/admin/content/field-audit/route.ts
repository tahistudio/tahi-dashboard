/**
 * GET /api/admin/content/field-audit
 *
 * Audits round-table pipeline coverage of the Webflow Blog Posts CMS
 * fields. Pulls the live field definitions from the Webflow API and maps
 * each to where (if anywhere) the publish payload fills it — so we can
 * see exactly which fields ship populated vs empty/fallback.
 *
 * Temporary audit tool. Safe to delete once coverage is confirmed.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getBlogPostsCollectionId, getCollectionSchema } from '@/lib/webflow'

export const dynamic = 'force-dynamic'

// What the publish route currently writes to each CMS field, and from
// which draft source. Keep in sync with publish/route.ts fieldData.
const COVERAGE: Record<string, { source: string; status: 'filled' | 'fallback' | 'empty' }> = {
  'name': { source: 'draft.title', status: 'filled' },
  'slug': { source: 'slugify(title)', status: 'filled' },
  'post-body': { source: 'structured clean body (HTML)', status: 'filled' },
  'summary-2': { source: 'structured.summary', status: 'filled' },
  'post-description': { source: 'structured.postExcerpt', status: 'filled' },
  'shortened-name': { source: 'structured.shortenedName', status: 'filled' },
  'meta-title': { source: 'structured.metaTitle', status: 'filled' },
  'meta-description-2': { source: 'structured.metaDescription', status: 'filled' },
  'key-takeaways': { source: 'structured.keyTakeaways (HTML)', status: 'filled' },
  'faq-question-1': { source: 'faqs[0].q', status: 'filled' },
  'faq-answer-1': { source: 'faqs[0].a', status: 'filled' },
  'faq-question-2': { source: 'faqs[1].q', status: 'filled' },
  'faq-answer-2': { source: 'faqs[1].a', status: 'filled' },
  'faq-question-3': { source: 'faqs[2].q', status: 'filled' },
  'faq-answer-3': { source: 'faqs[2].a', status: 'filled' },
  'faq-question-4': { source: 'faqs[3].q', status: 'filled' },
  'faq-answer-4': { source: 'faqs[3].a', status: 'filled' },
  'faq-question-5': { source: 'faqs[4].q', status: 'filled' },
  'faq-answer-5': { source: 'faqs[4].a', status: 'filled' },
  'faq-question-6': { source: 'faqs[5].q', status: 'filled' },
  'faq-answer-6': { source: 'faqs[5].a', status: 'filled' },
  'author': { source: 'resolved Liam', status: 'filled' },
  'featured': { source: 'false', status: 'filled' },
  'ai-prompt': { source: 'summary/metaDescription fallback', status: 'fallback' },
  'main-image': { source: 'Flux fallback OR Staci paste-URL', status: 'fallback' },
  'thumbnail-image-2': { source: 'same as main-image', status: 'fallback' },
  'main-category': { source: 'finalize: cluster -> Webflow category id', status: 'filled' },
  'other-categories': { source: 'finalize: main first + extras (never empty)', status: 'filled' },
  'schema': { source: 'finalize + publish-time regen (real cover, real category, citations wired)', status: 'filled' },
  'hreflang-block': { source: 'finalize: <link rel=alternate> block', status: 'filled' },
  'faq-section-heading': { source: 'structured.faqSectionHeading', status: 'filled' },
  'related-blog-posts': { source: '(none)', status: 'empty' },
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const collectionId = await getBlogPostsCollectionId()
  const fields = await getCollectionSchema(collectionId)

  const audit = fields.map(f => {
    const cov = COVERAGE[f.slug]
    const coverage: string = cov?.status ?? 'UNMAPPED'
    return {
      slug: f.slug,
      displayName: f.displayName,
      type: f.type,
      required: f.isRequired ?? false,
      coverage,
      source: cov?.source ?? '(pipeline does not touch this field)',
    }
  })

  const summary = {
    total: audit.length,
    filled: audit.filter(a => a.coverage === 'filled').length,
    fallback: audit.filter(a => a.coverage === 'fallback').length,
    empty: audit.filter(a => a.coverage === 'empty').length,
    unmapped: audit.filter(a => a.coverage === 'UNMAPPED').length,
  }

  return NextResponse.json({ collectionId, summary, fields: audit })
}
