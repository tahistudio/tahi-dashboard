/**
 * POST /api/admin/content/glossary/index-schema
 *
 * Generates the JSON-LD block for /resources/glossary itself (the
 * index page, not individual terms). Emits CollectionPage +
 * DefinedTermSet + BreadcrumbList + Organization references so the
 * index has the same structured-data depth as the term pages.
 *
 * Returns the JSON-LD string. Liam pastes it into the static-page
 * `<head>` or — once the Resources collection structure supports a
 * `schema` field — patches it via Webflow API.
 *
 * Optionally, when ?patch=true is passed AND the resource page is
 * known to the script (env WEBFLOW_GLOSSARY_INDEX_ITEM_ID), the
 * script patches the field directly. Otherwise it's a copy/paste
 * snippet endpoint.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  listCollectionItems, getGlossaryCollectionId,
} from '@/lib/webflow'
import { TAHI_ORG_NODE } from '@/lib/blog-schema-shared'

export const dynamic = 'force-dynamic'

const GLOSSARY_INDEX_URL = 'https://www.tahi.studio/resources/glossary'
const GLOSSARY_SET_ID = `${GLOSSARY_INDEX_URL}#defined-term-set`

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const collectionId = await getGlossaryCollectionId()
  // Pull all terms so we can stamp each one into the DefinedTermSet's
  // `hasDefinedTerm` array. AI engines parse this as the canonical
  // table of contents for the glossary.
  const terms: Array<{ name: string; slug: string }> = []
  let offset = 0
  while (true) {
    const page = await listCollectionItems(collectionId, { offset, limit: 100 })
    if (page.items.length === 0) break
    for (const it of page.items) {
      const f = it.fieldData as Record<string, unknown>
      const name = (f.name as string | undefined) ?? ''
      const slug = (f.slug as string | undefined) ?? ''
      if (name && slug) terms.push({ name, slug })
    }
    if (page.items.length < 100) break
    offset += page.items.length
  }

  const now = new Date().toISOString()

  const collectionPage = {
    '@type': 'CollectionPage',
    '@id': GLOSSARY_INDEX_URL,
    url: GLOSSARY_INDEX_URL,
    name: 'Tahi Studio Glossary',
    description: 'Definitions for Webflow design, development, brand systems, agency operations, and the digital business vocabulary Tahi works with daily.',
    inLanguage: 'en-GB',
    isPartOf: {
      '@type': 'WebSite',
      '@id': 'https://www.tahi.studio/#website',
      url: 'https://www.tahi.studio/',
      name: 'Tahi Studio',
    },
    breadcrumb: { '@id': `${GLOSSARY_INDEX_URL}#breadcrumb` },
    mainEntity: { '@id': GLOSSARY_SET_ID },
    dateModified: now,
  }

  const definedTermSet = {
    '@type': 'DefinedTermSet',
    '@id': GLOSSARY_SET_ID,
    name: 'Tahi Studio Glossary',
    description: 'Curated vocabulary covering Webflow, design systems, accessibility, agency operations, and the business language of building production websites for enterprise teams.',
    url: GLOSSARY_INDEX_URL,
    inLanguage: 'en-GB',
    hasDefinedTerm: terms.map(t => ({
      '@type': 'DefinedTerm',
      '@id': `${GLOSSARY_INDEX_URL}/${t.slug}#term`,
      name: t.name,
      url: `${GLOSSARY_INDEX_URL}/${t.slug}`,
    })),
  }

  const breadcrumb = {
    '@type': 'BreadcrumbList',
    '@id': `${GLOSSARY_INDEX_URL}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.tahi.studio/' },
      { '@type': 'ListItem', position: 2, name: 'Resources', item: 'https://www.tahi.studio/resources' },
      { '@type': 'ListItem', position: 3, name: 'Glossary', item: GLOSSARY_INDEX_URL },
    ],
  }

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [collectionPage, definedTermSet, TAHI_ORG_NODE, breadcrumb],
  }
  const jsonLdString = JSON.stringify(graph)

  return NextResponse.json({
    termCount: terms.length,
    jsonLdString,
    charsTotal: jsonLdString.length,
    instructions: 'Raw JSON-LD only (no <script> wrapper) — paste into the /resources/glossary page schema field. The Webflow template wraps it in <script type="application/ld+json">...</script> at render time. The TAHI_ORG_NODE @id matches the blog post + glossary term schema so Google merges them into a single Organization entity.',
  })
}
