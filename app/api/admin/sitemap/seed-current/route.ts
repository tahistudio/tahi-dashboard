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
    purpose: 'POSITIONING: "Embedded WebOps for product-led B2B SaaS." Tahi = Flow Ninja-style WebOps thesis + Webstacks-style SaaS product taste + engineering depth neither has (Webflow Cloud apps, custom integrations, Tahi Dashboard + Nodeo as proof). H1: "Embedded WebOps for product-led SaaS." Subhead: "We design, build and run the marketing site for B2B SaaS teams whose home page has to look as good as the product."',
    children: [

      // ── Services (paid plans only — capabilities live in /will-it-webflow) ──
      {
        title: 'Services',
        slug: 'services',
        nodeType: 'section',
        status: 'idea',
        purpose: 'WebOps tiers + project work. Retainer-shaped (Maintain, Grow) for ongoing WebOps. Project-shaped (Custom, Web apps) for builds + migrations + Webflow Cloud apps. Capabilities (integrations, animations, calculators) live in /will-it-webflow showcase, not here.',
        children: [
          { title: 'Maintain (retainer)', slug: 'services/maintain', nodeType: 'page', positioningVertical: 'Operations', status: 'idea', purpose: 'WebOps lite. Ongoing site care: hosting + monitoring + minor updates + SEO/AEO check-ins + perf. Entry retainer tier — likely $2–5k/mo range. For SaaS teams who have a Webflow site but no one to own it.' },
          { title: 'Grow (retainer)', slug: 'services/grow', nodeType: 'page', positioningVertical: 'Operations', status: 'idea', purpose: 'Full embedded WebOps. We own the marketing site + the data stack (Matomo/GA4/GSC/AEO/Zapier) + ongoing build queue. Mid-tier — likely $5–12k/mo. The retainer where Physitrack/Champion-tier clients pay because their marketing team is small and ours is theirs.' },
          { title: 'Custom (project)', slug: 'services/custom', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea', purpose: 'Custom-quoted project work — site rebuilds, migrations, bespoke features. From $5,000.' },
          { title: 'Web apps (Webflow Cloud)', slug: 'services/web-apps', nodeType: 'page', positioningVertical: 'Webflow Cloud', status: 'idea', purpose: 'Promoted to first-class service per CTO + senior strategist panel. Custom Webflow Cloud apps — customer dashboards, integrated tools, auth-gated portals. The thing Webstacks would subcontract. Tahi Dashboard + Nodeo as proof.' },
          { title: 'Add-ons (CMS)', slug: 'services/add-ons', nodeType: 'cms_collection', positioningVertical: 'Operations', status: 'idea' },
        ],
      },

      // ── Root-level positioning flags ─────────────────────────────────
      { title: 'Enterprise', slug: 'enterprise', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea', purpose: 'Positioning flag for enterprise-scale buyers (Series B+ SaaS, 200+ employees US/UK, 50+ NZ/AU). Currently aspirational — no enterprise logo yet. Page is capability-led, not customer-led, until first logo lands.' },
      { title: 'Pricing', slug: 'pricing', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'idea', purpose: 'Semi-transparent pricing (Flow Ninja model). Show retainer tiers up to ~$12k/mo transparently, then fourth tier "Enterprise — let\'s talk". Disarms Seed/Series A, doesn\'t repel Series B+ procurement.' },
      { title: 'Webflow project calculator', slug: 'webflow-project-calculator', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'idea' },
      { title: 'Free audit', slug: 'free-audit', nodeType: 'page', positioningVertical: 'Pricing & Sales', status: 'idea', purpose: 'Multi-faceted audit tool: paste URL → report on performance, AEO, schema, accessibility, Webflow-feasibility. Consolidates /free-site-audit + /aeo/audit into one URL.' },
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
          { title: 'Custom build to Webflow', slug: 'migrate-to-webflow/from-custom-build', nodeType: 'page', positioningVertical: 'Enterprise Custom Webflow', status: 'idea' },
          // Dropped: /from-squarespace (SMB intent, wrong ICP), /from-shopify (e-comm intent, wrong ICP)
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
          { title: 'Webflow vs custom build', slug: 'webflow-vs/custom-build', nodeType: 'page', status: 'idea' },
          // Dropped: /webflow-vs/wix (SMB intent, doesn\'t serve product-led SaaS ICP)
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
          // /aeo/audit removed — consolidated into /free-audit (one multi-faceted tool, not two).
        ],
      },

      // ── Vertical landings (specific, product-led SaaS only) ──────────
      {
        title: 'For',
        slug: 'for',
        nodeType: 'section',
        status: 'idea',
        purpose: 'Vertical landing pages. Sharpened from generic /for/saas to product-led SaaS sub-categories matching the FlowNinja-meets-Webstacks ICP. AI products + data platforms + healthtech products + devtools + cybersecurity. Liam: refine slugs as the first logo in each lands.',
        children: [
          { title: 'For AI SaaS', slug: 'for/ai-saas', nodeType: 'page', status: 'idea', purpose: 'ElevenLabs / Anthropic / OpenAI-tier. AI-product marketing sites that need to demo capability live.' },
          { title: 'For data platforms', slug: 'for/data-platforms', nodeType: 'page', status: 'idea', purpose: 'Snowflake / Sigma / dbt-tier. Data infrastructure where the marketing site has to look as serious as the product.' },
          { title: 'For devtools', slug: 'for/devtools', nodeType: 'page', status: 'idea', purpose: 'Vercel / Linear / Sentry-tier. Developer products with interactive demo expectations.' },
          { title: 'For healthtech products', slug: 'for/healthtech-products', nodeType: 'page', status: 'idea', purpose: 'Physitrack / Champion Health / digital therapeutics tier. Existing client base sweet spot.' },
          { title: 'For cybersecurity products', slug: 'for/cybersecurity-products', nodeType: 'page', status: 'idea', purpose: 'Glasswall / Snyk-tier. Security products with technical-buyer scrutiny.' },
          // Dropped: /for/saas (too generic), /for/non-profits, /for/fast-moving-products (don\'t match product-led ICP)
        ],
      },

      // ── Geo cluster (root, flat — country-level only) ────────────────
      { title: 'Webflow agency New Zealand', slug: 'webflow-agency-new-zealand', nodeType: 'page', status: 'idea', purpose: 'Geo landing. Low-difficulty, high-conversion local query. Local case studies + NZD pricing + NZ timezone.' },
      { title: 'Webflow agency Australia', slug: 'webflow-agency-australia', nodeType: 'page', status: 'idea' },

      // ── Why + Sustainability + Security ──────────────────────────────
      { title: 'Why Tahi', slug: 'why-tahi', nodeType: 'page', status: 'idea', purpose: 'ONE manifesto-style page. Three sections, not separate URLs: (1) Engineering-grade Webflow (between marketing + engineering, ships Webflow Cloud apps); (2) AI-fluent (content engine, reviewer panels, AEO discipline — reframed from "AI-native" per CTO panel: "AI-native" reads as buzzword to AI-company buyers, "AI-fluent" doesn\'t); (3) Embedded WebOps (renamed from "ops-on-tap" per Sales panel — owns Matomo/GA4/GSC/AEO/Zapier stack, the retainer pitch). Sustainability + transparency become footer/about signals, not nav-level wedges.' },
      { title: 'Sustainability', slug: 'sustainability', nodeType: 'page', status: 'idea', purpose: 'Folds carbon-negative donations + accessibility commitment + ethical AI use + charity partnerships + sustainable engineering practices.' },
      { title: 'Security + trust', slug: 'security', nodeType: 'page', status: 'idea', purpose: 'Lean single page (not a hub). Procurement Ctrl-F enablement: data handling, sub-processors (Webflow, Cloudflare, R2, Clerk, Stripe, Resend), GDPR posture, accessibility commitment, SOC2 honest readiness statement, DPA-on-request, handover policy. Killed the hub plan; this slim version handles the procurement gate.' },

      // ── Newsletter ───────────────────────────────────────────────────
      { title: 'Newsletter', slug: 'newsletter', nodeType: 'page', status: 'idea', purpose: 'THE WEBFLOW ENTERPRISE BRIEF (per Marketing panel reframe). Weekly, 5-min read. Promise: one capability ceiling test + one AEO/schema move + one migration teardown. Owns the enterprise-Webflow beat — no competitor publishes this regularly.' },

      // ── Teardowns (manufactured trust, monthly cadence) ──────────────
      {
        title: 'Teardowns',
        slug: 'teardowns',
        nodeType: 'section',
        status: 'idea',
        purpose: 'Monthly cadence — one new teardown per month. Aspirational-prospect rebuilds: "How we\'d rebuild [Tier-1 Brand]\'s marketing site on Webflow." Frame: engineering-grade thinking + architecture diagrams + cost comparison, NOT a sales pitch. Shareable on X + LinkedIn. Manufactured trust before logos land. First target: Vercel (devtools, currently on custom Next, less obvious than ElevenLabs).',
        children: [
          { title: 'How we\'d rebuild Vercel on Webflow', slug: 'teardowns/vercel', nodeType: 'page', positioningVertical: 'Showcase', status: 'idea', purpose: 'First teardown. Vercel = devtools-tier exemplar, currently on custom Next stack. Show: architecture, Webflow Cloud app for live demos, perf comparison, what they\'d gain/lose. Shareable on X + dev.to + Indie Hackers. Don\'t pitch — analyse.' },
        ],
      },

      // ── Experts (E-E-A-T entity-graph play) ──────────────────────────
      {
        title: 'Experts',
        slug: 'experts',
        nodeType: 'section',
        status: 'idea',
        purpose: 'Promoted from /about/team/* to root per AEO panel — highest-leverage single AEO move. Each page = full Person schema + sameAs + knowsAbout + author backlinks across blog/glossary. Unlocks entity-graph citation across the entire content corpus in one move.',
        children: [
          { title: 'Liam Miller', slug: 'experts/liam-miller', nodeType: 'page', status: 'idea', purpose: 'Person schema. Engineering/CEO. Links to every Liam-authored article + LinkedIn + GitHub + speaking history.' },
          { title: 'Staci Bonnie', slug: 'experts/staci-bonnie', nodeType: 'page', status: 'idea', purpose: 'Person schema. Design/co-founder. Links to every Staci-authored article + design portfolio + LinkedIn.' },
        ],
      },

      // ── About + Careers ──────────────────────────────────────────────
      { title: 'About', slug: 'about', nodeType: 'page', status: 'idea', purpose: 'Studio story. Founder narrative + the engineering-design pairing. Links out to /experts/* for full Person bios + /case-studies for proof. Single page, not a section.' },
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
          { title: 'Glossary (CMS)', slug: 'resources/glossary', nodeType: 'cms_collection', positioningVertical: 'Resources & Education', status: 'idea', purpose: 'Currently best-performing surface — "brand bible" ranks #34 (2,900 vol/mo), interaction design ranks 8 keywords. Target 350+ DefinedTerm-schema pages. Discipline per page: definition + Tahi POV + use case + contrarian take + 3 real examples + related terms + author byline.' },
          { title: 'Cloneables (CMS)', slug: 'resources/cloneables', nodeType: 'cms_collection', status: 'idea', purpose: 'Free + paid cloneable Webflow templates. Each = email capture + LinkedIn-shareable.' },
          // Dropped: /resources/faqs (3-way cannibalisation with /will-it-webflow Q-pages + /blog per SEO panel)
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
