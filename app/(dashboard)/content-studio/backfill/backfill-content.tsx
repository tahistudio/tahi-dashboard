'use client'

/**
 * Backfill tab — surfaces every blog post + glossary term in Webflow
 * with the schema/FAQ/author/date coverage we have so Liam can:
 *   - See at a glance how much needs fixing
 *   - Trigger a per-item refresh (schema-only, or full + body rewrite)
 *   - Run a bulk backfill across one or both content types
 *   - Toggle auto-backfill so the weekly cron does it without a click
 *
 * Reads /api/admin/content/coverage-audit for the scoreboard, calls
 * /api/admin/content/glossary/[id]/backfill + /posts/[id]/backfill
 * for single fixes, /api/admin/content/bulk-backfill for the orchestrator.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2, RefreshCw, Loader2, Sparkles, Eye, ExternalLink,
  Settings as SettingsIcon,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Card } from '@/components/tahi/card'
import { Badge } from '@/components/tahi/badge'
import { KPIStrip, KPICell } from '@/components/tahi/kpi-strip'
import { EmptyState } from '@/components/tahi/empty-state'
import { useToast } from '@/components/tahi/toast'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { apiPath } from '@/lib/api'

interface ItemAudit {
  id: string
  slug: string
  name: string
  hasSchema: boolean
  schemaValid: boolean | null
  schemaErrors: number
  hasFaqSchema: boolean
  hasAuthor: boolean
  hasDateModified: boolean
  hasRelatedRefs: boolean
  hasCategory: boolean
  emDashes: number
  bannedWords: number
}

interface TypeAudit {
  total: number
  withSchema: number
  schemaValid: number
  withFaq: number
  withAuthor: number
  withDateModified: number
  withRelatedRefs: number
  withCategory: number
  totalEmDashes: number
  totalBannedWords: number
  items: ItemAudit[]
}

interface CoverageResponse {
  blog?: TypeAudit
  glossary?: TypeAudit
  durationMs: number
}

interface BackfillSettings {
  autoBackfillEnabled: boolean
  autoRewriteBody: boolean
  glossaryDefaultTier: 'schema' | 'audit' | 'full'
  glossaryAutoPublish: boolean
}

interface GeneratedEntry {
  term: string
  alsoKnownAs: string[]
  definition: string
  bodyMarkdown: string
  faqs: Array<{ question: string; answer: string }>
  examples: string[]
  commonMistakes: string[]
  citations: Array<{ url: string; title?: string }>
  relatedTerms: string[]
  metaTitle: string
  metaDescription: string
  authorSlug: 'liam' | 'staci'
  category: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  totalCostCents: number
  stages: Array<{ name: string; costCents: number; notes?: string }>
}

interface AuditResult {
  term?: string
  definitionClarity: number
  snippetReadiness: number
  citationRigor: number
  structureCompleteness: number
  aeoCitability: number
  overall: number
  improvements: string[]
  costCents: number
}

type ContentType = 'blog' | 'glossary'

function healthScore(item: ItemAudit): { score: number; tone: 'positive' | 'warning' | 'danger' } {
  // 6 checks, weighted: schema-valid counts double because it gates AEO.
  let score = 0
  const max = 7
  if (item.hasSchema && item.schemaValid === true) score += 2
  if (item.hasFaqSchema) score += 1
  if (item.hasAuthor) score += 1
  if (item.hasDateModified) score += 1
  if (item.hasRelatedRefs) score += 1
  if (item.hasCategory) score += 1
  const pct = Math.round((score / max) * 100)
  const tone: 'positive' | 'warning' | 'danger' = pct >= 80 ? 'positive' : pct >= 50 ? 'warning' : 'danger'
  return { score: pct, tone }
}

function MissingPills({ item }: { item: ItemAudit }) {
  const missing: string[] = []
  if (!item.hasSchema) missing.push('schema')
  else if (item.schemaValid === false) missing.push(`schema (${item.schemaErrors} errors)`)
  if (!item.hasFaqSchema) missing.push('FAQ markup')
  if (!item.hasAuthor) missing.push('author')
  if (!item.hasDateModified) missing.push('updated date')
  if (!item.hasRelatedRefs) missing.push('related refs')
  if (!item.hasCategory) missing.push('category')
  if (item.emDashes > 0) missing.push(`${item.emDashes} em-dashes`)
  if (item.bannedWords > 0) missing.push(`${item.bannedWords} banned words`)
  if (missing.length === 0) {
    return <Badge tone="positive">Healthy</Badge>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
      {missing.slice(0, 5).map(m => (
        <Badge key={m} tone="warning">{m}</Badge>
      ))}
      {missing.length > 5 && <Badge tone="neutral">+{missing.length - 5} more</Badge>}
    </div>
  )
}

export function BackfillContent() {
  const { showToast } = useToast()
  const [data, setData] = useState<CoverageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [bulkRunning, setBulkRunning] = useState<ContentType | 'all' | null>(null)
  const [bulkProgress, setBulkProgress] = useState<{ processed: number; total: number } | null>(null)
  const [perItemRunning, setPerItemRunning] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<BackfillSettings>({ autoBackfillEnabled: false, autoRewriteBody: false, glossaryDefaultTier: 'schema', glossaryAutoPublish: false })
  const [newTermInput, setNewTermInput] = useState('')
  const [newTermAuthor, setNewTermAuthor] = useState<'liam' | 'staci' | 'auto'>('auto')
  const [newTermResearch, setNewTermResearch] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatedPreview, setGeneratedPreview] = useState<GeneratedEntry | null>(null)
  const [auditModalFor, setAuditModalFor] = useState<string | null>(null)
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null)
  const [auditing, setAuditing] = useState(false)
  const [rewriteBodyOnBulk, setRewriteBodyOnBulk] = useState(false)
  const [filterType, setFilterType] = useState<'all' | 'broken' | 'no-schema'>('broken')

  const fetchAudit = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/coverage-audit?type=all&limit=500'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as CoverageResponse
      setData(json)
    } catch (err) {
      showToast(`Audit failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/admin/content/backfill-settings'))
      if (!res.ok) return
      const json = await res.json() as BackfillSettings
      setSettings(json)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { void fetchAudit(); void fetchSettings() }, [fetchAudit, fetchSettings])

  async function runSingleBackfill(type: ContentType, itemId: string, opts: { rewriteBody?: boolean } = {}) {
    setPerItemRunning(itemId)
    try {
      const path = type === 'glossary'
        ? `/api/admin/content/glossary/${itemId}/backfill`
        : `/api/admin/content/posts/${itemId}/backfill`
      const res = await fetch(apiPath(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, rewriteBody: !!opts.rewriteBody }),
      })
      const json = await res.json() as { patched?: boolean; error?: string; schemaErrorsAfter?: number; schemaErrorsBefore?: number; patchedFields?: string[] }
      if (!res.ok) {
        showToast(`Failed: ${json.error ?? 'unknown'}`, 'error')
      } else {
        const fixed = (json.schemaErrorsBefore ?? 0) - (json.schemaErrorsAfter ?? 0)
        showToast(`Patched ${json.patchedFields?.length ?? 0} fields${fixed > 0 ? ` (fixed ${fixed} schema errors)` : ''}`)
        await fetchAudit()
      }
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setPerItemRunning(null)
    }
  }

  async function runBulkBackfill(type: ContentType | 'all') {
    setBulkRunning(type)
    const totalEstimate = (type === 'blog' ? (data?.blog?.total ?? 0) : 0)
      + (type === 'glossary' ? (data?.glossary?.total ?? 0) : 0)
      + (type === 'all' ? (data?.blog?.total ?? 0) + (data?.glossary?.total ?? 0) : 0)
    setBulkProgress({ processed: 0, total: totalEstimate })
    type Cursor = { type: 'blog' | 'glossary'; offset: number } | null
    let cursor: Cursor = null
    let totalProcessed = 0
    try {
      while (true) {
        const res = await fetch(apiPath('/api/admin/content/bulk-backfill'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, dryRun: false, rewriteBody: rewriteBodyOnBulk, cursor }),
        })
        if (!res.ok) {
          showToast(`Bulk run failed (HTTP ${res.status})`, 'error')
          break
        }
        const json = await res.json() as { processed: number; patched: number; errors: number; cursor: Cursor }
        totalProcessed += json.processed
        setBulkProgress({ processed: totalProcessed, total: totalEstimate })
        if (!json.cursor) {
          showToast(`Backfill complete: ${totalProcessed} processed`)
          break
        }
        cursor = json.cursor
      }
      await fetchAudit()
    } catch (err) {
      showToast(`Bulk run failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBulkRunning(null)
      setBulkProgress(null)
    }
  }

  async function generateNewTerm() {
    if (!newTermInput.trim()) return
    setGenerating(true)
    setGeneratedPreview(null)
    try {
      const res = await fetch(apiPath('/api/admin/content/glossary/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: newTermInput.trim(),
          authorSlug: newTermAuthor === 'auto' ? undefined : newTermAuthor,
          research: newTermResearch,
        }),
      })
      const json = await res.json() as GeneratedEntry & { error?: string }
      if (!res.ok) {
        showToast(`Generation failed: ${json.error ?? 'unknown'}`, 'error')
        return
      }
      setGeneratedPreview(json)
      showToast(`Generated "${json.term}" — $${(json.totalCostCents / 100).toFixed(2)} spent. Review below + publish.`)
    } catch (err) {
      showToast(`Generation failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function publishGenerated(existingItemId?: string) {
    if (!generatedPreview) return
    try {
      const res = await fetch(apiPath('/api/admin/content/glossary/publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...generatedPreview, existingItemId }),
      })
      const json = await res.json() as { ok?: boolean; mode?: string; itemId?: string; url?: string; error?: string; skippedFields?: string[] }
      if (!res.ok) {
        showToast(`Publish failed: ${json.error ?? 'unknown'}`, 'error')
        return
      }
      const skipped = json.skippedFields?.length ?? 0
      showToast(
        `${json.mode === 'created' ? 'Created in Webflow' : 'Updated Webflow item'}: ${json.url ?? json.itemId}${skipped > 0 ? ` (${skipped} fields skipped — add to collection)` : ''}`,
      )
      setGeneratedPreview(null)
      setNewTermInput('')
      await fetchAudit()
    } catch (err) {
      showToast(`Publish failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    }
  }

  async function runAudit(itemId: string) {
    setAuditing(true)
    setAuditModalFor(itemId)
    setAuditResult(null)
    try {
      const res = await fetch(apiPath(`/api/admin/content/glossary/${itemId}/audit`), { method: 'POST' })
      const json = await res.json() as AuditResult & { error?: string }
      if (!res.ok) {
        showToast(`Audit failed: ${json.error ?? 'unknown'}`, 'error')
        setAuditModalFor(null)
        return
      }
      setAuditResult(json)
    } catch (err) {
      showToast(`Audit failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
      setAuditModalFor(null)
    } finally {
      setAuditing(false)
    }
  }

  async function upgradeTerm(itemId: string, itemName: string) {
    if (!confirm(`Run full Tier 3 rewrite on "${itemName}"? Cost ~$0.30. This will REPLACE the body content.`)) return
    setGenerating(true)
    try {
      // 1. Generate fresh content
      const genRes = await fetch(apiPath('/api/admin/content/glossary/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: itemName, research: true }),
      })
      const genJson = await genRes.json() as GeneratedEntry & { error?: string }
      if (!genRes.ok) {
        showToast(`Generation failed: ${genJson.error ?? 'unknown'}`, 'error')
        return
      }
      // 2. Patch into existing item
      const pubRes = await fetch(apiPath('/api/admin/content/glossary/publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...genJson, existingItemId: itemId }),
      })
      const pubJson = await pubRes.json() as { ok?: boolean; error?: string; patchedFields?: string[]; skippedFields?: string[] }
      if (!pubRes.ok) {
        showToast(`Publish failed: ${pubJson.error ?? 'unknown'}`, 'error')
        return
      }
      showToast(`Upgraded "${itemName}" — $${(genJson.totalCostCents / 100).toFixed(2)} · ${pubJson.patchedFields?.length ?? 0} fields patched`)
      await fetchAudit()
    } catch (err) {
      showToast(`Upgrade failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function saveSettings(next: BackfillSettings) {
    setSettings(next)
    try {
      await fetch(apiPath('/api/admin/content/backfill-settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      showToast('Settings saved')
    } catch (err) {
      showToast(`Save failed: ${err instanceof Error ? err.message : 'error'}`, 'error')
    }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function filterItems(items: ItemAudit[]): ItemAudit[] {
    if (filterType === 'all') return items
    if (filterType === 'no-schema') return items.filter(i => !i.hasSchema || i.schemaValid === false)
    return items.filter(i => healthScore(i).score < 80)
  }

  const blogItems = data?.blog ? filterItems(data.blog.items) : []
  const glossaryItems = data?.glossary ? filterItems(data.glossary.items) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Scoreboard */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Coverage scoreboard</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
              Schema, FAQ markup, author, date-modified, related refs, category coverage across all Webflow content.
            </p>
          </div>
          <TahiButton size="sm" variant="secondary" loading={loading} onClick={() => { void fetchAudit() }} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
            Re-audit
          </TahiButton>
        </div>

        {loading && !data && (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ display: 'inline-block', color: 'var(--color-text-muted)' }} />
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0' }}>Walking your Webflow CMS...</p>
          </div>
        )}

        {data && (
          <>
            <KPIStrip>
              <KPICell
                label="Blog posts"
                value={String(data.blog?.total ?? 0)}
                sub={`${data.blog?.schemaValid ?? 0} schema-valid · ${(data.blog?.total ?? 0) - (data.blog?.schemaValid ?? 0)} need fixing`}
              />
              <KPICell
                label="Glossary terms"
                value={String(data.glossary?.total ?? 0)}
                sub={`${data.glossary?.schemaValid ?? 0} schema-valid · ${(data.glossary?.total ?? 0) - (data.glossary?.schemaValid ?? 0)} need fixing`}
              />
              <KPICell
                label="FAQ markup coverage"
                value={`${(data.blog?.withFaq ?? 0) + (data.glossary?.withFaq ?? 0)}`}
                sub={`of ${(data.blog?.total ?? 0) + (data.glossary?.total ?? 0)} total`}
              />
              <KPICell
                label="AI-tells in bodies"
                value={String((data.blog?.totalEmDashes ?? 0) + (data.glossary?.totalEmDashes ?? 0))}
                sub={`em-dashes + ${(data.blog?.totalBannedWords ?? 0) + (data.glossary?.totalBannedWords ?? 0)} banned words`}
              />
            </KPIStrip>
          </>
        )}
      </Card>

      {/* Bulk + auto controls */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Bulk backfill</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
              Patches schema + date-modified across every item. Body rewrites are opt-in.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              <input
                type="checkbox"
                checked={rewriteBodyOnBulk}
                onChange={e => setRewriteBodyOnBulk(e.target.checked)}
              />
              Also rewrite bodies (strip AI tells)
            </label>
            <TahiButton size="sm" loading={bulkRunning === 'glossary'} disabled={!!bulkRunning} onClick={() => { void runBulkBackfill('glossary') }}>
              Run on glossary
            </TahiButton>
            <TahiButton size="sm" loading={bulkRunning === 'blog'} disabled={!!bulkRunning} onClick={() => { void runBulkBackfill('blog') }}>
              Run on blog
            </TahiButton>
            <TahiButton size="sm" variant="secondary" loading={bulkRunning === 'all'} disabled={!!bulkRunning} onClick={() => { void runBulkBackfill('all') }}>
              Run on everything
            </TahiButton>
          </div>
        </div>
        {bulkProgress && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
              <span>{bulkProgress.processed} of {bulkProgress.total} processed</span>
              <span>{Math.round((bulkProgress.processed / Math.max(1, bulkProgress.total)) * 100)}%</span>
            </div>
            <div style={{ background: 'var(--color-border-subtle)', height: '0.375rem', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{
                background: 'var(--color-brand)',
                height: '100%',
                width: `${Math.min(100, Math.round((bulkProgress.processed / Math.max(1, bulkProgress.total)) * 100))}%`,
                transition: 'width 200ms',
              }} />
            </div>
          </div>
        )}
      </Card>

      {/* Add new glossary term (Tier 3) */}
      <Card>
        <div style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Add a new glossary term</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0, maxWidth: '70ch' }}>
            Tier 3 pipeline: Perplexity research → Sonnet writer → 5-Haiku reviewer panel → Sonnet editor (only when needed). ~$0.30 per term. Returns a preview for review before publishing to Webflow.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
          <input
            type="text"
            placeholder='Term name e.g. "Schema markup"'
            value={newTermInput}
            onChange={e => setNewTermInput(e.target.value)}
            disabled={generating}
            style={{
              flex: 1,
              minWidth: '14rem',
              fontSize: '0.875rem',
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
          />
          <select
            value={newTermAuthor}
            onChange={e => setNewTermAuthor(e.target.value as 'liam' | 'staci' | 'auto')}
            disabled={generating}
            style={{ fontSize: '0.8125rem', padding: '0.5rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '0.5rem', background: 'var(--color-bg)' }}
          >
            <option value="auto">Author: Auto</option>
            <option value="liam">Author: Liam</option>
            <option value="staci">Author: Staci</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
            <input
              type="checkbox"
              checked={newTermResearch}
              onChange={e => setNewTermResearch(e.target.checked)}
              disabled={generating}
            />
            Perplexity research
          </label>
          <TahiButton size="sm" loading={generating} disabled={!newTermInput.trim() || generating} onClick={() => { void generateNewTerm() }} iconLeft={<Sparkles className="w-3.5 h-3.5" />}>
            Generate
          </TahiButton>
        </div>
        {generatedPreview && (
          <div style={{ marginTop: '0.875rem', padding: '0.875rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-leaf-sm)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: '0.9375rem' }}>{generatedPreview.term}</strong>
                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {generatedPreview.category} · {generatedPreview.difficulty} · author: {generatedPreview.authorSlug}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                ${(generatedPreview.totalCostCents / 100).toFixed(2)} · {generatedPreview.stages.length} stages · {generatedPreview.faqs.length} FAQs · {generatedPreview.citations.length} citations
              </div>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0 0 0.625rem' }}>
              <strong>Definition:</strong> {generatedPreview.definition}
            </p>
            <details style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.625rem' }}>
              <summary style={{ cursor: 'pointer' }}>Body preview ({generatedPreview.bodyMarkdown.split(/\s+/).length} words)</summary>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '20rem', overflow: 'auto', padding: '0.5rem', background: 'var(--color-bg)', borderRadius: '0.25rem', marginTop: '0.375rem' }}>
                {generatedPreview.bodyMarkdown}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <TahiButton size="sm" onClick={() => { void publishGenerated() }}>
                Publish to Webflow (as draft)
              </TahiButton>
              <TahiButton size="sm" variant="secondary" onClick={() => setGeneratedPreview(null)}>
                Discard
              </TahiButton>
            </div>
          </div>
        )}
      </Card>

      {/* Auto-backfill toggle */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
            <SettingsIcon className="w-4 h-4" style={{ color: 'var(--color-text-muted)', marginTop: '0.125rem' }} />
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Auto-backfill</h2>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0, maxWidth: '60ch' }}>
                Weekly cron that scans for items with missing or invalid schema and patches them. Body rewrites still need explicit opt-in below — schema patches are non-destructive.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
              <input
                type="checkbox"
                checked={settings.autoBackfillEnabled}
                onChange={e => saveSettings({ ...settings, autoBackfillEnabled: e.target.checked })}
              />
              Run weekly
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
              <input
                type="checkbox"
                disabled={!settings.autoBackfillEnabled}
                checked={settings.autoRewriteBody}
                onChange={e => saveSettings({ ...settings, autoRewriteBody: e.target.checked })}
              />
              Also auto-rewrite bodies
            </label>
          </div>
        </div>
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Glossary default tier</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, maxWidth: '60ch' }}>
                Schema-only ($0) for safe patches. Audit (~$0.01) adds a scorecard. Full rewrite (~$0.30) regenerates content via Tier 3 pipeline on items scoring under 60.
              </p>
            </div>
            <select
              value={settings.glossaryDefaultTier}
              onChange={e => saveSettings({ ...settings, glossaryDefaultTier: e.target.value as 'schema' | 'audit' | 'full' })}
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.625rem', border: '1px solid var(--color-border)', borderRadius: '0.5rem', background: 'var(--color-bg)' }}
            >
              <option value="schema">Schema only</option>
              <option value="audit">Schema + audit</option>
              <option value="full">Schema + audit + auto-rewrite low scorers</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Per-item lists */}
      {data && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Items needing attention</h2>
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              {(['broken', 'no-schema', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterType(f)}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.25rem 0.625rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: '999px',
                    cursor: 'pointer',
                    background: filterType === f ? 'var(--color-brand)' : 'var(--color-bg)',
                    color: filterType === f ? '#fff' : 'var(--color-text)',
                  }}
                >
                  {f === 'broken' ? 'Needs work' : f === 'no-schema' ? 'No / invalid schema' : 'All'}
                </button>
              ))}
            </div>
          </div>

          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0.5rem 0', color: 'var(--color-text)' }}>
            Glossary terms ({glossaryItems.length})
          </h3>
          <BackfillItemTable
            type="glossary"
            items={glossaryItems}
            perItemRunning={perItemRunning}
            onFix={(id, opts) => { void runSingleBackfill('glossary', id, opts) }}
            onAudit={(id) => { void runAudit(id) }}
            onUpgrade={(id, name) => { void upgradeTerm(id, name) }}
          />
          <div style={{ height: '1.25rem' }} />
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0.5rem 0', color: 'var(--color-text)' }}>
            Blog posts ({blogItems.length})
          </h3>
          <BackfillItemTable
            type="blog"
            items={blogItems}
            perItemRunning={perItemRunning}
            onFix={(id, opts) => { void runSingleBackfill('blog', id, opts) }}
          />
        </Card>
      )}

      {/* Audit modal */}
      {auditModalFor && (
        <div
          onClick={() => { setAuditModalFor(null); setAuditResult(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--color-bg)', borderRadius: 'var(--radius-leaf-sm)',
              padding: '1.5rem', maxWidth: '40rem', width: '100%', maxHeight: '85vh', overflow: 'auto',
              border: '1px solid var(--color-border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
                Audit: {auditResult?.term ?? '...'}
              </h2>
              <button onClick={() => { setAuditModalFor(null); setAuditResult(null) }} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--color-text-muted)' }}>×</button>
            </div>
            {auditing && (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <Loader2 className="w-5 h-5 animate-spin" style={{ display: 'inline-block', color: 'var(--color-text-muted)' }} />
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0' }}>Auditing with Haiku...</p>
              </div>
            )}
            {auditResult && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '2rem', fontWeight: 600, color: auditResult.overall >= 75 ? 'var(--color-success)' : auditResult.overall >= 50 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                    {auditResult.overall}
                  </span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>overall · ${(auditResult.costCents / 100).toFixed(3)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                  {[
                    { k: 'Definition clarity', v: auditResult.definitionClarity },
                    { k: 'Snippet readiness', v: auditResult.snippetReadiness },
                    { k: 'Citation rigor', v: auditResult.citationRigor },
                    { k: 'Structure', v: auditResult.structureCompleteness },
                    { k: 'AEO citability', v: auditResult.aeoCitability },
                  ].map(d => (
                    <div key={d.k} style={{ padding: '0.625rem', border: '1px solid var(--color-border-subtle)', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>{d.k}</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 600, color: d.v >= 75 ? 'var(--color-success)' : d.v >= 50 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                        {d.v}
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Recommended improvements</h3>
                  <ul style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: 0, paddingLeft: '1.25rem' }}>
                    {auditResult.improvements.map((imp, i) => (
                      <li key={i} style={{ marginBottom: '0.375rem' }}>{imp}</li>
                    ))}
                  </ul>
                </div>
                <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Want to apply these automatically? Run a Tier 3 rewrite (~$0.30) from the per-item list.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface BackfillItemTableProps {
  type: ContentType
  items: ItemAudit[]
  perItemRunning: string | null
  onFix: (id: string, opts: { rewriteBody?: boolean }) => void
  onAudit?: (id: string) => void
  onUpgrade?: (id: string, name: string) => void
}

function BackfillItemTable({ type, items, perItemRunning, onFix, onAudit, onUpgrade }: BackfillItemTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="w-5 h-5" />}
        title={`${type === 'glossary' ? 'Glossary' : 'Blog'} — all clean`}
        description="Every item passes the current health checks. Re-audit to re-check."
      />
    )
  }
  const baseUrl = type === 'glossary' ? 'https://www.tahi.studio/resources/glossary' : 'https://www.tahi.studio/blog'

  const columns: DataTableColumn<ItemAudit>[] = [
    {
      key: 'name',
      header: 'Item',
      sortable: true,
      sortValue: (r: ItemAudit) => r.name.toLowerCase(),
      render: (r: ItemAudit) =><span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', fontWeight: 500 }}>{r.name}</span>,
    },
    {
      key: 'score',
      header: 'Health',
      sortable: true,
      sortValue: (r: ItemAudit) => healthScore(r).score,
      render: (r: ItemAudit) => {
        const s = healthScore(r)
        return <Badge tone={s.tone}>{s.score}%</Badge>
      },
      width: '6rem',
    },
    {
      key: 'schema',
      header: 'Schema',
      render: (r: ItemAudit) => r.hasSchema && r.schemaValid
        ? <Badge tone="positive">OK</Badge>
        : r.hasSchema
          ? <Badge tone="danger">{r.schemaErrors} errors</Badge>
          : <Badge tone="warning">Missing</Badge>,
      width: '7rem',
    },
    {
      key: 'issues',
      header: 'Missing',
      render: (r: ItemAudit) => {
        const missing: string[] = []
        if (!r.hasFaqSchema) missing.push('FAQ')
        if (!r.hasAuthor) missing.push('author')
        if (!r.hasDateModified) missing.push('updated')
        if (!r.hasRelatedRefs) missing.push('related')
        if (!r.hasCategory) missing.push('category')
        if (r.emDashes > 0) missing.push(`${r.emDashes}em-dashes`)
        if (r.bannedWords > 0) missing.push(`${r.bannedWords}banned`)
        if (missing.length === 0) return <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>—</span>
        return (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {missing.slice(0, 3).join(' · ')}{missing.length > 3 ? ` +${missing.length - 3}` : ''}
          </span>
        )
      },
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={items}
      getRowId={r => r.id}
      defaultPageSize={20}
      paginate
      density="compact"
      ariaLabel={`${type} backfill items`}
      defaultSort={{ key: 'score', dir: 'asc' }}
      renderExpand={item => {
        const isFixing = perItemRunning === item.id
        return (
          <div style={{ padding: '0.625rem 0', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <MissingPills item={item} />
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <TahiButton
                size="sm"
                loading={isFixing}
                onClick={() => onFix(item.id, {})}
                iconLeft={<Sparkles className="w-3.5 h-3.5" />}
              >
                Fix schema
              </TahiButton>
              {item.emDashes + item.bannedWords > 0 && (
                <TahiButton
                  size="sm"
                  variant="secondary"
                  loading={isFixing}
                  onClick={() => onFix(item.id, { rewriteBody: true })}
                >
                  Fix + strip AI tells
                </TahiButton>
              )}
              {type === 'glossary' && onAudit && (
                <TahiButton size="sm" variant="secondary" onClick={() => onAudit(item.id)}>
                  Audit (~$0.01)
                </TahiButton>
              )}
              {type === 'glossary' && onUpgrade && (
                <TahiButton size="sm" variant="secondary" onClick={() => onUpgrade(item.id, item.name)}>
                  Tier 3 rewrite (~$0.30)
                </TahiButton>
              )}
              <a
                href={`${baseUrl}/${item.slug}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginLeft: 'auto' }}
              >
                <Eye className="w-3 h-3" /> View live <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )
      }}
    />
  )
}

