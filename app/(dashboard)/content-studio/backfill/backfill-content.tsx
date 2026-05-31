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
  AlertTriangle, CheckCircle2, RefreshCw, Loader2, Sparkles, Eye, ExternalLink,
  Settings as SettingsIcon, ChevronDown, ChevronRight,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Card } from '@/components/tahi/card'
import { Badge } from '@/components/tahi/badge'
import { KPIStrip, KPICell } from '@/components/tahi/kpi-strip'
import { EmptyState } from '@/components/tahi/empty-state'
import { useToast } from '@/components/tahi/toast'
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
}

type ContentType = 'blog' | 'glossary'

function healthScore(item: ItemAudit): { score: number; tone: 'positive' | 'warning' | 'danger' } {
  // 6 checks, weighted: schema-valid counts double because it gates AEO.
  let score = 0
  let max = 7
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
  const [settings, setSettings] = useState<BackfillSettings>({ autoBackfillEnabled: false, autoRewriteBody: false })
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

          <SectionList
            title={`Glossary terms (${glossaryItems.length})`}
            type="glossary"
            items={glossaryItems}
            expanded={expanded}
            perItemRunning={perItemRunning}
            onToggle={toggleExpand}
            onFix={(id, opts) => { void runSingleBackfill('glossary', id, opts) }}
          />
          <div style={{ height: '0.75rem' }} />
          <SectionList
            title={`Blog posts (${blogItems.length})`}
            type="blog"
            items={blogItems}
            expanded={expanded}
            perItemRunning={perItemRunning}
            onToggle={toggleExpand}
            onFix={(id, opts) => { void runSingleBackfill('blog', id, opts) }}
          />
        </Card>
      )}
    </div>
  )
}

interface SectionListProps {
  title: string
  type: ContentType
  items: ItemAudit[]
  expanded: Set<string>
  perItemRunning: string | null
  onToggle: (id: string) => void
  onFix: (id: string, opts: { rewriteBody?: boolean }) => void
}

function SectionList({ title, type, items, expanded, perItemRunning, onToggle, onFix }: SectionListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="w-5 h-5" />}
        title={`${title.split(' (')[0]}: all clean`}
        description="Every item passes the current health checks. Re-audit to re-check."
      />
    )
  }
  const baseUrl = type === 'glossary' ? 'https://www.tahi.studio/resources/glossary' : 'https://www.tahi.studio/blog'
  return (
    <div>
      <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--color-text)' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.slice(0, 50).map(item => {
          const isExpanded = expanded.has(item.id)
          const isFixing = perItemRunning === item.id
          const score = healthScore(item)
          return (
            <div
              key={item.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--color-bg)',
              }}
            >
              <button
                onClick={() => onToggle(item.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.625rem 0.875rem',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" style={{ flexShrink: 0 }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />}
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <Badge tone={score.tone}>{score.score}%</Badge>
                  {score.score < 80 && <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />}
                </div>
              </button>
              {isExpanded && (
                <div style={{ padding: '0 0.875rem 0.75rem 1.875rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
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
                        Fix + strip AI tells from body
                      </TahiButton>
                    )}
                    <a
                      href={`${baseUrl}/${item.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <Eye className="w-3 h-3" /> View live <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {items.length > 50 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'center', margin: '0.25rem 0 0' }}>
            Showing first 50 of {items.length}. Use bulk backfill to process all.
          </p>
        )}
      </div>
    </div>
  )
}
