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
  RefreshCw, ChevronLeft, AlertTriangle, XCircle, CheckCircle2, Play, Pause, FileText, ListChecks, RotateCcw, Sparkles,
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
    pausedFromStatus: string | null
    title: string | null
    metaTitle: string | null
    metaDescription: string | null
    bodyHtml: string | null
    bodyMarkdown: string | null
    keyTakeaways: string | null
    faqsJson: string | null
    contentScore: number | null
    coverSvgUrl: string | null
    errorMessage: string | null
    stageLockedAt: string | null
    originSource: string | null
    auditTargetWebflowId: string | null
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
    secondaryKeywords?: string[]
    angle?: string
    rationale?: string
    author?: 'liam' | 'staci'
    contentBucket?: 'generic' | 'novel' | 'data'
    workingTitle?: string
    headings?: Array<{ level: number; text: string; wordTarget?: number; mustCover?: string[] }>
  } | null
  voiceWeights: Record<string, number>
  linkCheck: {
    total: number
    okCount: number
    deadCount: number
    dead: Array<{ url: string; status: number | null; reason: string }>
    checkedAt: string
  } | null
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

// 'awaiting_brief_approval' is a human gate — listed here so the
// auto-tick stops and waits for the Approve / Reject buttons.
// 'audited' is the terminal status for legacy audit shadow drafts.
const TERMINAL_STATUSES = new Set(['ready_for_publish', 'failed', 'cost_capped', 'paused', 'awaiting_brief_approval', 'audited'])

