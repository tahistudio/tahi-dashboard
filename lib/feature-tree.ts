/**
 * lib/feature-tree.ts — the single source of truth for gateable features
 * (granular permissions, SPECS/granular-permissions.md).
 *
 * Every gateable surface is a node with a dotted key: page > tab/section > card.
 * The API enforcement, the sidebar nav filter, the <Gate> component, and the
 * permissions builder UI all read this manifest. v1 granularity = page + tab/card
 * (not per-action). Pure data (no React) so server + client share it.
 *
 * `appliesTo` marks who a feature is relevant for:
 *   'team'   — internal Tahi surfaces (gate per team member / role)
 *   'client' — client-portal surfaces (gate per client org)
 * A node can apply to both (e.g. requests, messages, invoices, files).
 */

export type FeatureAudience = 'team' | 'client'

export interface FeatureNode {
  /** Dotted path. Parent is everything before the last dot. */
  key: string
  label: string
  /** The "why this exists", shown in the builder so overrides are self-documenting. */
  description: string
  /** Null for top-level pages. */
  parent: string | null
  appliesTo: ReadonlyArray<FeatureAudience>
  /** Sidebar route for top-level page nodes (used by nav filtering). */
  route?: string
}

// Order here is the display order in the builder tree.
export const FEATURE_TREE: ReadonlyArray<FeatureNode> = [
  // ── Client-facing portal surfaces ──────────────────────────────────────────
  { key: 'overview', label: 'Overview', description: 'Home dashboard.', parent: null, appliesTo: ['team', 'client'], route: '/overview' },
  { key: 'requests', label: 'Requests', description: 'Client work requests (submit, track, board).', parent: null, appliesTo: ['team', 'client'], route: '/requests' },
  { key: 'requests.board', label: 'Requests board', description: 'Kanban / timeline board view of requests.', parent: 'requests', appliesTo: ['team', 'client'] },
  { key: 'requests.bulk_actions', label: 'Requests bulk actions', description: 'Multi-select bulk status / assign / archive.', parent: 'requests', appliesTo: ['team'] },
  { key: 'messages', label: 'Messages', description: 'Conversations between Tahi and the client.', parent: null, appliesTo: ['team', 'client'], route: '/messages' },
  { key: 'files', label: 'Files', description: 'Client file browser (R2 uploads).', parent: null, appliesTo: ['client'], route: '/files' },
  { key: 'invoices', label: 'Invoices', description: 'Billing records.', parent: null, appliesTo: ['team', 'client'], route: '/invoices' },
  { key: 'services', label: 'Services', description: 'Client portal service catalogue.', parent: null, appliesTo: ['client'], route: '/services' },
  { key: 'tracks', label: 'Tracks', description: 'Retainer capacity tracks + queue.', parent: null, appliesTo: ['client'], route: '/tracks' },
  { key: 'schedules', label: 'Schedules', description: 'Project schedules / gantt (client can view shared).', parent: null, appliesTo: ['team', 'client'], route: '/schedules' },
  { key: 'contracts', label: 'Contracts', description: 'Contract tracking + signing.', parent: null, appliesTo: ['team', 'client'], route: '/contracts' },
  { key: 'proposals', label: 'Proposals', description: 'Proposal viewer / builder.', parent: null, appliesTo: ['team', 'client'], route: '/proposals' },

  // ── Tahi-internal surfaces ─────────────────────────────────────────────────
  { key: 'tasks', label: 'Tasks', description: 'Tahi-internal task board (never client-visible).', parent: null, appliesTo: ['team'], route: '/tasks' },
  { key: 'leads', label: 'Leads', description: 'Lead intake + scoring.', parent: null, appliesTo: ['team'], route: '/leads' },
  { key: 'calls', label: 'Calls', description: 'Discovery + client calls.', parent: null, appliesTo: ['team'], route: '/calls' },
  { key: 'deals', label: 'Deals', description: 'Sales pipeline.', parent: null, appliesTo: ['team'], route: '/deals' },
  { key: 'deals.engagement_health', label: 'Engagement health card', description: 'Live delivery rollup on the deal.', parent: 'deals', appliesTo: ['team'] },
  { key: 'calculator', label: 'Calculator', description: 'Internal pricing calculator.', parent: null, appliesTo: ['team'], route: '/calculator' },
  { key: 'sales_analytics', label: 'Sales analytics', description: 'Pipeline + sales reporting.', parent: null, appliesTo: ['team'], route: '/sales-analytics' },
  { key: 'clients', label: 'Clients', description: 'Client / organisation management.', parent: null, appliesTo: ['team'], route: '/clients' },
  { key: 'clients.billing_card', label: 'Client billing card', description: 'MRR / billing details on the client detail.', parent: 'clients', appliesTo: ['team'] },
  { key: 'clients.engagement_health', label: 'Client engagement health card', description: 'Live delivery rollup on the client.', parent: 'clients', appliesTo: ['team'] },
  { key: 'content_studio', label: 'Content studio', description: 'Blog / content engine.', parent: null, appliesTo: ['team'], route: '/content-studio' },
  { key: 'sitemap', label: 'Sitemap', description: 'Sitemap planning tool.', parent: null, appliesTo: ['team'], route: '/sitemap' },
  { key: 'social', label: 'Social', description: 'Social scheduling (Buffer).', parent: null, appliesTo: ['team'], route: '/social' },
  { key: 'reviews', label: 'Reviews', description: 'Case-study + testimonial pipeline.', parent: null, appliesTo: ['team'], route: '/reviews' },
  { key: 'announcements', label: 'Announcements', description: 'Broadcast banners.', parent: null, appliesTo: ['team'], route: '/announcements' },
  { key: 'billing', label: 'Billing', description: 'Subscription billing admin.', parent: null, appliesTo: ['team'], route: '/billing' },
  { key: 'time', label: 'Time', description: 'Time tracking.', parent: null, appliesTo: ['team'], route: '/time' },
  { key: 'financial_reports', label: 'Financial reports', description: 'Cash, MRR, runway, reserves.', parent: null, appliesTo: ['team'], route: '/financial-reports' },
  { key: 'reports', label: 'Reports', description: 'Operational reports.', parent: null, appliesTo: ['team'], route: '/reports' },
  { key: 'capacity', label: 'Capacity', description: 'Team capacity planning.', parent: null, appliesTo: ['team'], route: '/capacity' },
  { key: 'team', label: 'Team', description: 'Team members + access rules.', parent: null, appliesTo: ['team'], route: '/team' },
  { key: 'docs', label: 'Docs Hub', description: 'Internal knowledge hub.', parent: null, appliesTo: ['team'], route: '/docs' },
  { key: 'settings', label: 'Settings', description: 'Account + workspace settings.', parent: null, appliesTo: ['team'], route: '/settings' },
  { key: 'settings.integrations', label: 'Settings: integrations', description: 'Connected services + webhooks.', parent: 'settings', appliesTo: ['team'] },
  { key: 'settings.permissions', label: 'Settings: permissions', description: 'The permissions builder itself.', parent: 'settings', appliesTo: ['team'] },
]

const BY_KEY = new Map(FEATURE_TREE.map(n => [n.key, n]))

export function getFeatureNode(key: string): FeatureNode | undefined {
  return BY_KEY.get(key)
}

export function isFeatureKey(key: string): boolean {
  return BY_KEY.has(key)
}

/** Direct children of a node (or top-level pages when parent is null). */
export function featureChildren(parentKey: string | null): FeatureNode[] {
  return FEATURE_TREE.filter(n => n.parent === parentKey)
}

/** A feature key + all of its ancestors, leaf-first. Used so denying a parent
 *  (e.g. `requests`) implicitly denies its children (`requests.board`). */
export function featureAncestry(key: string): string[] {
  const chain: string[] = []
  let cur: string | null = key
  while (cur) {
    chain.push(cur)
    cur = BY_KEY.get(cur)?.parent ?? null
  }
  return chain
}

/** Top-level page nodes that map to a sidebar route, filtered by audience. */
export function featurePages(audience: FeatureAudience): FeatureNode[] {
  return FEATURE_TREE.filter(n => n.parent === null && n.route && n.appliesTo.includes(audience))
}
