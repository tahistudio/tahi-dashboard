/**
 * POST /api/admin/sitemap/seed-current
 *
 * One-shot seed: populate the sitemap with the FUTURE planned structure
 * for the tahi.studio redesign — not the current live shape. Liam +
 * Staci tweak per node from here.
 *
 * Tree shape decisions (locked):
 *  - Home is root; everything cascades.
 *  - /services holds paid work only (retainers + custom + add-ons).
 *  - /enterprise is a root-level positioning flag.
 *  - /will-it-webflow is the capability showcase brand (each page H1 is
 *    a literal user query: "Can Webflow integrate with Stripe?").
 *  - /migrate-to-webflow/* is the migration cluster (source-platform per page).
 *  - /webflow-vs/* lives at root (flattened from /resources/webflow-vs/*).
 *  - /aeo/* is the AEO pillar + spokes.
 *  - /for/* is vertical landings (3).
 *  - Geo cluster is flat at root: /webflow-agency-{nz,au}, /webflow-developer-{auckland,sydney,melbourne}.
 *  - /why-tahi is ONE page (not split — sections inside).
 *  - /trust consolidates security + handover + DPA + compliance.
 *  - /about (not /company); /careers at root.
 *  - /products holds Tahi-owned products (Nodeo + Templates).
 *  - /newsletter is a capture surface.
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
  purpose?: string
  status: 'idea'
  children?: SeedNode[]
}

const SEED: SeedNode[] = [
  {
    title: 'Home',
    slug: '',
    url: 'https://www.tahi.studio/',
    nodeType: 'page',
    status: 'idea',
    children: [

      // ── Services (paid work only) ────────────────────────────────────
      {
        title: 'Services',
        slug: 'services',
        nodeType: 'section',
        status: 'idea',
        children: [
          { title: 'Maintain (retainer)', slug: 'services/maintain', nodeType: 'page', positioningVertical: 'Operations', status: 'idea' },
          { title: 'Grow (retainer)', slug: 'services/grow', nodeType: 'page', positioningVertical: 'Operations', status: 'idea' },
          { title: 'Migrate (project)', slug: 'services/migrate', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          { title: 'Web apps (Webflow Cloud)', slug: 'services/web-apps', nodeType: 'page', positioningVertical: 'Webflow Cloud', status: 'idea' },
          { title: 'Integrate', slug: 'services/integrate', nodeType: 'page', positioningVertical: 'Product Integrations', status: 'idea' },
          { title: 'Add-ons (CMS)', slug: 'services/add-ons', nodeType: 'cms_collection', positioningVertical: 'Operations', status: 'idea' },
        ],
      },

      // ── Root-level positioning flags ─────────────────────────────────
      { title: 'Enterprise', slug: 'enterprise', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
      { title: 'Pricing', slug: 'pricing', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'idea' },
      { title: 'Webflow project calculator', slug: 'webflow-project-calculator', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'idea' },
      { title: 'Free site audit', slug: 'free-site-audit', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'idea' },
      { title: 'Contact', slug: 'contact', nodeType: 'page', status: 'idea' },

      // ── Will It Webflow? (capability showcase) ───────────────────────
      {
        title: 'Will it Webflow?',
        slug: 'will-it-webflow',
        nodeType: 'section',
        status: 'idea',
        purpose: 'Pure capability showcase. Each child page H1 is a literal user query ("Can Webflow X?"). Brand wrapper "Will it Webflow?" stays in nav. Each page = 5-section template: Problem · Architecture · Code · Gotchas · Live demo + clone link.',
        children: [
          { title: 'Can Webflow build onboarding maps?', slug: 'will-it-webflow/onboarding-maps', nodeType: 'page', positioningVertical: 'UI/UX', status: 'idea' },
          { title: 'Can Webflow do progressive profiling?', slug: 'will-it-webflow/progressive-profiling', nodeType: 'page', positioningVertical: 'Product Integrations', status: 'idea' },
          { title: 'Can you build a SaaS dashboard in Webflow?', slug: 'will-it-webflow/our-dashboard', nodeType: 'page', positioningVertical: 'Webflow Cloud', status: 'idea' },
          { title: 'Can you build web apps in Webflow?', slug: 'will-it-webflow/web-apps', nodeType: 'page', positioningVertical: 'Webflow Cloud', status: 'idea' },
          { title: 'Can Webflow integrate with Stripe?', slug: 'will-it-webflow/stripe', nodeType: 'page', positioningVertical: 'Product Integrations', status: 'idea' },
          { title: 'Can Webflow integrate with Xero?', slug: 'will-it-webflow/xero', nodeType: 'page', positioningVertical: 'Product Integrations', status: 'idea' },
          { title: 'Can Webflow integrate with HubSpot?', slug: 'will-it-webflow/hubspot', nodeType: 'page', positioningVertical: 'Product Integrations', status: 'idea' },
          { title: 'Custom CMS patterns in Webflow', slug: 'will-it-webflow/custom-cms-patterns', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          { title: 'Advanced animations in Webflow', slug: 'will-it-webflow/animations', nodeType: 'page', positioningVertical: 'UI/UX', status: 'idea' },
          { title: 'Interactive calculators in Webflow', slug: 'will-it-webflow/calculators', nodeType: 'page', positioningVertical: 'Product Integrations', status: 'idea' },
        ],
      },

      // ── Migration cluster (biggest competitor gap) ───────────────────
      {
        title: 'Migrate to Webflow',
        slug: 'migrate-to-webflow',
        nodeType: 'section',
        status: 'idea',
        purpose: 'Source-platform migration cluster. Competitive analyst flagged this as biggest structural gap vs BRO Works (6 pages) and Flow Ninja (9 pages). High commercial intent.',
        children: [
          { title: 'WordPress to Webflow', slug: 'migrate-to-webflow/from-wordpress', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          { title: 'Framer to Webflow', slug: 'migrate-to-webflow/from-framer', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          { title: 'Wix to Webflow', slug: 'migrate-to-webflow/from-wix', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          { title: 'Squarespace to Webflow', slug: 'migrate-to-webflow/from-squarespace', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          { title: 'Shopify to Webflow', slug: 'migrate-to-webflow/from-shopify', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          { title: 'Custom build to Webflow', slug: 'migrate-to-webflow/from-custom-build', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
        ],
      },

      // ── Comparison hub (root, flattened from /resources) ─────────────
      {
        title: 'Webflow vs',
        slug: 'webflow-vs',
        nodeType: 'section',
        status: 'idea',
        purpose: 'Comparison hub. Flattened to root from /resources/webflow-vs/* per SEO consensus — you already rank #1 in AI Overview for "webflow vs wordpress pricing", depth was suppressing it.',
        children: [
          { title: 'Webflow vs WordPress', slug: 'webflow-vs/wordpress', nodeType: 'page', status: 'idea' },
          { title: 'Webflow vs Framer', slug: 'webflow-vs/framer', nodeType: 'page', status: 'idea' },
          { title: 'Webflow vs Wix', slug: 'webflow-vs/wix', nodeType: 'page', status: 'idea' },
          { title: 'Webflow vs custom build', slug: 'webflow-vs/custom-build', nodeType: 'page', status: 'idea' },
        ],
      },

      // ── AEO cluster (pillar + spokes) ────────────────────────────────
      {
        title: 'Answer Engine Optimization',
        slug: 'aeo',
        nodeType: 'section',
        status: 'idea',
        purpose: 'AEO pillar — "answer engine optimization" has 1,300/mo volume and growing. Tahi already ranks #1 in AI Overview for one query; topical authority is here. Pillar + spokes.',
        children: [
          { title: 'AEO for SaaS', slug: 'aeo/for-saas', nodeType: 'page', status: 'idea' },
          { title: 'AEO for Webflow', slug: 'aeo/for-webflow', nodeType: 'page', status: 'idea' },
          { title: 'AEO vs SEO', slug: 'aeo/vs-seo', nodeType: 'page', status: 'idea' },
          { title: 'AEO schema checklist', slug: 'aeo/schema-checklist', nodeType: 'page', status: 'idea' },
          { title: 'AEO audit tool', slug: 'aeo/audit', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'idea' },
        ],
      },

      // ── Vertical landings ────────────────────────────────────────────
      {
        title: 'For',
        slug: 'for',
        nodeType: 'section',
        status: 'idea',
        children: [
          { title: 'For SaaS', slug: 'for/saas', nodeType: 'page', status: 'idea' },
          { title: 'For non-profits + charities', slug: 'for/non-profits', nodeType: 'page', status: 'idea' },
          { title: 'For fast-moving digital products', slug: 'for/fast-moving-products', nodeType: 'page', status: 'idea' },
        ],
      },

      // ── Geo cluster (root, flat) ─────────────────────────────────────
      { title: 'Webflow agency New Zealand', slug: 'webflow-agency-new-zealand', nodeType: 'page', status: 'idea', purpose: 'Geo landing. Low-difficulty, high-conversion local query (SEO agent ranked #3 priority). Local case studies + NZD pricing + NZ timezone.' },
      { title: 'Webflow agency Australia', slug: 'webflow-agency-australia', nodeType: 'page', status: 'idea' },
      { title: 'Webflow developer Auckland', slug: 'webflow-developer-auckland', nodeType: 'page', status: 'idea' },
      { title: 'Webflow developer Sydney', slug: 'webflow-developer-sydney', nodeType: 'page', status: 'idea' },
      { title: 'Webflow developer Melbourne', slug: 'webflow-developer-melbourne', nodeType: 'page', status: 'idea' },

      // ── Trust + Why ──────────────────────────────────────────────────
      { title: 'Why Tahi', slug: 'why-tahi', nodeType: 'page', status: 'idea', purpose: 'ONE manifesto-style page. Sections inside, not separate URLs. Sales + Marketing + Competitive analyst all confirmed: neither competitor splits, splitting fragments authority. Wedges as sections: engineering-grade, carbon-negative, transparency, AI-native.' },
      { title: 'Trust', slug: 'trust', nodeType: 'page', status: 'idea', purpose: 'Critical for enterprise procurement. Combines: security posture, DPA download, sub-processors, GDPR, accessibility commitment, handover policy (lock-in answer). Sales + CTO both flagged hard — procurement Ctrl-Fs for "DPA" / "SOC2".' },

      // ── Newsletter ───────────────────────────────────────────────────
      { title: 'Newsletter', slug: 'newsletter', nodeType: 'page', status: 'idea', purpose: "Liam's engineering notes capture surface. Marketing flagged this as biggest demand-gen gap. Lead magnet: first 10 issues bundled PDF." },

      // ── About + Careers ──────────────────────────────────────────────
      {
        title: 'About',
        slug: 'about',
        nodeType: 'section',
        status: 'idea',
        children: [
          { title: 'Liam Miller', slug: 'about/liam-miller', nodeType: 'page', status: 'idea', purpose: 'Person schema. Links to every Liam-authored article. E-E-A-T signal.' },
          { title: 'Staci Bonnie', slug: 'about/staci-bonnie', nodeType: 'page', status: 'idea' },
          { title: 'Team (CMS)', slug: 'about/team', nodeType: 'cms_collection', status: 'idea', purpose: 'For future hires + acts as author reference for all blog/glossary content.' },
        ],
      },
      { title: 'Careers', slug: 'careers', nodeType: 'page', status: 'idea' },

      // ── Social proof ─────────────────────────────────────────────────
      { title: 'Case studies (CMS)', slug: 'case-studies', nodeType: 'cms_collection', positioningVertical: 'Showcase', status: 'idea' },
      { title: 'Reviews', slug: 'reviews', nodeType: 'page', status: 'idea', purpose: 'Separate from case studies. Review schema (star ratings appear in Google). Cheap to build, big SEO win.' },

      // ── Products (Tahi-owned) ────────────────────────────────────────
      {
        title: 'Products',
        slug: 'products',
        nodeType: 'section',
        status: 'idea',
        children: [
          { title: 'Nodeo', slug: 'products/nodeo', url: 'https://getnodeo.com', nodeType: 'page', status: 'idea', purpose: 'Tahi-owned SaaS. Live at getnodeo.com — landing on tahi.studio teases + links out.' },
          { title: 'Templates (CMS)', slug: 'products/templates', nodeType: 'cms_collection', status: 'idea' },
        ],
      },

      // ── Blog ─────────────────────────────────────────────────────────
      { title: 'Blog (CMS)', slug: 'blog', nodeType: 'cms_collection', positioningVertical: 'Resources & Education', status: 'idea' },

      // ── Resources ────────────────────────────────────────────────────
      {
        title: 'Resources',
        slug: 'resources',
        nodeType: 'section',
        positioningVertical: 'Resources & Education',
        status: 'idea',
        children: [
          { title: 'Glossary (CMS)', slug: 'resources/glossary', nodeType: 'cms_collection', positioningVertical: 'Resources & Education', status: 'idea', purpose: 'Currently best-performing surface — "brand bible" ranks #34 (2,900 vol/mo), interaction design ranks 8 keywords. Target 350+ DefinedTerm-schema pages.' },
          { title: 'Cloneables (CMS)', slug: 'resources/cloneables', nodeType: 'cms_collection', status: 'idea', purpose: 'Free + paid cloneable Webflow templates. Each = email capture + LinkedIn-shareable.' },
          { title: 'FAQs', slug: 'resources/faqs', nodeType: 'page', positioningVertical: 'Resources & Education', status: 'idea' },
          {
            title: 'Reports',
            slug: 'resources/reports',
            nodeType: 'section',
            positioningVertical: 'Resources & Education',
            status: 'idea',
            purpose: 'Versioned annual reports. AEO + Marketing both flagged. Cite-worthy data products other articles can link.',
            children: [
              { title: 'Webflow pricing report 2025', slug: 'resources/reports/webflow-pricing-2025', nodeType: 'page', positioningVertical: 'Resources & Education', status: 'idea' },
            ],
          },
        ],
      },

      // ── Legal ────────────────────────────────────────────────────────
      {
        title: 'Legal',
        slug: 'legal',
        nodeType: 'section',
        status: 'idea',
        children: [
          { title: 'Privacy policy', slug: 'legal/privacy-policy', nodeType: 'page', status: 'idea' },
          { title: 'Terms of service', slug: 'legal/terms-of-service', nodeType: 'page', status: 'idea' },
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
    const fullUrl = node.url ?? (node.slug ? `https://www.tahi.studio/${node.slug}` : null)
    await database.insert(schema.sitemapNodes).values({
      id,
      parentId,
      sortOrder,
      nodeType: node.nodeType,
      title: node.title,
      slug: node.slug ?? null,
      url: fullUrl,
      positioningVertical: node.positioningVertical ?? null,
      purpose: node.purpose ?? null,
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
    message: `Seeded ${created} nodes (planned redesign structure)${force && wiped > 0 ? `; wiped ${wiped} prior nodes` : ''}.`,
  })
}
