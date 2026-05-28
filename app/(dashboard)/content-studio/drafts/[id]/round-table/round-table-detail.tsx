'use client'

/**
 * /content-studio/drafts/[id]/round-table — the round-table draft
 * detail page. Shows the full pipeline state:
 *   - Status pill + cost tracker + service banner (if any stubs)
 *   - Brief from the Strategist (intent, weights, heading outline)
 *   - Revision tabs (1, 2, 3...) — each with all 23 reviewer critiques
 *     grouped by verdict
 *   - Conflicts review section with override buttons (side-with A/B/editor)
 *   - "Advance pipeline" button (only when in non-terminal status)
 *   - Body preview (latest revision)
 *
 * Polls every 4s while the draft is in a non-terminal status.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  RefreshCw, ChevronLeft, AlertTriangle, XCircle, Play,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { apiPath } from '@/lib/api'

interface RoundTableDetailProps {
  draftId: string
}

interface DraftSnapshot {
  draft: {
    id: string
    ideaId: string
    status: string
    title: string | null
    metaTitle: string | null
    metaDescription: string | null
    bodyHtml: string | null
    bodyMarkdown: string | null
    contentScore: number | null
    coverSvgUrl: string | null
    errorMessage: string | null
    createdAt: string
    updatedAt: string
  }
  idea: {
    id: string
    title: string
    angle: string | null
    targetKeyword: string | null
    clusterId: string | null
  } | null
  brief: {
    intent?: string
    targetWordCount?: number
    primaryKeyword?: string
    angle?: string
    rationale?: string
    headings?: Array<{ level: number; text: string; wordTarget?: number }>
  } | null
  voiceWeights: Record<string, number>
  revisions: Array<{
    revisionNumber: number
    source: string
    bodyHtml: string
    bodyMarkdown: string | null
    wordCount: number | null
    reason: string | null
    createdAt: string
  }>
  reviewsByRevision: Record<string, Array<{
    reviewerKey: string
    score: number | null
    verdict: string | null
    summary: string | null
    weight: string | null
    durationMs: number | null
    critique: unknown
  }>>
  conflicts: Array<{
    id: string
    reviewerA: string
    reviewerB: string
    topic: string | null
    editorPicked: string
    editorReasoning: string | null
    liamSidedWith: string | null
    liamReasoning: string | null
    reviewedAt: string | null
    createdAt: string
  }>
  variants: unknown[]
  spendCents: number
  services: { perplexity: boolean; replicate: boolean; openai: boolean; anthropic: boolean }
}

const TERMINAL_STATUSES = new Set(['ready_for_publish', 'failed', 'cost_capped'])

export function RoundTableDetail({ draftId }: RoundTableDetailProps) {
  const router = useRouter()
  const [data, setData] = useState<DraftSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [selectedRevision, setSelectedRevision] = useState<number>(1)
  const [overrideInFlight, setOverrideInFlight] = useState<string | null>(null)

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/pipeline`))
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json() as DraftSnapshot
      setData(json)
      // Auto-select latest revision on first load
      if (json.revisions.length > 0) {
        const maxRev = Math.max(...json.revisions.map(r => r.revisionNumber))
        setSelectedRevision(prev => prev === 1 ? maxRev : prev)
      }
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [draftId])

  useEffect(() => { void fetchSnapshot() }, [fetchSnapshot])

  // Soft-poll while pipeline is running
  useEffect(() => {
    if (!data) return
    if (TERMINAL_STATUSES.has(data.draft.status)) return
    const t = setInterval(() => { void fetchSnapshot() }, 4000)
    return () => clearInterval(t)
  }, [data, fetchSnapshot])

  async function advance() {
    setAdvancing(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/advance?steps=3`), {
        method: 'POST',
      })
      if (!res.ok) throw new Error('advance failed')
      await fetchSnapshot()
    } catch {
      // surfaced via fetchSnapshot's error path
    } finally {
      setAdvancing(false)
    }
  }

  async function sideWith(conflictId: string, side: 'a' | 'b' | 'editor', reasoning: string) {
    setOverrideInFlight(conflictId)
    try {
      await fetch(apiPath(`/api/admin/content/conflicts/${conflictId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liamSidedWith: side, liamReasoning: reasoning }),
      })
      await fetchSnapshot()
    } finally {
      setOverrideInFlight(null)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem' }}>
        <div className="animate-pulse" style={{ height: '4rem', background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', marginBottom: '1rem' }} />
        <div className="animate-pulse" style={{ height: '20rem', background: 'var(--color-bg-secondary)', borderRadius: '0.5rem' }} />
      </div>
    )
  }
  if (!data) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Draft not found.</p>
        <TahiButton size="sm" onClick={() => router.push('/content-studio')}>Back to Content Studio</TahiButton>
      </div>
    )
  }

  const { draft, idea, brief, revisions, reviewsByRevision, conflicts, spendCents, services } = data
  const stubServices = Object.entries(services).filter(([, ok]) => !ok).map(([k]) => k)
  const revsAvailable = revisions.map(r => r.revisionNumber).sort((a, b) => a - b)
  const selectedReviews = reviewsByRevision[String(selectedRevision)] ?? []
  const currentRev = revisions.find(r => r.revisionNumber === selectedRevision) ?? revisions[revisions.length - 1]
  const inFlight = !TERMINAL_STATUSES.has(draft.status)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '1200px', margin: '0 auto', padding: '1rem' }}>
      <PageHeader
        title={draft.title ?? idea?.title ?? 'Untitled draft'}
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
            <Link href="/content-studio" style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
              Content Studio
            </Link>
            <span style={{ color: 'var(--color-text-subtle)' }}>·</span>
            <span>Round table</span>
          </span>
        }
      />

      {/* Status strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
        <Badge tone={statusTone(draft.status)} variant="soft" size="sm" leader="dot">
          {prettyStatus(draft.status)}
        </Badge>
        {draft.contentScore != null && (
          <Badge tone={scoreTone(draft.contentScore)} variant="soft" size="sm" leader={false}>
            Score {draft.contentScore}/100
          </Badge>
        )}
        <Badge tone="neutral" variant="soft" size="sm" leader={false}>
          ${(spendCents / 100).toFixed(2)} / $10.00 cost cap
        </Badge>
        {inFlight ? (
          <TahiButton
            size="sm"
            loading={advancing}
            onClick={() => { void advance() }}
            iconLeft={!advancing ? <Play className="w-3.5 h-3.5" /> : undefined}
          >
            {advancing ? 'Advancing...' : 'Advance pipeline (3 steps)'}
          </TahiButton>
        ) : (
          <TahiButton
            size="sm"
            variant="secondary"
            onClick={() => { void fetchSnapshot() }}
            iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </TahiButton>
        )}
        <Link href="/content-studio" style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--color-text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <ChevronLeft size={14} aria-hidden="true" /> Back
        </Link>
      </div>

      {/* Stub service banner */}
      {stubServices.length > 0 && (
        <Card padding="md" style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <AlertTriangle size={15} aria-hidden="true" style={{ color: 'var(--color-warning-text, #8A5A12)', flexShrink: 0, marginTop: '0.125rem' }} />
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              Stubbed services: <strong>{stubServices.join(', ')}</strong>.
              Set the missing API keys in Webflow env vars to switch from mocked responses to live data.
              <ul style={{ margin: '0.375rem 0 0', padding: '0 0 0 1rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {stubServices.includes('perplexity') && <li>PERPLEXITY_API_KEY (research phase)</li>}
                {stubServices.includes('replicate') && <li>REPLICATE_API_TOKEN (Flux cover generation)</li>}
                {stubServices.includes('openai') && <li>OPENAI_API_KEY (duplicate detection embeddings)</li>}
                {stubServices.includes('anthropic') && <li>ANTHROPIC_API_KEY (every drafting + reviewer call) - critical</li>}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Failure banner */}
      {draft.errorMessage && (
        <Card padding="md" style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-bg, #fef2f2)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <XCircle size={15} aria-hidden="true" style={{ color: 'var(--color-danger)', flexShrink: 0, marginTop: '0.125rem' }} />
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              <strong>{prettyStatus(draft.status)}: </strong>
              {draft.errorMessage}
            </div>
          </div>
        </Card>
      )}

      {/* Brief panel */}
      {brief && (
        <Card padding="md">
          <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.375rem' }}>
            Strategist brief
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))', gap: '0.625rem', marginBottom: '0.625rem' }}>
            {brief.intent && (
              <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                <p style={{ fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>Intent</p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0.125rem 0 0' }}>{brief.intent}</p>
              </div>
            )}
            {brief.targetWordCount != null && (
              <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                <p style={{ fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>Target words</p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0.125rem 0 0' }}>{brief.targetWordCount.toLocaleString()}</p>
              </div>
            )}
            {brief.primaryKeyword && (
              <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                <p style={{ fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>Keyword</p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0.125rem 0 0', fontFamily: 'var(--font-mono, monospace)' }}>{brief.primaryKeyword}</p>
              </div>
            )}
          </div>
          {brief.angle && (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text)', margin: 0, fontStyle: 'italic' }}>
              <strong>Angle:</strong> {brief.angle}
            </p>
          )}
          {brief.rationale && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0', lineHeight: 1.5 }}>
              {brief.rationale}
            </p>
          )}
        </Card>
      )}

      {/* Revision tabs */}
      {revsAvailable.length > 0 && (
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          {revsAvailable.map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setSelectedRevision(n)}
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                borderRadius: '0.375rem',
                border: '1px solid var(--color-border)',
                background: n === selectedRevision ? 'var(--color-brand-100)' : 'var(--color-bg)',
                color: n === selectedRevision ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              Revision {n}
            </button>
          ))}
        </div>
      )}

      {/* Reviews grid */}
      {selectedReviews.length > 0 && (
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>
              Reviewer panel — revision {selectedRevision}
            </p>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              {selectedReviews.length} reviewers · {selectedReviews.filter(r => r.verdict === 'pass').length} pass
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))', gap: '0.625rem' }}>
            {selectedReviews.map(r => (
              <div
                key={r.reviewerKey}
                style={{
                  background: 'var(--color-bg-secondary)',
                  borderRadius: '0.5rem',
                  padding: '0.625rem 0.75rem',
                  borderLeft: `3px solid ${verdictColor(r.verdict)}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {prettyReviewer(r.reviewerKey)}
                  </span>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    {r.score != null && (
                      <Badge tone={scoreTone(r.score)} variant="soft" size="sm" leader={false}>
                        {r.score}
                      </Badge>
                    )}
                    {r.weight && parseFloat(r.weight) !== 1 && (
                      <Badge tone="neutral" variant="soft" size="sm" leader={false}>
                        ×{parseFloat(r.weight).toFixed(1)}
                      </Badge>
                    )}
                  </div>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.45 }}>
                  {r.summary ?? '(no summary)'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <Card padding="md">
          <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.5rem' }}>
            Editor conflicts ({conflicts.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {conflicts.map(c => (
              <ConflictRow
                key={c.id}
                conflict={c}
                inFlight={overrideInFlight === c.id}
                onSide={(side, reasoning) => sideWith(c.id, side, reasoning)}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Body preview */}
      {currentRev && currentRev.bodyHtml && (
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>
              Body — revision {currentRev.revisionNumber}
            </p>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              {currentRev.wordCount?.toLocaleString() ?? '?'} words · {currentRev.source}
            </span>
          </div>
          {currentRev.reason && (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0 0 0.625rem', fontStyle: 'italic' }}>
              {currentRev.reason}
            </p>
          )}
          <div
            className="prose prose-sm"
            style={{
              fontSize: '0.875rem',
              lineHeight: 1.6,
              color: 'var(--color-text)',
              maxHeight: '40rem',
              overflowY: 'auto',
              padding: '0.75rem',
              background: 'var(--color-bg)',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border-subtle)',
            }}
            dangerouslySetInnerHTML={{ __html: currentRev.bodyHtml }}
          />
        </Card>
      )}
    </div>
  )
}

interface ConflictRowProps {
  conflict: DraftSnapshot['conflicts'][number]
  inFlight: boolean
  onSide: (side: 'a' | 'b' | 'editor', reasoning: string) => void
}

function ConflictRow({ conflict, inFlight, onSide }: ConflictRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [reasoning, setReasoning] = useState('')
  const alreadyReviewed = conflict.liamSidedWith != null

  return (
    <div
      style={{
        background: 'var(--color-bg-secondary)',
        borderRadius: '0.5rem',
        padding: '0.625rem 0.75rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          <strong>{prettyReviewer(conflict.reviewerA)}</strong> vs <strong>{prettyReviewer(conflict.reviewerB)}</strong>
          {conflict.topic && <span style={{ color: 'var(--color-text-subtle)' }}> · {conflict.topic}</span>}
        </span>
        <Badge tone={alreadyReviewed ? 'positive' : 'neutral'} variant="soft" size="sm" leader={false}>
          Editor: {conflict.editorPicked}
        </Badge>
      </div>
      {conflict.editorReasoning && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0', lineHeight: 1.45 }}>
          {conflict.editorReasoning}
        </p>
      )}
      {alreadyReviewed && conflict.liamReasoning && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-brand-dark)', margin: '0.25rem 0 0', lineHeight: 1.45 }}>
          <strong>You sided with {conflict.liamSidedWith}:</strong> {conflict.liamReasoning}
        </p>
      )}
      {!alreadyReviewed && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              fontSize: '0.75rem',
              color: 'var(--color-brand-dark)',
              background: 'transparent',
              border: 'none',
              padding: '0.25rem 0',
              cursor: 'pointer',
              marginTop: '0.25rem',
            }}
          >
            {expanded ? 'Cancel' : 'Side with...'}
          </button>
          {expanded && (
            <div style={{ marginTop: '0.375rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <textarea
                rows={2}
                value={reasoning}
                onChange={e => setReasoning(e.target.value)}
                placeholder="Why? (optional but useful for calibration)"
                style={{
                  width: '100%', padding: '0.375rem 0.5rem',
                  fontSize: '0.75rem', borderRadius: '0.375rem',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <TahiButton size="sm" variant="secondary" onClick={() => onSide('a', reasoning)} disabled={inFlight}>
                  Side: {prettyReviewer(conflict.reviewerA)}
                </TahiButton>
                <TahiButton size="sm" variant="secondary" onClick={() => onSide('b', reasoning)} disabled={inFlight}>
                  Side: {prettyReviewer(conflict.reviewerB)}
                </TahiButton>
                <TahiButton size="sm" onClick={() => onSide('editor', reasoning)} disabled={inFlight}>
                  Editor was right
                </TahiButton>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusTone(status: string): BadgeTone {
  if (status === 'ready_for_publish' || status === 'ready') return 'positive'
  if (status === 'failed' || status === 'cost_capped') return 'danger'
  return 'info'
}

function prettyStatus(status: string): string {
  const map: Record<string, string> = {
    queued: 'Queued',
    researching: 'Researching',
    strategising: 'Strategising',
    headline_lab: 'Headline lab',
    drafting: 'Drafting',
    reviewing: 'Reviewing (23 reviewers)',
    editing: 'Editing',
    signing_off: 'Sign-off',
    covering: 'Generating cover',
    ready_for_publish: 'Ready for publish',
    ready: 'Ready',
    failed: 'Failed',
    cost_capped: 'Cost cap reached',
  }
  return map[status] ?? status
}

function scoreTone(score: number): BadgeTone {
  if (score >= 85) return 'positive'
  if (score >= 70) return 'info'
  if (score >= 50) return 'warning'
  return 'danger'
}

function verdictColor(verdict: string | null): string {
  switch (verdict) {
    case 'pass': return 'var(--color-success, #4ade80)'
    case 'soft_fail': return 'var(--color-warning, #fb923c)'
    case 'hard_fail': return 'var(--color-danger, #f87171)'
    default: return 'var(--color-text-subtle)'
  }
}

function prettyReviewer(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
