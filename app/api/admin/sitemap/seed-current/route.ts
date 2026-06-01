/**
 * POST /api/admin/sitemap/seed-current
 *
 * One-shot seed: populate the sitemap with the current live tahi.studio
 * structure as a starting skeleton. Liam + Staci then tweak / add /
 * delete from there before doing the per-page docs pass.
 *
 * Tree shape: Home is the root, everything else nests under it in
 * themed folders (Marketing / Case studies / Resources / Legal). The
 * point of the planning library is to think of the site as one tree
 * with a single entry point, not as a flat list of sibling sections.
 *
 * POST without body = refuse if any nodes exist.
 * POST { "force": true } = wipe all nodes + reviews, then reseed.
 *
 * Gated to Liam + Staci.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { assertSitemapApiAccess } from '@/lib/sitemap-auth'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface SeedNode {
  title: string
  slug?: string
  url?: string
  nodeType: 'page' | 'cms_collection' | 'section'
  positioningVertical?: string
  status: 'live'
  children?: SeedNode[]
}

// Single-root tree: everything cascades from Home. The themed folders
// underneath (Marketing / Case studies / Resources / Legal) are
// 'section' nodes that act as grouping containers, not real URLs.
const SEED: SeedNode[] = [
  {
    title: 'Home',
    slug: '',
    url: 'https://www.tahi.studio/',
    nodeType: 'page',
    status: 'live',
    children: [
      {
        title: 'Marketing',
        nodeType: 'section',
        status: 'live',
        children: [
          { title: 'Pricing', slug: 'pricing', url: 'https://www.tahi.studio/pricing', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'live' },
          { title: 'Contact', slug: 'contact', url: 'https://www.tahi.studio/contact', nodeType: 'page', status: 'live' },
          { title: 'Free site audit', slug: 'free-site-audit', url: 'https://www.tahi.studio/free-site-audit', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'live' },
          { title: 'Webflow project calculator', slug: 'webflow-project-calculator', url: 'https://www.tahi.studio/webflow-project-calculator', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'live' },
        ],
      },
      { title: 'Case studies (CMS)', slug: 'case-studies', url: 'https://www.tahi.studio/case-studies', nodeType: 'cms_collection', positioningVertical: 'Showcase', status: 'live' },
      {
        title: 'Resources',
        nodeType: 'section',
        status: 'live',
        children: [
          { title: 'Blog (CMS)', slug: 'blog', url: 'https://www.tahi.studio/blog', nodeType: 'cms_collection', positioningVertical: 'Resources & Education', status: 'live' },
          { title: 'Glossary (CMS)', slug: 'resources/glossary', url: 'https://www.tahi.studio/resources/glossary', nodeType: 'cms_collection', positioningVertical: 'Resources & Education', status: 'live' },
          { title: 'Resource categories (CMS)', slug: 'resources/categories', url: 'https://www.tahi.studio/resources/categories', nodeType: 'cms_collection', positioningVertical: 'Resources & Education', status: 'live' },
          { title: 'FAQs', slug: 'resources/faqs', url: 'https://www.tahi.studio/resources/faqs', nodeType: 'page', positioningVertical: 'Resources & Education', status: 'live' },
          { title: 'Webflow pricing report 2025', slug: 'resources/webflow-pricing-report-2025', url: 'https://www.tahi.studio/resources/webflow-pricing-report-2025', nodeType: 'page', positioningVertical: 'Resources & Education', status: 'live' },
        ],
      },
      {
        title: 'Legal',
        nodeType: 'section',
        status: 'live',
        children: [
          { title: 'Privacy policy', slug: 'legal/privacy-policy', url: 'https://www.tahi.studio/legal/privacy-policy', nodeType: 'page', status: 'live' },
          { title: 'Terms of service', slug: 'legal/terms-of-service', url: 'https://www.tahi.studio/legal/terms-of-service', nodeType: 'page', status: 'live' },
        ],
      },
    ],
  },
]

export async function POST(req: NextRequest) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const database = await db()

  const body = (await req.json().catch(() => ({}))) as { force?: boolean }
  const force = body.force === true

  const existing = await database.select({ id: schema.sitemapNodes.id }).from(schema.sitemapNodes).limit(1)
  if (existing.length > 0 && !force) {
    return NextResponse.json({
      error: 'Sitemap already has nodes. POST with { "force": true } to wipe and reseed.',
    }, { status: 409 })
  }

  // Wipe if forced. D1 has no ON DELETE CASCADE configured for these
  // tables, so reviews go first then nodes.
  let wiped = 0
  if (force) {
    await database.delete(schema.sitemapNodeReviews)
    const allNodes = await database.select({ id: schema.sitemapNodes.id }).from(schema.sitemapNodes)
    wiped = allNodes.length
    await database.delete(schema.sitemapNodes)
  }

  const now = new Date().toISOString()
  let created = 0

  async function insertNode(node: SeedNode, parentId: string | null, sortOrder: number): Promise<string> {
    const id = crypto.randomUUID()
    await database.insert(schema.sitemapNodes).values({
      id,
      parentId,
      sortOrder,
      nodeType: node.nodeType,
      title: node.title,
      slug: node.slug ?? null,
      url: node.url ?? null,
      positioningVertical: node.positioningVertical ?? null,
      status: node.status,
      createdBy: userId,
      lastEditedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    created++
    if (node.children) {
      let i = 0
      for (const child of node.children) {
        await insertNode(child, id, i)
        i++
      }
    }
    return id
  }

  let topIdx = 0
  for (const root of SEED) {
    await insertNode(root, null, topIdx)
    topIdx++
  }

  return NextResponse.json({
    created,
    wiped: force ? wiped : 0,
    message: `Seeded ${created} nodes from current tahi.studio sitemap${force && wiped > 0 ? ` (wiped ${wiped} prior nodes)` : ''}.`,
  })
}
