/**
 * Default topical clusters for Tahi's content engine (WORKFLOWS Phase I).
 *
 * Lives in lib/ not in the route file because Next.js 15 App Router only
 * permits HTTP-method exports + a small set of config exports from route
 * handlers — exporting non-route constants from `route.ts` is a hard
 * build error (`next build` rejects it even though `tsc` does not).
 *
 * Consumers:
 *   - app/api/admin/content/clusters/seed/route.ts  — the seed endpoint
 *   - app/api/admin/cron/ideation/route.ts          — auto-seed on first run
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
    description: 'Large-org Webflow builds, governance, multi-locale, security reviews, integrations with enterprise stacks.',
  },
  {
    name: 'Migration',
    slug: 'migration',
    description: 'Moving from WordPress, Framer, headless CMSes, and bespoke builds onto Webflow. Content modelling + redirect strategy.',
  },
  {
    name: 'Design-to-dev handoff',
    slug: 'design-to-dev',
    description: 'Figma-to-Webflow workflows, design tokens, component-level handoff, QA loops that scale across designers and developers.',
  },
  {
    name: 'Webflow agencies + Partner Program',
    slug: 'webflow-agencies',
    description: 'Running, pricing, and scaling a Webflow agency. Partner-program mechanics, lead routing, agency tooling.',
  },
  {
    name: 'Performance + SEO',
    slug: 'performance-seo',
    description: 'Core Web Vitals on Webflow, image strategy, JS hygiene, SEO fundamentals, AEO and answer-engine optimisation.',
  },
  {
    name: 'Product-led + Experience',
    slug: 'product-led',
    description: "Tahi's own product surface area: Calculator, Nodeo, internal case studies. The E-E-A-T signal lane.",
  },
  {
    name: 'Sustainable web',
    slug: 'sustainable-web',
    description: 'Tahi-unique angle. Carbon-aware design, low-carbon hosting, page weight, the climate impact of marketing sites.',
  },
  {
    name: 'NZ + AU regional',
    slug: 'nz-au-regional',
    description: 'Geo play. New Zealand + Australia market briefs, hreflang en-NZ + en-AU, regional brand comparisons.',
  },
]
