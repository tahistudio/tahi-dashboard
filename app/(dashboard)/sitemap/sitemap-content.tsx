'use client'

/**
 * Sitemap UI. Tree on left (sorted by parent then sortOrder), detail
 * editor on right. Auto-saves on blur. Live status badges. Add/duplicate/
 * delete actions. The 6-reviewer sub-agent panel comes in Day 3.
 *
 * Visual mode (auto-arranged canvas) lands Day 4.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Trash2, Copy, ChevronRight, ChevronDown,
  Loader2, Save, FileText, Layers, FolderTree, Sparkles, AlertCircle, CheckCircle2, Download, Users,
} from 'lucide-react'
import { PageHeader } from '@/components/tahi/page-header'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Input, Textarea } from '@/components/tahi/input'
import { EmptyState } from '@/components/tahi/empty-state'
import { useToast } from '@/components/tahi/toast'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
import { apiPath } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────

interface SitemapNode {
  id: string
  parentId: string | null
  sortOrder: number
  nodeType: 'page' | 'cms_collection' | 'section'
  title: string
  slug: string | null
  url: string | null
  purpose: string | null
  icpAudience: string | null
  primaryKeyword: string | null
  aeoIntent: string | null
  positioningVertical: string | null
  successMetric: string | null
  status: 'idea' | 'spec_done' | 'design_done' | 'webflow_done' | 'live' | 'parked'
  specialFeatures: string | null
  designNotes: string | null
  contentNotes: string | null
  contentBlocksNeeded: string | null
  targetLaunchDate: string | null
  bodyTiptap: string | null
  createdAt: string
  updatedAt: string
  lastEditedBy: string | null
}

type ApplyableField =
  | 'title' | 'slug' | 'url' | 'purpose' | 'icpAudience' | 'primaryKeyword'
  | 'aeoIntent' | 'positioningVertical' | 'successMetric' | 'specialFeatures'
  | 'designNotes' | 'contentNotes' | 'contentBlocksNeeded' | 'targetLaunchDate'

interface SuggestionApply {
  field: ApplyableField
  operation: 'replace' | 'append'
  newValue: string
}

interface ParsedSuggestion {
  label: string
  detail: string
  apply?: SuggestionApply
}

const NODE_TYPE_LABEL: Record<SitemapNode['nodeType'], string> = {
  page: 'Page',
  cms_collection: 'CMS',
  section: 'Section',
}

const NODE_TYPE_ICON: Record<SitemapNode['nodeType'], typeof FileText> = {
  page: FileText,
  cms_collection: Layers,
  section: FolderTree,
}

const STATUS_TONE: Record<SitemapNode['status'], BadgeTone> = {
  idea: 'neutral',
  spec_done: 'info',
  design_done: 'brand',
  webflow_done: 'warning',
  live: 'positive',
  parked: 'neutral',
}

const STATUS_LABEL: Record<SitemapNode['status'], string> = {
  idea: 'Idea',
  spec_done: 'Spec done',
  design_done: 'Design done',
  webflow_done: 'Webflow done',
  live: 'Live',
  parked: 'Parked',
}

type ReviewerKey = 'seo_aeo' | 'icp' | 'brand_voice' | 'cro' | 'sales' | 'marketing'

interface SitemapReview {
  id: string
  nodeId: string
  reviewerKey: ReviewerKey
  score: number | null
  summary: string | null
  suggestions: string | null
  critique: string | null
  costCents: number
  createdAt: string
}

const REVIEWERS: Array<{ key: ReviewerKey; label: string; tagline: string }> = [
  { key: 'seo_aeo',     label: 'SEO + AEO',    tagline: 'Search + answer-engine fit' },
  { key: 'icp',         label: 'ICP fit',      tagline: 'Voice of the ideal buyer' },
  { key: 'brand_voice', label: 'Brand voice',  tagline: 'Tahi tone + AI-tells' },
  { key: 'cro',         label: 'CRO',          tagline: 'Conversion lens' },
  { key: 'sales',       label: 'Sales',        tagline: 'Objections + close' },
  { key: 'marketing',   label: 'Marketing',    tagline: 'Distribution + cluster' },
]

const VERTICAL_OPTIONS = [
  'Enterprise Custom Webflow',
  'Operations',
  'Webflow Cloud',
  'UI/UX',
  'Product Integrations',
  'Pricing & Sales',
  'Resources & Education',
  'Showcase',
] as const

// ── Component ─────────────────────────────────────────────────────────────

export function SitemapContent() {
  const { showToast } = useToast()
  const [nodes, setNodes] = useState<SitemapNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [boardroomOpen, setBoardroomOpen] = useState(false)
  const [siteReviews, setSiteReviews] = useState<SitemapReview[]>([])
  const [boardroomRunning, setBoardroomRunning] = useState(false)

  const fetchSiteReviews = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/sitemap/review-site'))
      if (!res.ok) return
      const json = await res.json() as { reviews: SitemapReview[] }
      setSiteReviews(json.reviews ?? [])
    } catch { /* ignore */ }
  }, [])

  async function runBoardroom() {
    if (nodes.length === 0) {
      showToast('Sitemap is empty', 'error')
      return
    }
    if (!confirm(`Run all 6 site-level reviewers against the entire sitemap (${nodes.length} nodes)? This may take 30-60s and costs ~$0.30.`)) return
    setBoardroomRunning(true)
    try {
      const res = await fetch(apiPath('/api/admin/sitemap/review-site'), { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(`Boardroom failed: ${j.error ?? 'unknown'}`, 'error')
        return
      }
      const json = await res.json() as { outcomes: Array<{ reviewerKey: string; ok: boolean }> }
      const ok = json.outcomes.filter(o => o.ok).length
      await fetchSiteReviews()
      setBoardroomOpen(true)
      showToast(`${ok}/${json.outcomes.length} site reviewers completed`, ok === json.outcomes.length ? 'success' : 'error')
    } catch (err) {
      showToast(`Boardroom failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBoardroomRunning(false)
    }
  }

  useEffect(() => { void fetchSiteReviews() }, [fetchSiteReviews])

  const selected = useMemo(
    () => nodes.find(n => n.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  const fetchNodes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/sitemap/nodes'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { nodes: SitemapNode[] }
      setNodes(json.nodes)
      if (!selectedId && json.nodes.length > 0) {
        setSelectedId(json.nodes.find(n => !n.parentId)?.id ?? json.nodes[0].id)
      }
      // First load: expand every node that has children so the full
      // planned IA is visible at a glance. Subsequent loads keep the
      // user's manual collapse state.
      setExpanded(prev => {
        if (prev.size > 0) return prev
        const withChildren = new Set<string>()
        const parentIds = new Set(json.nodes.map(n => n.parentId).filter((id): id is string => !!id))
        for (const id of parentIds) withChildren.add(id)
        return withChildren
      })
    } catch (err) {
      showToast(`Failed to load: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedId, showToast])

  useEffect(() => { void fetchNodes() }, [fetchNodes])

  async function createNode(parentId: string | null, nodeType: SitemapNode['nodeType'] = 'page') {
    setAdding(true)
    try {
      const siblings = nodes.filter(n => n.parentId === parentId)
      const res = await fetch(apiPath('/api/admin/sitemap/nodes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId,
          nodeType,
          title: nodeType === 'section' ? 'New section' : nodeType === 'cms_collection' ? 'New CMS collection' : 'New page',
          sortOrder: siblings.length,
          status: 'idea',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(`Create failed: ${j.error ?? 'unknown'}`, 'error')
        return
      }
      const json = await res.json() as { node: SitemapNode }
      setNodes(prev => [...prev, json.node])
      setSelectedId(json.node.id)
      if (parentId) setExpanded(s => new Set([...s, parentId]))
    } catch (err) {
      showToast(`Create failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setAdding(false)
    }
  }

  async function patchNode(id: string, patch: Partial<SitemapNode>) {
    setSaving(true)
    // Optimistic update
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n))
    try {
      const res = await fetch(apiPath(`/api/admin/sitemap/nodes/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(`Save failed: ${j.error ?? 'unknown'}`, 'error')
        await fetchNodes()  // rollback by re-fetch
        return
      }
      const json = await res.json() as { node: SitemapNode }
      setNodes(prev => prev.map(n => n.id === id ? json.node : n))
    } catch (err) {
      showToast(`Save failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
      await fetchNodes()
    } finally {
      setSaving(false)
    }
  }

  async function deleteNode(id: string) {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    const childrenCount = countDescendants(nodes, id)
    const msg = childrenCount > 0
      ? `Delete "${node.title}" and its ${childrenCount} descendant${childrenCount === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete "${node.title}"? This cannot be undone.`
    if (!confirm(msg)) return
    try {
      const res = await fetch(apiPath(`/api/admin/sitemap/nodes/${id}`), { method: 'DELETE' })
      if (!res.ok) {
        showToast('Delete failed', 'error')
        return
      }
      const j = await res.json() as { deletedCount: number }
      showToast(`Deleted ${j.deletedCount} node${j.deletedCount === 1 ? '' : 's'}`)
      if (selectedId === id) setSelectedId(null)
      await fetchNodes()
    } catch (err) {
      showToast(`Delete failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    }
  }

  async function duplicateNode(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/sitemap/nodes/${id}/duplicate`), { method: 'POST' })
      if (!res.ok) {
        showToast('Duplicate failed', 'error')
        return
      }
      const j = await res.json() as { node: SitemapNode }
      setNodes(prev => [...prev, j.node])
      setSelectedId(j.node.id)
      showToast(`Duplicated "${j.node.title}"`)
    } catch (err) {
      showToast(`Duplicate failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    }
  }

  return (
    <div className="sitemap-page-root" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: 'calc(100vh - 5rem)' }}>
      {/* Responsive: desktop = fixed-height 2-col, each pane scrolls
          internally. Mobile = page flows naturally, tree capped + scrolls,
          detail pane grows with content so the FULL doc is readable by
          scrolling the page (not trapped in a tiny internal box). */}
      <style>{`
        .sitemap-main-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 768px) {
          .sitemap-main-grid {
            grid-template-columns: minmax(18rem, 1fr) 2.4fr;
          }
        }
        @media (max-width: 767px) {
          .sitemap-page-root { height: auto !important; }
          .sitemap-main-grid { flex: none !important; min-height: 0; }
          .sitemap-tree-pane { max-height: 15rem; }
          .sitemap-detail-pane { overflow: visible !important; }
        }
      `}</style>
      <PageHeader
        title="Sitemap"
        subtitle="Plan + document every page of the redesign. Long-lived planning library."
      >
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <TahiButton
            size="sm"
            variant="secondary"
            loading={boardroomRunning}
            onClick={() => { void runBoardroom() }}
            iconLeft={<Users className="w-3.5 h-3.5" />}
          >
            Boardroom
          </TahiButton>
          <TahiButton
            size="sm"
            variant="secondary"
            onClick={() => { window.location.href = apiPath('/api/admin/sitemap/export') }}
            iconLeft={<Download className="w-3.5 h-3.5" />}
          >
            Export
          </TahiButton>
          <TahiButton size="sm" variant="secondary" loading={adding} onClick={() => { void createNode(null, 'section') }} iconLeft={<FolderTree className="w-3.5 h-3.5" />}>
            Add section
          </TahiButton>
          <TahiButton size="sm" variant="secondary" loading={adding} onClick={() => { void createNode(null, 'cms_collection') }} iconLeft={<Layers className="w-3.5 h-3.5" />}>
            Add CMS
          </TahiButton>
          <TahiButton size="sm" loading={adding} onClick={() => { void createNode(null, 'page') }} iconLeft={<Plus className="w-3.5 h-3.5" />}>
            Add page
          </TahiButton>
        </div>
      </PageHeader>

      {/* Boardroom collapsible */}
      {siteReviews.length > 0 && (
        <BoardroomBar
          reviews={siteReviews}
          open={boardroomOpen}
          onToggle={() => setBoardroomOpen(o => !o)}
        />
      )}

      <div className="sitemap-main-grid" style={{ display: 'grid', gap: '1rem', flex: 1, minHeight: 0 }}>
        {/* Tree */}
        <Card className="sitemap-tree-pane" style={{ overflow: 'auto', padding: '0.75rem' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ display: 'inline-block', color: 'var(--color-text-muted)' }} />
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState
              icon={<FolderTree className="w-5 h-5" />}
              title="Empty sitemap"
              description="Add a page or section to start planning. Build up the structure first, then document each page."
            />
          ) : (
            <Tree
              nodes={nodes}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={setSelectedId}
              onToggleExpand={(id) => setExpanded(s => {
                const next = new Set(s)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })}
              onAddChild={(parentId) => { void createNode(parentId, 'page') }}
            />
          )}
        </Card>

        {/* Detail */}
        <Card className="sitemap-detail-pane" style={{ overflow: 'auto', padding: '1.25rem' }}>
          {!selected ? (
            <EmptyState
              icon={<FileText className="w-5 h-5" />}
              title="Select a page"
              description="Pick a page from the tree to view + edit its doc."
            />
          ) : (
            <NodeDetail
              node={selected}
              onPatch={(patch) => { void patchNode(selected.id, patch) }}
              onDelete={() => { void deleteNode(selected.id) }}
              onDuplicate={() => { void duplicateNode(selected.id) }}
              saving={saving}
            />
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Tree ──────────────────────────────────────────────────────────────────

interface TreeProps {
  nodes: SitemapNode[]
  selectedId: string | null
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onAddChild: (parentId: string) => void
}

function Tree({ nodes, selectedId, expanded, onSelect, onToggleExpand, onAddChild }: TreeProps) {
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, SitemapNode[]>()
    for (const n of nodes) {
      const key = n.parentId
      const arr = map.get(key) ?? []
      arr.push(n)
      map.set(key, arr)
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    }
    return map
  }, [nodes])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
      {(childrenOf.get(null) ?? []).map(n => (
        <TreeRow
          key={n.id}
          node={n}
          depth={0}
          childrenOf={childrenOf}
          selectedId={selectedId}
          expanded={expanded}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  )
}

interface TreeRowProps {
  node: SitemapNode
  depth: number
  childrenOf: Map<string | null, SitemapNode[]>
  selectedId: string | null
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onAddChild: (parentId: string) => void
}

function TreeRow({ node, depth, childrenOf, selectedId, expanded, onSelect, onToggleExpand, onAddChild }: TreeRowProps) {
  const children = childrenOf.get(node.id) ?? []
  const hasChildren = children.length > 0
  const isExpanded = expanded.has(node.id)
  const isSelected = selectedId === node.id
  const Icon = NODE_TYPE_ICON[node.nodeType]
  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          padding: '0.375rem 0.5rem',
          paddingLeft: `${0.5 + depth * 1.125}rem`,
          borderRadius: '0.375rem',
          cursor: 'pointer',
          background: isSelected ? 'var(--color-bg-tertiary)' : 'transparent',
          color: isSelected ? 'var(--color-text)' : 'var(--color-text)',
          fontSize: '0.8125rem',
        }}
        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)' }}
        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', display: 'flex' }}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span style={{ width: '0.875rem', display: 'inline-block' }} />
        )}
        <Icon className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 500 : 400 }}>
          {node.title}
        </span>
        <Badge tone={STATUS_TONE[node.status]}>{STATUS_LABEL[node.status]}</Badge>
        <button
          onClick={(e) => { e.stopPropagation(); onAddChild(node.id) }}
          title="Add child page"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.125rem', color: 'var(--color-text-muted)', display: 'flex' }}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      {hasChildren && isExpanded && children.map(c => (
        <TreeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          childrenOf={childrenOf}
          selectedId={selectedId}
          expanded={expanded}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onAddChild={onAddChild}
        />
      ))}
    </>
  )
}

