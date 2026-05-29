/**
 * Default topical clusters for Tahi's content engine.
 *
 * Consolidated 2026-05-29 from 8 → 5 clusters: niched-down per Liam +
 * expert SEO review. Old clusters that already have ideas/drafts
 * attached aren't deleted by the seed endpoint (INSERT OR IGNORE on
 * slug). New ideas should use this set.
 *
 * Cluster rationale + interlinking strategy lives in the "SEO and AEO
 * Strategy" Docs Hub page; if that diverges from this file, the doc is
 * the source of truth for human readers — this file is the source of
 * truth for the AI pipeline.
 *
 * Tag (not a cluster): NZ + AU regional. Applied to relevant pieces
 * for local SEO; doesn't deserve cluster depth at current volume.
 */

export interface ClusterSeed {
  name: string
  slug: string
  description: string
}

export const DEFAULT_CLUSTERS: ClusterSeed[] = [
  {
    name: 'Enterprise Webflow',
    slug: 'enterprise-webflow',
    description: 'Large-org Webflow builds, governance, multi-locale, security reviews, integrations with enterprise stacks. Includes Webflow migrations from WordPress / Framer / headless / bespoke — same buyer, same pain.',
  },
  {
    name: 'Performance + SEO + AEO + Sustainability',
    slug: 'performance-seo-aeo',
    description: 'Core Web Vitals on Webflow, image strategy, JS hygiene, schema/structured data, AEO + answer-engine optimisation, voice search, llms.txt, low-carbon hosting, page weight, green hosting. Sustainability is the differentiated angle that makes this cluster non-generic.',
  },
  {
    name: 'Design + Build Quality',
    slug: 'design-build-quality',
    description: "Staci-authored. Design-to-dev workflows (Figma to Webflow), design tokens, component-level handoff, QA loops, product-led experience patterns, brand-voice in the build. Tahi's craft differentiation lane.",
  },
  {
    name: 'Webflow Custom Engineering',
    slug: 'webflow-custom-engineering',
    description: 'Webflow Cloud, Webflow Apps, integrations, product-on-Webflow, onboarding-on-Webflow, custom dashboards, embedded AI in Webflow, headless patterns. Highest commercial intent + lowest SERP competition — likely highest near-term traffic ROI.',
  },
  {
    name: 'Agency Operations',
    slug: 'agency-operations',
    description: 'Running, pricing, and scaling a Webflow agency. Partner-program mechanics, productised services, retainers, pricing models, lead routing, agency tooling. Meta audience (other founders + agency staff); Premium Partner status gives authority here.',
  },
]