export function RoundTableDetail({ draftId }: RoundTableDetailProps) {
  const router = useRouter()
  const [data, setData] = useState<DraftSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [forceApproving, setForceApproving] = useState(false)
  const [improving, setImproving] = useState(false)
  const [copiedFormat, setCopiedFormat] = useState<'markdown' | 'html' | null>(null)
  const [approvingBrief, setApprovingBrief] = useState(false)
  const [rejectingBrief, setRejectingBrief] = useState(false)
  const [rejectFeedback, setRejectFeedback] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [selectedRevision, setSelectedRevision] = useState<number>(1)
  const [overrideInFlight, setOverrideInFlight] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editInstructions, setEditInstructions] = useState('')
  const [editing, setEditing] = useState(false)
  const [editResult, setEditResult] = useState<{ changeLog: string[]; skipped: Array<{ instruction: string; reason: string }> } | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [coverUrlInput, setCoverUrlInput] = useState('')

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

  // Auto-tick: only fire the next advance when the PRIOR stage is
  // genuinely done. The server encodes that two ways:
  //   1. status — non-terminal, non-paused (next stage hasn't run yet)
  //   2. stageLockedAt — null or > 90s old (matches the server's lock TTL;
  //      a fresh lock means runStage is mid-flight in another tab/cron)
  // We also skip when errorMessage is set — that needs human triage, not
  // a hot-loop retry. `paused` is in TERMINAL_STATUSES so the pause button
  // stops the loop cleanly.
  useEffect(() => {
    if (!data) return
    if (TERMINAL_STATUSES.has(data.draft.status)) return
    if (advancing) return
    if (data.draft.errorMessage) return
    const lockedAt = data.draft.stageLockedAt ? Date.parse(data.draft.stageLockedAt) : NaN
    const lockFresh = !Number.isNaN(lockedAt) && Date.now() - lockedAt < 90_000
    if (lockFresh) return
    const t = setTimeout(() => { void advance() }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.draft.status, data?.draft.stageLockedAt, data?.draft.errorMessage, advancing])

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

  async function pause() {
    await fetch(apiPath(`/api/admin/content/drafts/${draftId}/pause`), { method: 'POST' }).catch(() => {})
    await fetchSnapshot()
  }

  async function approveBrief() {
    setApprovingBrief(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/approve-brief`), { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        alert(j.error ?? 'Failed to approve brief')
        return
      }
      await fetchSnapshot()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve brief')
    } finally {
      setApprovingBrief(false)
    }
  }

  async function rejectBrief() {
    setRejectingBrief(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/reject-brief`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: rejectFeedback.trim() || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        alert(j.error ?? 'Failed to reject brief')
        return
      }
      setRejectOpen(false)
      setRejectFeedback('')
      await fetchSnapshot()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject brief')
    } finally {
      setRejectingBrief(false)
    }
  }

  async function applyImprovement() {
    setImproving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/audits/${draftId}/improve`), { method: 'POST' })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; prevScore?: number; newScore?: number; delta?: number; newRevisionNumber?: number; costCents?: number }
      if (!res.ok || !j.ok) {
        alert(j.error ?? 'Failed to apply improvement')
        return
      }
      await fetchSnapshot()
      alert(`Improvement applied. Score ${j.prevScore} → ${j.newScore} (Δ ${j.delta && j.delta >= 0 ? '+' : ''}${j.delta}). New revision: ${j.newRevisionNumber}. Cost: $${((j.costCents ?? 0) / 100).toFixed(2)}.`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to apply improvement')
    } finally {
      setImproving(false)
    }
  }

  async function copyBody(format: 'markdown' | 'html') {
    if (!data) return
    const currentRev = data.revisions.find(r => r.revisionNumber === selectedRevision) ?? data.revisions[data.revisions.length - 1]
    if (!currentRev) return
    const text = format === 'markdown' ? (currentRev.bodyMarkdown ?? '') : currentRev.bodyHtml
    try {
      await navigator.clipboard.writeText(text)
      setCopiedFormat(format)
      setTimeout(() => setCopiedFormat(null), 1500)
    } catch {
      alert('Copy failed — clipboard permission may be blocked.')
    }
  }

  async function forceApprove() {
    setForceApproving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/force-approve`), { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        alert(j.error ?? 'Failed to force-approve')
        return
      }
      await fetchSnapshot()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to force-approve')
    } finally {
      setForceApproving(false)
    }
  }

  async function restartFromScratch() {
    setRestarting(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/restart`), { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        alert(j.error ?? 'Failed to restart draft')
        return
      }
      setRestartConfirmOpen(false)
      await fetchSnapshot()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restart draft')
    } finally {
      setRestarting(false)
    }
  }

  async function resume() {
    await fetch(apiPath(`/api/admin/content/drafts/${draftId}/resume`), { method: 'POST' }).catch(() => {})
    await fetchSnapshot()
  }

  async function sendToStaci() {
    setPublishing('staci')
    setPublishMsg(null)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/send-to-staci`), { method: 'POST' })
      const json = await res.json() as { sent?: boolean; error?: string }
      setPublishMsg(json.sent ? 'Cover brief sent to Staci on Slack.' : `Slack send failed: ${json.error ?? ''}`)
    } catch (err) {
      setPublishMsg(`Slack send failed: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      setPublishing(null)
    }
  }

  async function setCoverUrl() {
    const url = coverUrlInput.trim()
    if (!url) return
    setPublishing('setcover')
    setPublishMsg(null)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/set-cover`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverUrl: url }),
      })
      const json = await res.json() as { coverUrl?: string; error?: string }
      if (!res.ok) { setPublishMsg(`Set cover failed: ${json.error ?? ''}`); return }
      setCoverUrlInput('')
      setPublishMsg('Cover updated.')
      await fetchSnapshot()
    } catch (err) {
      setPublishMsg(`Set cover failed: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      setPublishing(null)
    }
  }

  async function regenerateCover(mode: 'flux' | 'svg') {
    setPublishing(`cover-${mode}`)
    setPublishMsg(null)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/regenerate-cover`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const json = await res.json() as { mode?: string; mocked?: boolean; error?: string }
      if (!res.ok) { setPublishMsg(`Cover regen failed: ${json.error ?? ''}`); return }
      setPublishMsg(json.mocked ? 'Cover is mocked (no REPLICATE_API_TOKEN set).' : `New ${json.mode?.toUpperCase()} cover generated.`)
      await fetchSnapshot()
    } catch (err) {
      setPublishMsg(`Cover regen failed: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      setPublishing(null)
    }
  }

  async function restructure() {
    setPublishing('restructure')
    setPublishMsg(null)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/restructure`), { method: 'POST' })
      const json = await res.json() as { faqCount?: number; takeawayCount?: number; error?: string }
      if (!res.ok) { setPublishMsg(`Restructure failed: ${json.error ?? ''}`); return }
      setPublishMsg(`Restructured: ${json.faqCount ?? 0} FAQs + ${json.takeawayCount ?? 0} takeaways split into their own fields.`)
      await fetchSnapshot()
    } catch (err) {
      setPublishMsg(`Restructure failed: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      setPublishing(null)
    }
  }

  async function publishToWebflow(mode: 'draft' | 'now' | 'auto' | 'custom', customDate?: string) {
    setPublishing(mode)
    setPublishMsg(null)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/publish`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, customDate }),
      })
      const json = await res.json() as { publishUrl?: string; webflowItemId?: string; scheduledFor?: string; publishedAt?: string | null; error?: string; detail?: string }
      if (!res.ok) {
        setPublishMsg(`Failed: ${json.error ?? ''}${json.detail ? ' — ' + json.detail : ''}`)
        return
      }
      if (mode === 'draft') setPublishMsg(`Saved to Webflow as a draft (item ${json.webflowItemId}). Publish it from Webflow or here when ready.`)
      else if (mode === 'now' || json.publishedAt) setPublishMsg(`Published live: ${json.publishUrl}`)
      else setPublishMsg(`Scheduled for ${json.scheduledFor ? new Date(json.scheduledFor).toLocaleString() : 'next slot'} (staged in Webflow).`)
      await fetchSnapshot()
    } catch (err) {
      setPublishMsg(`Failed: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      setPublishing(null)
    }
  }

  async function applyEdits() {
    if (!editInstructions.trim()) return
    setEditing(true)
    setEditResult(null)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/suggest-edits`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: editInstructions.trim() }),
      })
      const json = await res.json() as { changeLog?: string[]; skipped?: Array<{ instruction: string; reason: string }>; error?: string }
      if (!res.ok) { setEditResult({ changeLog: [], skipped: [{ instruction: 'request', reason: json.error ?? 'failed' }] }); return }
      setEditResult({ changeLog: json.changeLog ?? [], skipped: json.skipped ?? [] })
      setEditInstructions('')
      await fetchSnapshot()
    } catch {
      setEditResult({ changeLog: [], skipped: [{ instruction: 'request', reason: 'network error' }] })
    } finally {
      setEditing(false)
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

  const { draft, idea, brief, revisions, reviewsByRevision, conflicts, spendCents, services, linkCheck } = data
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
        {draft.status === 'paused' ? (
          <TahiButton
            size="sm"
            onClick={() => { void resume() }}
            iconLeft={<Play className="w-3.5 h-3.5" />}
          >
            Resume{draft.pausedFromStatus ? ` (${prettyStatus(draft.pausedFromStatus)})` : ''}
          </TahiButton>
        ) : inFlight ? (
          <>
            <TahiButton
              size="sm"
              loading={advancing}
              onClick={() => { void advance() }}
              iconLeft={!advancing ? <Play className="w-3.5 h-3.5" /> : undefined}
            >
              {advancing ? 'Advancing...' : 'Advance pipeline (3 steps)'}
            </TahiButton>
            <TahiButton
              size="sm"
              variant="secondary"
              onClick={() => { void pause() }}
              iconLeft={<Pause className="w-3.5 h-3.5" />}
            >
              Pause
            </TahiButton>
          </>
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
        {draft.status === 'failed' && (draft.errorMessage?.includes('Sign-off score') ?? false) && (
          <TahiButton
            size="sm"
            onClick={() => { void forceApprove() }}
            loading={forceApproving}
            iconLeft={!forceApproving ? <CheckCircle2 className="w-3.5 h-3.5" /> : undefined}
            style={{ marginLeft: 'auto' }}
          >
            Force approve & continue
          </TahiButton>
        )}
        {draft.status === 'audited' && draft.originSource === 'legacy_audit' && (
          <TahiButton
            size="sm"
            onClick={() => { void applyImprovement() }}
            loading={improving}
            iconLeft={!improving ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
            style={{ marginLeft: 'auto' }}
          >
            {improving ? 'Applying…' : 'Apply improvements'}
          </TahiButton>
        )}
        {data.revisions.length > 0 && (
          <>
            <TahiButton
              size="sm"
              variant="ghost"
              onClick={() => { void copyBody('markdown') }}
              iconLeft={<FileText className="w-3.5 h-3.5" />}
            >
              {copiedFormat === 'markdown' ? 'Copied!' : 'Copy MD'}
            </TahiButton>
            <TahiButton
              size="sm"
              variant="ghost"
              onClick={() => { void copyBody('html') }}
            >
              {copiedFormat === 'html' ? 'Copied!' : 'Copy HTML'}
            </TahiButton>
          </>
        )}
        <TahiButton
          size="sm"
          variant="ghost"
          onClick={() => setRestartConfirmOpen(true)}
          iconLeft={<RotateCcw className="w-3.5 h-3.5" />}
          style={{
            marginLeft: draft.status === 'failed' && (draft.errorMessage?.includes('Sign-off score') ?? false) ? undefined : 'auto',
            color: 'var(--color-danger)',
          }}
        >
          Restart from scratch
        </TahiButton>
        <Link href="/content-studio" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <ChevronLeft size={14} aria-hidden="true" /> Back
        </Link>
      </div>

      {draft.status === 'awaiting_brief_approval' && data.brief && (
        <div style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: '0 16px 0 16px',
          padding: '1.25rem 1.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
              Strategist brief — approve before writer runs
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem 1.5rem', marginBottom: '1rem', fontSize: '0.8125rem' }}>
            {data.brief.workingTitle && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Working title</div>
                <div style={{ color: 'var(--color-text)', fontWeight: 500 }}>{data.brief.workingTitle}</div>
              </div>
            )}
            {data.brief.angle && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Angle</div>
                <div style={{ color: 'var(--color-text)' }}>{data.brief.angle}</div>
              </div>
            )}
            {data.brief.author && (
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Author</div>
                <div style={{ color: 'var(--color-text)', textTransform: 'capitalize' }}>{data.brief.author}</div>
              </div>
            )}
            {data.brief.contentBucket && (
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Bucket</div>
                <div style={{ color: 'var(--color-text)', textTransform: 'capitalize' }}>{data.brief.contentBucket}</div>
              </div>
            )}
            {data.brief.intent && (
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Intent</div>
                <div style={{ color: 'var(--color-text)' }}>{data.brief.intent.replace(/_/g, ' ')}</div>
              </div>
            )}
            {data.brief.targetWordCount && (
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Target words</div>
                <div style={{ color: 'var(--color-text)' }}>{data.brief.targetWordCount}</div>
              </div>
            )}
            {data.brief.primaryKeyword && (
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Primary keyword</div>
                <div style={{ color: 'var(--color-text)' }}>{data.brief.primaryKeyword}</div>
              </div>
            )}
            {data.brief.secondaryKeywords && data.brief.secondaryKeywords.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Secondary keywords</div>
                <div style={{ color: 'var(--color-text)' }}>{data.brief.secondaryKeywords.join(', ')}</div>
              </div>
            )}
            {data.brief.rationale && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.125rem' }}>Rationale</div>
                <div style={{ color: 'var(--color-text)', fontStyle: 'italic' }}>{data.brief.rationale}</div>
              </div>
            )}
          </div>
          {data.brief.headings && data.brief.headings.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.375rem', fontSize: '0.8125rem' }}>Outline</div>
              <ol style={{ paddingLeft: '1.25rem', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                {data.brief.headings.map((h, i) => (
                  <li key={i} style={{ marginBottom: '0.25rem' }}>
                    <strong>{h.text}</strong>
                    {h.wordTarget ? <span style={{ color: 'var(--color-text-muted)' }}> ({h.wordTarget}w)</span> : null}
                    {h.mustCover && h.mustCover.length > 0 ? (
                      <ul style={{ paddingLeft: '1rem', marginTop: '0.125rem', color: 'var(--color-text-muted)' }}>
                        {h.mustCover.map((m, j) => <li key={j}>{m}</li>)}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <TahiButton
              size="sm"
              onClick={() => { void approveBrief() }}
              loading={approvingBrief}
              iconLeft={!approvingBrief ? <CheckCircle2 className="w-3.5 h-3.5" /> : undefined}
            >
              Approve + start writer
            </TahiButton>
            <TahiButton
              size="sm"
              variant="secondary"
              onClick={() => setRejectOpen(true)}
              disabled={approvingBrief}
            >
              Reject + re-strategise
            </TahiButton>
          </div>
        </div>
      )}

      {rejectOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(18, 26, 15, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !rejectingBrief) setRejectOpen(false) }}
        >
          <div style={{
            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: '0 16px 0 16px', padding: '1.5rem', maxWidth: '32rem', width: '100%',
          }}>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.5rem' }}>
              Reject brief + re-strategise
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.55, marginBottom: '1rem' }}>
              Optionally tell the strategist what to change. The next pass will see your note and try to address it.
            </p>
            <textarea
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
              placeholder="e.g. The angle is too generic — make it about Webflow Cloud specifically. Or: cut the word count by 30%. Or: switch to a Staci-voice piece."
              rows={4}
              style={{
                width: '100%', padding: '0.625rem 0.75rem',
                border: '1px solid var(--color-border)', borderRadius: '8px',
                fontSize: '0.875rem', color: 'var(--color-text)',
                background: 'var(--color-bg)', fontFamily: 'inherit',
                marginBottom: '1rem', resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <TahiButton
                size="sm"
                variant="secondary"
                onClick={() => setRejectOpen(false)}
                disabled={rejectingBrief}
              >
                Cancel
              </TahiButton>
              <TahiButton
                size="sm"
                onClick={() => { void rejectBrief() }}
                loading={rejectingBrief}
              >
                Send back to strategist
              </TahiButton>
            </div>
          </div>
        </div>
      )}

      {restartConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="restart-confirm-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(18, 26, 15, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !restarting) setRestartConfirmOpen(false) }}
        >
          <div style={{
            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: '0 16px 0 16px', padding: '1.5rem', maxWidth: '28rem', width: '100%',
            boxShadow: '0 20px 60px -10px rgba(18, 26, 15, 0.25)',
          }}>
            <h2 id="restart-confirm-title" style={{ fontSize: '1.0625rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.5rem' }}>
              Restart from scratch?
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.55, marginBottom: '1.25rem' }}>
              This wipes every pipeline output (research, body, FAQs, reviews, cover, schema, score) and resets the draft to <strong>queued</strong>. The idea and draft id stay intact. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <TahiButton
                size="sm"
                variant="secondary"
                onClick={() => setRestartConfirmOpen(false)}
                disabled={restarting}
              >
                Cancel
              </TahiButton>
              <TahiButton
                size="sm"
                onClick={() => { void restartFromScratch() }}
                loading={restarting}
                style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
              >
                Yes, restart
              </TahiButton>
            </div>
          </div>
        </div>
      )}

      {/* Publish to Webflow — shown once the draft is ready. */}
      {draft.status === 'ready_for_publish' && (
        <Card padding="md" style={{ borderColor: 'var(--color-brand)', background: 'var(--color-brand-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.625rem' }}>
            <div>
              <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-brand-dark)', margin: 0 }}>
                Ready for Webflow
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.125rem 0 0' }}>
                Body, FAQs, takeaways + meta are split into their CMS fields. Pick how it lands.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <TahiButton size="sm" variant="secondary" loading={publishing === 'restructure'} onClick={() => { void restructure() }} title="Re-split fields, strip fabricated links, re-run the 200 link gate + schema validation">
                Validate &amp; recheck
              </TahiButton>
              <TahiButton size="sm" variant="secondary" loading={publishing === 'draft'} onClick={() => { void publishToWebflow('draft') }}>
                Save as draft
              </TahiButton>
              <TahiButton
                size="sm"
                variant="secondary"
                loading={publishing === 'auto'}
                onClick={() => { void publishToWebflow('auto') }}
                title="Next Mon/Wed/Fri 09:00 UK after everything already queued"
              >
                Auto-schedule
              </TahiButton>
              <input
                type="datetime-local"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
                style={{ padding: '0.4rem 0.5rem', fontSize: '0.8125rem', borderRadius: '0.375rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
              />
              <TahiButton
                size="sm"
                variant="secondary"
                loading={publishing === 'custom'}
                disabled={!scheduleDate}
                onClick={() => { void publishToWebflow('custom', new Date(scheduleDate).toISOString()) }}
              >
                Set date
              </TahiButton>
              <TahiButton size="sm" loading={publishing === 'now'} onClick={() => { void publishToWebflow('now') }}>
                Publish now
              </TahiButton>
            </div>
          </div>
          {publishMsg && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0.625rem 0 0', wordBreak: 'break-word' }}>
              {publishMsg}
            </p>
          )}
        </Card>
      )}

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

      {/* Link check — final 200 gate. Surfaces any dead internal/external
          links so none ship. */}
      {linkCheck && (
        <Card
          padding="md"
          style={linkCheck.deadCount > 0
            ? { borderColor: 'var(--color-danger)', background: 'var(--color-danger-bg, #fef2f2)' }
            : undefined}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {linkCheck.deadCount > 0
              ? <XCircle size={15} aria-hidden="true" style={{ color: 'var(--color-danger)' }} />
              : <CheckCircle2 size={15} aria-hidden="true" style={{ color: 'var(--color-success, #4ade80)' }} />}
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
              Link check — {linkCheck.okCount}/{linkCheck.total} live
              {linkCheck.deadCount > 0 ? `, ${linkCheck.deadCount} DEAD` : ' (all 200)'}
            </span>
          </div>
          {linkCheck.deadCount > 0 && (
            <ul style={{ margin: '0.5rem 0 0', padding: '0 0 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {linkCheck.dead.map((d, i) => (
                <li key={i} style={{ fontSize: '0.8125rem', color: 'var(--color-text)', wordBreak: 'break-all' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-danger)' }}>{d.status ?? 'ERR'}</span>{' '}
                  <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-muted)' }}>{d.url}</a>
                  <span style={{ color: 'var(--color-text-subtle)' }}> — {d.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Suggest edits — guardrailed manual pass. Available once there's
          a body to edit. */}
      {currentRev && currentRev.bodyHtml && (
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>
              Suggest edits
            </p>
            <TahiButton size="sm" variant={editOpen ? 'secondary' : 'primary'} onClick={() => setEditOpen(v => !v)}>
              {editOpen ? 'Close' : 'Suggest edits'}
            </TahiButton>
          </div>
          {editOpen && (
            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                Give specific instructions. The editor applies <strong>only</strong> what you ask, leaves everything else verbatim, and returns a changelog. Anything ambiguous it skips rather than guessing.
              </p>
              <textarea
                rows={4}
                value={editInstructions}
                onChange={e => setEditInstructions(e.target.value)}
                placeholder={'e.g.\n- Cut the 3rd paragraph under "What we skip"\n- Make the intro one sentence punchier\n- Change "we never" to "we rarely" in the pricing section'}
                style={{
                  width: '100%', padding: '0.625rem 0.75rem', fontSize: '0.875rem',
                  borderRadius: '0.5rem', border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)', resize: 'vertical', lineHeight: 1.5,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <TahiButton size="sm" loading={editing} onClick={() => { void applyEdits() }} disabled={!editInstructions.trim()}>
                  {editing ? 'Applying...' : 'Apply edits'}
                </TahiButton>
              </div>
              {editResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {editResult.changeLog.length > 0 && (
                    <div style={{ padding: '0.625rem 0.75rem', background: 'var(--color-brand-50)', borderRadius: '0.5rem' }}>
                      <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-brand-dark)', margin: '0 0 0.375rem' }}>
                        Applied ({editResult.changeLog.length})
                      </p>
                      <ul style={{ margin: 0, padding: '0 0 0 1rem', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                        {editResult.changeLog.map((c, i) => <li key={i} style={{ marginBottom: '0.2rem' }}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                  {editResult.skipped.length > 0 && (
                    <div style={{ padding: '0.625rem 0.75rem', background: 'var(--color-warning-bg)', borderRadius: '0.5rem' }}>
                      <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-warning-text, #8A5A12)', margin: '0 0 0.375rem' }}>
                        Skipped (ambiguous — left untouched)
                      </p>
                      <ul style={{ margin: 0, padding: '0 0 0 1rem', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                        {editResult.skipped.map((s, i) => <li key={i} style={{ marginBottom: '0.2rem' }}><strong>{s.instruction}</strong>: {s.reason}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Article preview — rendered like a real blog post */}
      {currentRev && currentRev.bodyHtml && (
        <Card padding="none">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0.875rem 1.25rem 0' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <FileText size={12} aria-hidden="true" /> Article preview — revision {currentRev.revisionNumber}
            </p>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              {currentRev.wordCount?.toLocaleString() ?? '?'} words · {currentRev.source}
            </span>
          </div>
          {currentRev.reason && (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.375rem 1.25rem 0', fontStyle: 'italic' }}>
              {currentRev.reason}
            </p>
          )}

          <article className="rt-article" style={{ maxHeight: '52rem', overflowY: 'auto', padding: '1.5rem 1.25rem 2rem' }}>
            {/* Cover + regenerate controls */}
            <div style={{ marginBottom: '1.5rem' }}>
              {draft.coverSvgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.coverSvgUrl}
                  alt={draft.title ?? 'Cover'}
                  style={{ width: '100%', borderRadius: '0.75rem', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', aspectRatio: '864 / 500', borderRadius: '0.75rem', background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-subtle)', fontSize: '0.8125rem' }}>
                  No cover yet
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <TahiButton size="sm" loading={publishing === 'staci'} onClick={() => { void sendToStaci() }}>
                  Send to Staci
                </TahiButton>
                <TahiButton size="sm" variant="secondary" loading={publishing === 'cover-flux'} onClick={() => { void regenerateCover('flux') }} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
                  Regenerate (Flux)
                </TahiButton>
                <TahiButton size="sm" variant="secondary" loading={publishing === 'cover-svg'} onClick={() => { void regenerateCover('svg') }}>
                  Try SVG
                </TahiButton>
              </div>
              <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.375rem' }}>
                <input
                  type="text"
                  value={coverUrlInput}
                  onChange={e => setCoverUrlInput(e.target.value)}
                  placeholder="Paste finished cover image URL (after Staci)"
                  style={{ flex: 1, padding: '0.4rem 0.5rem', fontSize: '0.8125rem', borderRadius: '0.375rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
                />
                <TahiButton size="sm" variant="secondary" loading={publishing === 'setcover'} disabled={!coverUrlInput.trim()} onClick={() => { void setCoverUrl() }}>
                  Set cover
                </TahiButton>
              </div>
            </div>
            {/* Title + byline */}
            <h1 style={{ fontSize: '1.875rem', fontWeight: 800, lineHeight: 1.2, color: 'var(--color-text)', margin: '0 0 0.5rem', maxWidth: '44rem' }}>
              {draft.title ?? idea?.title ?? 'Untitled'}
            </h1>
            {draft.metaDescription && (
              <p style={{ fontSize: '1.0625rem', lineHeight: 1.5, color: 'var(--color-text-muted)', margin: '0 0 1rem', maxWidth: '44rem' }}>
                {draft.metaDescription}
              </p>
            )}
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', margin: '0 0 1.5rem' }}>
              By Liam, Co-founder · Tahi Studio
            </p>
            <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: '0 0 1.5rem', maxWidth: '44rem' }} />

            {/* Copy buttons — quick lift of body markdown or HTML to clipboard */}
            <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '1rem', maxWidth: '44rem', flexWrap: 'wrap' }}>
              <TahiButton
                size="sm"
                variant="secondary"
                onClick={() => { void copyBody('markdown') }}
                iconLeft={<FileText className="w-3.5 h-3.5" />}
              >
                {copiedFormat === 'markdown' ? 'Copied!' : 'Copy markdown'}
              </TahiButton>
              <TahiButton
                size="sm"
                variant="secondary"
                onClick={() => { void copyBody('html') }}
              >
                {copiedFormat === 'html' ? 'Copied!' : 'Copy HTML'}
              </TahiButton>
            </div>

            {/* Body */}
            <div
              className="rt-article-body"
              style={{ maxWidth: '44rem' }}
              dangerouslySetInnerHTML={{ __html: currentRev.bodyHtml }}
            />

            {/* Key takeaways (if present as a separate field) */}
            {draft.keyTakeaways && (
              <section style={{ maxWidth: '44rem', marginTop: '2rem', padding: '1rem 1.25rem', background: 'var(--color-brand-50)', borderRadius: 'var(--radius-leaf, 0 16px 0 16px)' }}>
                <h3 style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-brand-dark)', margin: '0 0 0.625rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
                  <ListChecks size={14} aria-hidden="true" /> Key takeaways
                </h3>
                <div className="rt-article-body" dangerouslySetInnerHTML={{ __html: draft.keyTakeaways }} />
              </section>
            )}

            {/* FAQs (if present) */}
            <FaqSection faqsJson={draft.faqsJson} />
          </article>
        </Card>
      )}

      {/* Scoped article styles. Gives the raw body HTML real heading
          hierarchy + spacing so it reads like a published post, not a
          flat blob. */}
      <style>{`
        .rt-article-body { font-size: 1rem; line-height: 1.7; color: var(--color-text); }
        .rt-article-body h2 { font-size: 1.5rem; font-weight: 700; line-height: 1.3; margin: 2rem 0 0.75rem; color: var(--color-text); }
        .rt-article-body h3 { font-size: 1.1875rem; font-weight: 700; line-height: 1.35; margin: 1.5rem 0 0.5rem; color: var(--color-text); }
        .rt-article-body p { margin: 0 0 1.1rem; }
        .rt-article-body ul, .rt-article-body ol { margin: 0 0 1.1rem; padding-left: 1.5rem; }
        .rt-article-body li { margin: 0 0 0.4rem; }
        .rt-article-body a { color: var(--color-brand); text-decoration: underline; text-underline-offset: 2px; }
        .rt-article-body blockquote { margin: 1.25rem 0; padding: 0.5rem 0 0.5rem 1rem; border-left: 3px solid var(--color-brand); color: var(--color-text-muted); font-style: italic; }
        .rt-article-body strong { font-weight: 700; color: var(--color-text); }
        .rt-article-body code { background: var(--color-bg-secondary); padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.875em; }
        .rt-article-body hr { border: none; border-top: 1px solid var(--color-border-subtle); margin: 2rem 0; }
      `}</style>
    </div>
  )
}

/** Renders FAQs from the draft's faqsJson field as a Q/A list. faqsJson
 *  is expected to be a JSON array of { q, a } (or { question, answer }). */
function FaqSection({ faqsJson }: { faqsJson: string | null }) {
  if (!faqsJson) return null
  let faqs: Array<{ q?: string; a?: string; question?: string; answer?: string }> = []
  try {
    const parsed = JSON.parse(faqsJson)
    if (Array.isArray(parsed)) faqs = parsed
  } catch { return null }
  const normalised = faqs
    .map(f => ({ q: f.q ?? f.question ?? '', a: f.a ?? f.answer ?? '' }))
    .filter(f => f.q && f.a)
  if (normalised.length === 0) return null

  return (
    <section style={{ maxWidth: '44rem', marginTop: '2rem' }}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 1rem' }}>
        Frequently asked questions
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {normalised.map((f, i) => (
          <div
            key={i}
            style={{
              padding: '0.875rem 1rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: '0.625rem',
            }}
          >
            <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.375rem' }}>
              {f.q}
            </p>
            <p style={{ fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--color-text-muted)', margin: 0 }}>
              {f.a}
            </p>
          </div>
        ))}
      </div>
    </section>
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
  if (status === 'ready_for_publish' || status === 'ready' || status === 'audited') return 'positive'
  if (status === 'failed' || status === 'cost_capped') return 'danger'
  if (status === 'paused' || status === 'awaiting_brief_approval') return 'warning'
  return 'info'
}

function prettyStatus(status: string): string {
  const map: Record<string, string> = {
    queued: 'Queued',
    researching: 'Researching',
    strategising: 'Strategising',
    awaiting_brief_approval: 'Awaiting brief approval',
    headline_lab: 'Headline lab',
    drafting: 'Drafting',
    reviewing: 'Reviewing (23 reviewers)',
    editing: 'Editing',
    signing_off: 'Sign-off',
    covering: 'Generating cover',
    ready_for_publish: 'Ready for publish',
    ready: 'Ready',
    audited: 'Audited',
    failed: 'Failed',
    cost_capped: 'Cost cap reached',
    paused: 'Paused',
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