function countDescendants(nodes: SitemapNode[], rootId: string): number {
  let count = 0
  function walk(id: string) {
    for (const n of nodes) {
      if (n.parentId === id) {
        count++
        walk(n.id)
      }
    }
  }
  walk(rootId)
  return count
}

// ── Detail ────────────────────────────────────────────────────────────────

interface NodeDetailProps {
  node: SitemapNode
  onPatch: (patch: Partial<SitemapNode>) => void
  onDelete: () => void
  onDuplicate: () => void
  saving: boolean
}

function NodeDetail({ node, onPatch, onDelete, onDuplicate, saving }: NodeDetailProps) {
  const { showToast } = useToast()
  const [reviews, setReviews] = useState<SitemapReview[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [runningKey, setRunningKey] = useState<ReviewerKey | 'all' | null>(null)
  const [applyingAll, setApplyingAll] = useState(false)
  // Spec mode = read-only doc (default, Staci-friendly).
  // Edit mode = input fields (current view, for filling/editing).
  // Persist preference per-session so toggling once sticks.
  const [viewMode, setViewMode] = useState<'spec' | 'edit'>(() => {
    if (typeof window === 'undefined') return 'spec'
    return (localStorage.getItem('tahi-sitemap-view') as 'spec' | 'edit') ?? 'spec'
  })
  useEffect(() => {
    try { localStorage.setItem('tahi-sitemap-view', viewMode) } catch { /* noop */ }
  }, [viewMode])

  function applySuggestion(apply: SuggestionApply): boolean {
    const field = apply.field
    const currentValue = (node as unknown as Record<string, string | null>)[field] ?? ''
    const nextValue = apply.operation === 'append'
      ? (currentValue ? `${currentValue}\n${apply.newValue}` : apply.newValue)
      : apply.newValue
    // Cast through Partial<SitemapNode> — `field` is a known applyable key.
    onPatch({ [field]: nextValue } as Partial<SitemapNode>)
    return true
  }

  function applyAllInReview(review: SitemapReview): number {
    let count = 0
    try {
      const parsed = JSON.parse(review.suggestions ?? '[]') as ParsedSuggestion[]
      const patch: Partial<SitemapNode> = {}
      for (const s of parsed) {
        if (!s.apply) continue
        const cur = (patch[s.apply.field as keyof SitemapNode] as string | null | undefined)
          ?? ((node as unknown as Record<string, string | null>)[s.apply.field] ?? '')
        const next = s.apply.operation === 'append'
          ? (cur ? `${cur}\n${s.apply.newValue}` : s.apply.newValue)
          : s.apply.newValue
        ;(patch as Record<string, string>)[s.apply.field] = next
        count++
      }
      if (count > 0) onPatch(patch)
    } catch { /* ignore parse failures */ }
    return count
  }

  async function applyAllFromAllReviewers() {
    setApplyingAll(true)
    try {
      // Batch-merge — same field across reviewers: last reviewer wins.
      const patch: Partial<SitemapNode> = {}
      let count = 0
      for (const r of reviews) {
        try {
          const parsed = JSON.parse(r.suggestions ?? '[]') as ParsedSuggestion[]
          for (const s of parsed) {
            if (!s.apply) continue
            const cur = (patch[s.apply.field as keyof SitemapNode] as string | null | undefined)
              ?? ((node as unknown as Record<string, string | null>)[s.apply.field] ?? '')
            const next = s.apply.operation === 'append'
              ? (cur ? `${cur}\n${s.apply.newValue}` : s.apply.newValue)
              : s.apply.newValue
            ;(patch as Record<string, string>)[s.apply.field] = next
            count++
          }
        } catch { /* ignore */ }
      }
      if (count === 0) {
        showToast('No applyable suggestions available', 'error')
        return
      }
      onPatch(patch)
      showToast(`Applied ${count} suggestion${count === 1 ? '' : 's'} from ${reviews.length} reviewer${reviews.length === 1 ? '' : 's'}`)
    } finally {
      setApplyingAll(false)
    }
  }

  const fetchReviews = useCallback(async () => {
    setReviewLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/sitemap/nodes/${node.id}`))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { reviews: SitemapReview[] }
      setReviews(json.reviews ?? [])
    } catch {
      // Silent — the panel already shows the node, reviews are a bonus.
    } finally {
      setReviewLoading(false)
    }
  }, [node.id])

  useEffect(() => { void fetchReviews() }, [fetchReviews])

  async function runReviewer(reviewerKey: ReviewerKey) {
    setRunningKey(reviewerKey)
    try {
      const res = await fetch(apiPath(`/api/admin/sitemap/nodes/${node.id}/review`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerKey }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(`Reviewer failed: ${j.error ?? 'unknown'}`, 'error')
        return
      }
      await fetchReviews()
      showToast(`${REVIEWERS.find(r => r.key === reviewerKey)?.label ?? reviewerKey} done`)
    } catch (err) {
      showToast(`Reviewer failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setRunningKey(null)
    }
  }

  async function runAllReviewers() {
    setRunningKey('all')
    try {
      const res = await fetch(apiPath(`/api/admin/sitemap/nodes/${node.id}/review-all`), {
        method: 'POST',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(`Review-all failed: ${j.error ?? 'unknown'}`, 'error')
        return
      }
      const json = await res.json() as { outcomes: Array<{ reviewerKey: string; ok: boolean }> }
      const ok = json.outcomes.filter(o => o.ok).length
      const total = json.outcomes.length
      await fetchReviews()
      showToast(`${ok}/${total} reviewers completed`, ok === total ? 'success' : 'error')
    } catch (err) {
      showToast(`Review-all failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setRunningKey(null)
    }
  }

  // Latest review per reviewer key (reviews come back desc by createdAt)
  const latestByKey = useMemo(() => {
    const map = new Map<ReviewerKey, SitemapReview>()
    for (const r of reviews) {
      if (!map.has(r.reviewerKey)) map.set(r.reviewerKey, r)
    }
    return map
  }, [reviews])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          {viewMode === 'edit' ? (
            <FieldText
              label="Title"
              value={node.title}
              onSave={(v) => onPatch({ title: v })}
              inputStyle={{ fontSize: '1.125rem', fontWeight: 600 }}
            />
          ) : (
            <h2 style={{ fontSize: '1.375rem', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{node.title}</h2>
          )}
          <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', marginTop: '0.375rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
            <span>{NODE_TYPE_LABEL[node.nodeType]}</span>
            <span>·</span>
            <Badge tone={STATUS_TONE[node.status]}>{STATUS_LABEL[node.status]}</Badge>
            {node.url && (<><span>·</span><a href={node.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>{node.url.replace(/^https?:\/\//, '')}</a></>)}
            {viewMode === 'edit' && (
              <>
                <span>·</span>
                <span>Updated {new Date(node.updatedAt).toLocaleString()}</span>
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                {!saving && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.125rem' }}><Save className="w-3 h-3" /> Saved</span>}
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* View-mode toggle */}
          <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: '0.5rem', padding: '0.125rem', background: 'var(--color-bg-secondary)' }}>
            <button
              onClick={() => setViewMode('spec')}
              style={{
                border: 'none', padding: '0.25rem 0.625rem', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', borderRadius: '0.375rem',
                background: viewMode === 'spec' ? 'var(--color-bg)' : 'transparent',
                color: viewMode === 'spec' ? 'var(--color-text)' : 'var(--color-text-muted)',
                boxShadow: viewMode === 'spec' ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
              }}
            >Spec</button>
            <button
              onClick={() => setViewMode('edit')}
              style={{
                border: 'none', padding: '0.25rem 0.625rem', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', borderRadius: '0.375rem',
                background: viewMode === 'edit' ? 'var(--color-bg)' : 'transparent',
                color: viewMode === 'edit' ? 'var(--color-text)' : 'var(--color-text-muted)',
                boxShadow: viewMode === 'edit' ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
              }}
            >Edit</button>
          </div>
          <TahiButton size="sm" variant="secondary" onClick={onDuplicate} iconLeft={<Copy className="w-3.5 h-3.5" />}>
            Duplicate
          </TahiButton>
          <TahiButton size="sm" variant="secondary" onClick={onDelete} iconLeft={<Trash2 className="w-3.5 h-3.5" />}>
            Delete
          </TahiButton>
        </div>
      </div>

      {viewMode === 'edit' ? (
        <>
          {/* Top metadata row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.875rem' }}>
            <FieldSelect
              label="Status"
              value={node.status}
              options={Object.keys(STATUS_LABEL).map(k => ({ value: k, label: STATUS_LABEL[k as SitemapNode['status']] }))}
              onSave={(v) => onPatch({ status: v as SitemapNode['status'] })}
            />
            <FieldSelect
              label="Positioning vertical"
              value={node.positioningVertical ?? ''}
              options={[{ value: '', label: '— None —' }, ...VERTICAL_OPTIONS.map(v => ({ value: v, label: v }))]}
              onSave={(v) => onPatch({ positioningVertical: v || null })}
            />
            <FieldSelect
              label="Node type"
              value={node.nodeType}
              options={[
                { value: 'page', label: 'Page' },
                { value: 'cms_collection', label: 'CMS collection' },
                { value: 'section', label: 'Section (group)' },
              ]}
              onSave={(v) => onPatch({ nodeType: v as SitemapNode['nodeType'] })}
            />
          </div>

          {/* URL row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.875rem' }}>
            <FieldText label="Slug" value={node.slug ?? ''} onSave={(v) => onPatch({ slug: v || null })} placeholder="e.g. enterprise-webflow" />
            <FieldText label="Live or target URL" value={node.url ?? ''} onSave={(v) => onPatch({ url: v || null })} placeholder="https://www.tahi.studio/..." />
            <FieldText label="Target launch date" value={node.targetLaunchDate ?? ''} onSave={(v) => onPatch({ targetLaunchDate: v || null })} placeholder="YYYY-MM-DD" />
          </div>

          {/* Structured doc fields */}
          <FieldTextArea label="Purpose" value={node.purpose ?? ''} onSave={(v) => onPatch({ purpose: v || null })} placeholder="Why does this page exist? 1-2 sentences." />
          <FieldTextArea label="Target ICP audience" value={node.icpAudience ?? ''} onSave={(v) => onPatch({ icpAudience: v || null })} placeholder="Who is this page for? Be specific (e.g. 'CMO at a Series-B SaaS evaluating Webflow Enterprise')." />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
            <FieldText label="Primary keyword" value={node.primaryKeyword ?? ''} onSave={(v) => onPatch({ primaryKeyword: v || null })} placeholder="e.g. enterprise webflow agency" />
            <FieldText label="AEO intent" value={node.aeoIntent ?? ''} onSave={(v) => onPatch({ aeoIntent: v || null })} placeholder="What question does this answer for an AI engine?" />
          </div>

          <FieldTextArea label="Success metric" value={node.successMetric ?? ''} onSave={(v) => onPatch({ successMetric: v || null })} placeholder="How do we know this page is working? (e.g. '5 demo bookings/month from organic')" />
          <FieldTextArea label="Special features" value={node.specialFeatures ?? ''} onSave={(v) => onPatch({ specialFeatures: v || null })} placeholder="Distinctive interactions, integrations, animations — the things people don't see anywhere else." />
          <FieldTextArea label="Content blocks needed (one per line)" value={node.contentBlocksNeeded ?? ''} onSave={(v) => onPatch({ contentBlocksNeeded: v || null })} placeholder="FAQs section&#10;Pricing comparison table&#10;Testimonial carousel&#10;3-step process diagram&#10;ROI calculator&#10;Hero with client logos&#10;Inline CTA after section 2" />
          <FieldTextArea label="Design notes" value={node.designNotes ?? ''} onSave={(v) => onPatch({ designNotes: v || null })} placeholder="Staci's notes — visual direction, layout, components, references." />
          <FieldTextArea label="Content notes" value={node.contentNotes ?? ''} onSave={(v) => onPatch({ contentNotes: v || null })} placeholder="Liam's notes — voice, key claims, what NOT to say, citations to pull in." />

          {/* Freeform Tiptap */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: '0.375rem' }}>
              Freeform notes
            </label>
            <TiptapDocEditor
              content={node.bodyTiptap ?? ''}
              onChange={(html) => onPatch({ bodyTiptap: html })}
              placeholder="Anything else worth remembering. Slash commands work — type / for shortcuts."
            />
          </div>
        </>
      ) : (
        <SpecView node={node} />
      )}

      {/* Sub-agent reviewer panel */}
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.875rem' }}>
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, margin: 0 }}>Sub-agent review</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.125rem 0 0' }}>
              Six lenses on this page plan. Run individually or all at once.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            <TahiButton
              size="sm"
              variant="secondary"
              loading={applyingAll}
              disabled={runningKey !== null || reviews.length === 0}
              onClick={() => { void applyAllFromAllReviewers() }}
            >
              Apply all suggestions
            </TahiButton>
            <TahiButton
              size="sm"
              loading={runningKey === 'all'}
              disabled={runningKey !== null}
              onClick={() => { void runAllReviewers() }}
              iconLeft={<Sparkles className="w-3.5 h-3.5" />}
            >
              Run all
            </TahiButton>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '0.75rem' }}>
          {REVIEWERS.map(r => {
            const review = latestByKey.get(r.key)
            const running = runningKey === r.key || runningKey === 'all'
            return (
              <ReviewerCard
                key={r.key}
                label={r.label}
                tagline={r.tagline}
                review={review}
                running={running}
                disabled={runningKey !== null}
                onRun={() => { void runReviewer(r.key) }}
                onApplySuggestion={applySuggestion}
                onApplyAll={(r) => {
                  const n = applyAllInReview(r)
                  showToast(n > 0 ? `Applied ${n} suggestion${n === 1 ? '' : 's'}` : 'No applyable suggestions', n > 0 ? 'success' : 'error')
                }}
              />
            )
          })}
        </div>
        {reviewLoading && reviews.length === 0 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            Loading reviews...
          </p>
        )}
      </div>
    </div>
  )
}

// ── Reviewer card ─────────────────────────────────────────────────────────

interface ReviewerCardProps {
  label: string
  tagline: string
  review: SitemapReview | undefined
  running: boolean
  disabled: boolean
  onRun: () => void
  onApplySuggestion: (apply: SuggestionApply) => boolean
  onApplyAll: (review: SitemapReview) => void
}

function ReviewerCard({ label, tagline, review, running, disabled, onRun, onApplySuggestion, onApplyAll }: ReviewerCardProps) {
  const [open, setOpen] = useState(false)
  const score = review?.score ?? null
  const scoreColour = score === null ? 'var(--color-text-muted)'
    : score >= 75 ? 'var(--color-success)'
    : score >= 60 ? 'var(--color-warning)'
    : 'var(--color-danger)'
  const ScoreIcon = score === null ? null : score >= 75 ? CheckCircle2 : AlertCircle
  let suggestions: ParsedSuggestion[] = []
  if (review?.suggestions) {
    try {
      const parsed = JSON.parse(review.suggestions) as ParsedSuggestion[]
      if (Array.isArray(parsed)) suggestions = parsed
    } catch { /* ignore */ }
  }
  const applyableCount = suggestions.filter(s => !!s.apply).length
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-leaf-sm)', padding: '0.75rem', background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{label}</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>{tagline}</div>
        </div>
        {score !== null && ScoreIcon !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: scoreColour, fontSize: '0.875rem', fontWeight: 600, flexShrink: 0 }}>
            <ScoreIcon className="w-3.5 h-3.5" />
            <span>{score}</span>
          </div>
        )}
      </div>

      {review?.summary && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
          {review.summary}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.625rem' }}>
        <TahiButton
          size="sm"
          variant="secondary"
          loading={running}
          disabled={disabled}
          onClick={onRun}
        >
          {review ? 'Re-run' : 'Run'}
        </TahiButton>
        {review && (
          <TahiButton size="sm" variant="ghost" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide' : 'Details'}
          </TahiButton>
        )}
      </div>

      {open && review && (
        <div style={{ marginTop: '0.625rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {review.critique && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.5, background: 'var(--color-bg-secondary)', padding: '0.5rem', borderRadius: '0.375rem' }}>
              {review.critique}
            </div>
          )}
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Suggestions ({suggestions.length})
                  {applyableCount > 0 && (
                    <span style={{ color: 'var(--color-brand)', marginLeft: '0.375rem', textTransform: 'none', fontWeight: 500 }}>
                      · {applyableCount} applyable
                    </span>
                  )}
                </div>
                {applyableCount > 0 && review && (
                  <button
                    onClick={() => onApplyAll(review)}
                    style={{
                      background: 'var(--color-brand-50)',
                      color: 'var(--color-brand-dark)',
                      border: '1px solid var(--color-brand-100)',
                      borderRadius: '0.25rem',
                      padding: '0.125rem 0.5rem',
                      fontSize: '0.6875rem',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Apply all {applyableCount}
                  </button>
                )}
              </div>
              {suggestions.map((s, i) => (
                <div key={i} style={{ fontSize: '0.75rem', lineHeight: 1.5, paddingBottom: '0.375rem', borderBottom: i < suggestions.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{s.label}</div>
                      {s.detail && <div style={{ color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>{s.detail}</div>}
                      {s.apply && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
                          → <code style={{ background: 'var(--color-bg-secondary)', padding: '0 0.25rem', borderRadius: '0.125rem' }}>{s.apply.field}</code>
                          {s.apply.operation === 'append' ? ' (append)' : ''}
                        </div>
                      )}
                    </div>
                    {s.apply && (
                      <button
                        onClick={() => { onApplySuggestion(s.apply!) }}
                        style={{
                          background: 'var(--color-brand)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '0.25rem',
                          padding: '0.125rem 0.5rem',
                          fontSize: '0.6875rem',
                          cursor: 'pointer',
                          flexShrink: 0,
                          fontWeight: 500,
                        }}
                      >
                        Apply
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            {new Date(review.createdAt).toLocaleString()} · ${(review.costCents / 100).toFixed(3)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Field primitives ─────────────────────────────────────────────────────

interface FieldTextProps {
  label: string
  value: string
  onSave: (v: string) => void
  placeholder?: string
  inputStyle?: React.CSSProperties
}

// ── Spec view (read-only doc) ────────────────────────────────────────────

function SpecView({ node }: { node: SitemapNode }) {
  // Render any field that has content. Empty fields show as a greyed
  // "Not yet specified" so Staci sees the gap without clutter.
  function Section({ heading, value, multiline }: { heading: string; value: string | null; multiline?: boolean }) {
    const has = !!(value && value.trim())
    return (
      <section style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.375rem' }}>
          {heading}
        </h3>
        {has ? (
          <div style={{ fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--color-text)', whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>
            {value}
          </div>
        ) : (
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
            Not yet specified
          </div>
        )}
      </section>
    )
  }
  // Tiptap body: render the JSON walked to plain text for spec view.
  let bodyText = ''
  if (node.bodyTiptap) {
    try {
      const doc = JSON.parse(node.bodyTiptap) as unknown
      const out: string[] = []
      function walk(n: unknown) {
        if (!n || typeof n !== 'object') return
        const x = n as { type?: string; text?: string; content?: unknown[] }
        if (x.type === 'text' && typeof x.text === 'string') out.push(x.text)
        if (Array.isArray(x.content)) {
          for (const c of x.content) walk(c)
          if (x.type === 'paragraph' || x.type === 'heading') out.push('\n')
        }
      }
      walk(doc)
      bodyText = out.join('').replace(/\n{3,}/g, '\n\n').trim()
    } catch { /* ignore */ }
  }
  return (
    <div style={{ paddingTop: '0.5rem' }}>
      {/* Quick-facts bar — metadata stripe */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-leaf-sm)', marginBottom: '1.5rem' }}>
        <SpecFact label="Vertical" value={node.positioningVertical} />
        <SpecFact label="Slug" value={node.slug ? `/${node.slug}` : null} mono />
        <SpecFact label="Primary keyword" value={node.primaryKeyword} />
        <SpecFact label="Target launch" value={node.targetLaunchDate} />
      </div>

      <Section heading="Purpose" value={node.purpose} multiline />
      <Section heading="Target ICP audience" value={node.icpAudience} multiline />
      <Section heading="AEO intent" value={node.aeoIntent} multiline />
      <Section heading="Success metric" value={node.successMetric} multiline />
      <Section heading="Special features" value={node.specialFeatures} multiline />
      <Section heading="Content blocks needed" value={node.contentBlocksNeeded} multiline />
      <Section heading="Design notes" value={node.designNotes} multiline />
      <Section heading="Content notes" value={node.contentNotes} multiline />
      <Section heading="Freeform notes" value={bodyText || null} multiline />
    </div>
  )
}

function SpecFact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.125rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.8125rem', color: value ? 'var(--color-text)' : 'var(--color-text-subtle)', fontStyle: value ? 'normal' : 'italic', fontFamily: mono && value ? 'ui-monospace, SFMono-Regular, monospace' : undefined }}>
        {value ?? 'Not set'}
      </div>
    </div>
  )
}

function FieldText({ label, value, onSave, placeholder, inputStyle }: FieldTextProps) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>
        {label}
      </label>
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onSave(local) }}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  )
}

interface FieldTextAreaProps {
  label: string
  value: string
  onSave: (v: string) => void
  placeholder?: string
}

function FieldTextArea({ label, value, onSave, placeholder }: FieldTextAreaProps) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>
        {label}
      </label>
      <Textarea
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onSave(local) }}
        placeholder={placeholder}
        rows={2}
      />
    </div>
  )
}

interface FieldSelectProps {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onSave: (v: string) => void
}

function FieldSelect({ label, value, options, onSave }: FieldSelectProps) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onSave(e.target.value)}
        style={{
          fontSize: '0.8125rem',
          padding: '0.5rem 0.625rem',
          border: '1px solid var(--color-border)',
          borderRadius: '0.5rem',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          width: '100%',
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ── Boardroom (site-level reviewer summary) ──────────────────────────────

const REVIEWER_LABEL: Record<string, string> = {
  seo_aeo: 'SEO + AEO',
  icp: 'ICP fit',
  brand_voice: 'Brand voice',
  cro: 'CRO',
  sales: 'Sales',
  marketing: 'Marketing',
}

interface BoardroomBarProps {
  reviews: SitemapReview[]
  open: boolean
  onToggle: () => void
}

function BoardroomBar({ reviews, open, onToggle }: BoardroomBarProps) {
  const avgScore = reviews.length === 0 ? null
    : Math.round(reviews.reduce((acc, r) => acc + (r.score ?? 0), 0) / reviews.length)
  const oldestRun = reviews.reduce((acc, r) => acc < r.createdAt ? acc : r.createdAt, reviews[0]?.createdAt ?? '')
  return (
    <Card style={{ padding: 0 }}>
      <button
        onClick={onToggle}
        style={{
          background: 'none',
          border: 'none',
          width: '100%',
          textAlign: 'left',
          padding: '0.75rem 1rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Users className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />
          <div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Boardroom review</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
              {reviews.length} site reviewer{reviews.length === 1 ? '' : 's'}
              {avgScore !== null && ` · avg ${avgScore}/100`}
              {oldestRun && ` · ran ${new Date(oldestRun).toLocaleString()}`}
            </div>
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div style={{ padding: '0.5rem 1rem 1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: '0.75rem' }}>
            {reviews.map(r => <SiteReviewerCard key={r.id} review={r} />)}
          </div>
        </div>
      )}
    </Card>
  )
}

function SiteReviewerCard({ review }: { review: SitemapReview }) {
  const [open, setOpen] = useState(false)
  const score = review.score ?? 0
  const scoreColour = score >= 75 ? 'var(--color-success)'
    : score >= 60 ? 'var(--color-warning)'
    : 'var(--color-danger)'
  let strengths: string[] = []
  let gaps: string[] = []
  let risks: string[] = []
  let suggestions: ParsedSuggestion[] = []
  if (review.suggestions) {
    try {
      const parsed = JSON.parse(review.suggestions) as {
        topStrengths?: string[]
        topGaps?: string[]
        topRisks?: string[]
        suggestions?: ParsedSuggestion[]
      }
      strengths = parsed.topStrengths ?? []
      gaps = parsed.topGaps ?? []
      risks = parsed.topRisks ?? []
      suggestions = parsed.suggestions ?? []
    } catch { /* ignore */ }
  }
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-leaf-sm)', padding: '0.75rem', background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{REVIEWER_LABEL[review.reviewerKey] ?? review.reviewerKey}</div>
        <div style={{ color: scoreColour, fontSize: '0.9375rem', fontWeight: 600 }}>{score}</div>
      </div>
      {review.summary && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text)', margin: '0.375rem 0 0.5rem', lineHeight: 1.5 }}>
          {review.summary}
        </p>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: '0.6875rem', color: 'var(--color-brand)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 500 }}
      >
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <div style={{ marginTop: '0.625rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {review.critique && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.5, background: 'var(--color-bg-secondary)', padding: '0.5rem', borderRadius: '0.375rem' }}>
              {review.critique}
            </div>
          )}
          {strengths.length > 0 && <BoardroomList title="Strengths" items={strengths} tone="success" />}
          {gaps.length > 0 && <BoardroomList title="Gaps" items={gaps} tone="warning" />}
          {risks.length > 0 && <BoardroomList title="Risks" items={risks} tone="danger" />}
          {suggestions.length > 0 && (
            <div>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
                Suggestions
              </div>
              {suggestions.map((s, i) => (
                <div key={i} style={{ fontSize: '0.75rem', lineHeight: 1.5, paddingBottom: '0.375rem' }}>
                  <div style={{ fontWeight: 500 }}>{s.label}</div>
                  {s.detail && <div style={{ color: 'var(--color-text-muted)' }}>{s.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BoardroomList({ title, items, tone }: { title: string; items: string[]; tone: 'success' | 'warning' | 'danger' }) {
  const colour = tone === 'success' ? 'var(--color-success)' : tone === 'warning' ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <div>
      <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: colour, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.125rem', fontSize: '0.75rem', lineHeight: 1.5, color: 'var(--color-text)' }}>
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  )
}
