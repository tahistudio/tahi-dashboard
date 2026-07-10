/**
 * Feature grouping for the Team & access pane (slide-over sections + roles
 * matrix group rows). FEATURE_TREE is the single source of truth for keys,
 * labels, and descriptions; this file only arranges its TOP-LEVEL nodes into
 * the section headings the design uses. Children always render under their
 * parent, so only parents are listed here.
 *
 * Safety net: any team/client top-level key not claimed below is appended to
 * an "Other" group at runtime, so a new FEATURE_TREE node can never silently
 * vanish from the pane.
 */

import { FEATURE_TREE, featureChildren, type FeatureAudience, type FeatureNode } from '@/lib/feature-tree'

export interface FeatureGroup {
  label: string
  nodes: FeatureNode[]
}

const TEAM_GROUPS: ReadonlyArray<{ label: string; keys: string[] }> = [
  { label: 'Workspace', keys: ['overview', 'requests', 'tasks', 'messages'] },
  {
    label: 'Sales',
    keys: ['leads', 'calls', 'deals', 'proposals', 'schedules', 'contracts', 'calculator', 'sales_analytics'],
  },
  { label: 'Clients', keys: ['clients'] },
  { label: 'Marketing', keys: ['content_studio', 'sitemap', 'social', 'reviews', 'announcements'] },
  { label: 'Finance', keys: ['invoices', 'billing', 'time', 'financial_reports', 'reports'] },
  { label: 'Operations', keys: ['capacity', 'team'] },
  { label: 'Knowledge', keys: ['docs'] },
  { label: 'Settings', keys: ['settings'] },
]

const CLIENT_GROUPS: ReadonlyArray<{ label: string; keys: string[] }> = [
  { label: 'Your project', keys: ['overview', 'requests', 'messages', 'schedules', 'tracks'] },
  { label: 'Library', keys: ['files', 'services'] },
  { label: 'Billing', keys: ['invoices', 'contracts', 'proposals'] },
]

function buildGroups(
  layout: ReadonlyArray<{ label: string; keys: string[] }>,
  audience: FeatureAudience,
): FeatureGroup[] {
  const topNodes = FEATURE_TREE.filter((n) => n.parent === null && n.appliesTo.includes(audience))
  const byKey = new Map(topNodes.map((n) => [n.key, n]))
  const claimed = new Set<string>()

  const groups: FeatureGroup[] = []
  for (const g of layout) {
    const nodes: FeatureNode[] = []
    for (const key of g.keys) {
      const node = byKey.get(key)
      if (node) {
        nodes.push(node)
        claimed.add(key)
      }
    }
    if (nodes.length) groups.push({ label: g.label, nodes })
  }

  const leftover = topNodes.filter((n) => !claimed.has(n.key))
  if (leftover.length) groups.push({ label: 'Other', nodes: leftover })

  return groups
}

export const TEAM_FEATURE_GROUPS: FeatureGroup[] = buildGroups(TEAM_GROUPS, 'team')
export const CLIENT_FEATURE_GROUPS: FeatureGroup[] = buildGroups(CLIENT_GROUPS, 'client')

export function groupsFor(audience: FeatureAudience): FeatureGroup[] {
  return audience === 'client' ? CLIENT_FEATURE_GROUPS : TEAM_FEATURE_GROUPS
}

/** Audience-filtered children of a top-level node, in tree order. */
export function childrenFor(node: FeatureNode, audience: FeatureAudience): FeatureNode[] {
  return featureChildren(node.key).filter((c) => c.appliesTo.includes(audience))
}
