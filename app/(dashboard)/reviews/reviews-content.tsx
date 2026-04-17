'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Star, Search, ChevronDown, Loader2, Copy,
  Send, CheckCircle2, ExternalLink, Video, Globe,
  MessageSquare, ThumbsUp, Sparkles, FileText,
  AlertCircle,
} from 'lucide-react'
import { apiPath } from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────

interface ReviewItem {
  orgId: string
  orgName: string
  planType: string | null
  orgStatus: string
  outreachStatus: string
  submissionId: string | null
  npsScore: number | null
  writtenTestimonial: string | null
  videoUrl: string | null
  marketingPermission: boolean | null
  logoPermission: boolean | null
  caseStudyPermission: boolean | null
  clutchReviewUrl: string | null
  submittedAt: string | null
  nextAskAt: string | null
  neverAsk: number
  submissionToken: string | null
  lovedMost: string | null
  improve: string | null
  projectName: string | null
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  not_sent:    { label: 'Not Sent',    bg: 'var(--color-bg-tertiary)',  color: 'var(--color-text-muted)',  border: 'var(--color-border)' },
  asked:       { label: 'Asked',       bg: 'var(--color-info-bg)',      color: 'var(--color-info)',        border: 'var(--color-info)' },
  declined:    { label: 'Declined',    bg: 'var(--color-danger-bg)',    color: 'var(--color-danger)',      border: 'var(--color-danger)' },
  deferred:    { label: 'Deferred',    bg: 'var(--color-warning-bg)',   color: 'var(--color-warning)',     border: 'var(--color-warning)' },
  in_progress: { label: 'In Progress', bg: 'var(--color-brand-50)',     color: 'var(--color-brand)',       border: 'var(--color-brand)' },
  completed:   { label: 'Completed',   bg: 'var(--color-success-bg)',   color: 'var(--color-success)',     border: 'var(--color-success)' },
}

const FILTER_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Not Sent', value: 'not_sent' },
  { label: 'Asked', value: 'asked' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Declined', value: 'declined' },
  { label: 'Deferred', value: 'deferred' },
]

const NPS_LABELS: Record<string, { label: string; color: string }> = {
  promoter:  { label: 'Promoter',  color: 'var(--color-success)' },
  passive:   { label: 'Passive',   color: 'var(--color-warning)' },
  detractor: { label: 'Detractor', color: 'var(--color-danger)' },
}

const CLUTCH_URL = 'https://clutch.co'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '--' }
}

function getNpsColor(score: number | null): string {
  if (score === null) return 'var(--color-text-muted)'
  if (score >= 9) return 'var(--color-success)'
  if (score >= 7) return 'var(--color-brand)'
  if (score >= 5) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

function getNpsCategory(score: number | null): string | null {
  if (score === null) return null
  if (score >= 9) return 'promoter'
  if (score >= 7) return 'passive'
  return 'detractor'
}

function isVideoUrl(url: string | null): boolean {
  if (!url) return false
  return url.includes('loom.com') || url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com')
}

// ── Component ──────────────────────────────────────────────────────────────

export function ReviewsContent() {
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState<Record<string, string>>({})
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/reviews'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { reviews?: ReviewItem[] }
      setReviews(data.reviews ?? [])
    } catch {
      setReviews([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchReviews() }, [fetchReviews])

  const updateStatus = async (orgId: string, outreachStatus: string, nextAskAt?: string) => {
    setUpdatingId(orgId)
    try {
      await fetch(apiPath('/api/admin/reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, outreachStatus, nextAskAt }),
      })
      await fetchReviews()
    } finally {
      setUpdatingId(null)
    }
  }

  const generateDraft = async (submissionId: string) => {
    setGeneratingDraft(submissionId)
    try {
      const res = await fetch(apiPath('/api/admin/case-studies/draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { draft?: string }
      if (data.draft) {
        setDraftContent(prev => ({ ...prev, [submissionId]: data.draft as string }))
      }
    } catch {
      // Silent failure
    } finally {
      setGeneratingDraft(null)
    }
  }

  const copyReviewLink = (token: string | null) => {
    if (!token) return
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${base}/review?token=${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 2000)
    }).catch(() => {
      // Clipboard write failed
    })
  }

  const filtered = reviews.filter(r => {
    if (filterStatus !== 'all' && r.outreachStatus !== filterStatus) return false
    if (search && !r.orgName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Stats
  const totalOrgs = reviews.length
  const completed = reviews.filter(r => r.outreachStatus === 'completed').length
  const npsScores = reviews.filter(r => r.npsScore !== null)
  const avgNps = npsScores.length > 0
    ? npsScores.reduce((sum, r) => sum + (r.npsScore ?? 0), 0) / npsScores.length
    : 0
  const withPermission = reviews.filter(r => r.marketingPermission).length
  const withVideo = reviews.filter(r => r.videoUrl).length
  const promoters = reviews.filter(r => r.npsScore !== null && r.npsScore >= 9).length
  const detractors = reviews.filter(r => r.npsScore !== null && r.npsScore <= 6).length
  const npsNet = npsScores.length > 0
    ? Math.round(((promoters - detractors) / npsScores.length) * 100)
    : null

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Reviews and Testimonials</h1>
          <p className="text-sm text-[var(--color-text-muted)]" style={{ marginTop: '0.25rem' }}>
            Manage client outreach, collect NPS scores, testimonials, and build case studies.
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4" style={{ marginBottom: '1.5rem' }}>
        <StatCard label="Total Clients" value={totalOrgs} icon={<MessageSquare className="w-5 h-5" />} />
        <StatCard label="Reviews Completed" value={completed} icon={<CheckCircle2 className="w-5 h-5" />} />
        <StatCard
          label="NPS Score"
          value={npsNet !== null ? `${npsNet > 0 ? '+' : ''}${npsNet}` : '--'}
          icon={<Star className="w-5 h-5" />}
          subtitle={avgNps > 0 ? `Avg: ${avgNps.toFixed(1)}` : undefined}
        />
        <StatCard label="Marketing Permission" value={withPermission} icon={<ThumbsUp className="w-5 h-5" />} />
        <StatCard label="Video Testimonials" value={withVideo} icon={<Video className="w-5 h-5" />} />
      </div>

      {/* Main card */}
      <div
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.75rem',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Toolbar */}
        <div
          className="flex flex-wrap items-center gap-2"
          style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border-subtle)' }}
        >
          <div className="relative" style={{ width: '14rem' }}>
            <Search
              className="absolute top-1/2 pointer-events-none"
              style={{ left: '0.625rem', transform: 'translateY(-50%)', width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)' }}
            />
            <input
              type="text"
              placeholder="Search clients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
              style={{
                padding: '0.4375rem 0.75rem 0.4375rem 2rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text)',
              }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div
          className="flex items-end overflow-x-auto"
          style={{ borderBottom: '1px solid var(--color-border)', paddingLeft: '0.25rem', paddingRight: '1rem' }}
        >
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilterStatus(tab.value)}
              className="font-medium whitespace-nowrap flex-shrink-0 transition-colors"
              style={{
                padding: '0.625rem 1rem',
                fontSize: '0.875rem',
                border: 0,
                borderBottom: filterStatus === tab.value ? '2px solid var(--color-brand)' : '2px solid transparent',
                marginBottom: '-1px',
                color: filterStatus === tab.value ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {tab.label}
              {tab.value !== 'all' && (
                <span className="ml-1.5 text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                  {reviews.filter(r => r.outreachStatus === tab.value).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <LoadingSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState search={search} />
        ) : (
          <div>
            {filtered.map((review, i) => {
              const isExpanded = expandedId === review.orgId
              const statusCfg = STATUS_CFG[review.outreachStatus] ?? STATUS_CFG.not_sent
              const isUpdating = updatingId === review.orgId
              const isHovered = hoveredRow === review.orgId
              const npsCategory = getNpsCategory(review.npsScore)

              return (
                <div
                  key={review.orgId}
                  style={{
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                  }}
                >
                  {/* Main row */}
                  <div
                    className="flex items-center gap-3 cursor-pointer transition-colors"
                    style={{
                      padding: '0.75rem 1rem',
                      background: isHovered ? 'var(--color-bg-secondary)' : 'transparent',
                    }}
                    onClick={() => setExpandedId(isExpanded ? null : review.orgId)}
                    onMouseEnter={() => setHoveredRow(review.orgId)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    {/* Org name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-[var(--color-text)] truncate block">
                        {review.orgName}
                      </span>
                      <span className="text-xs text-[var(--color-text-subtle)]">
                        {review.planType ?? 'No plan'}
                        {review.projectName ? ` / ${review.projectName}` : ''}
                      </span>
                    </div>

                    {/* NPS score */}
                    <div className="hidden sm:flex items-center gap-1.5" style={{ width: '5.5rem' }}>
                      {review.npsScore !== null ? (
                        <>
                          <span
                            className="text-sm font-bold"
                            style={{ color: getNpsColor(review.npsScore) }}
                          >
                            {review.npsScore}
                          </span>
                          {npsCategory && (
                            <span
                              className="text-xs"
                              style={{ color: NPS_LABELS[npsCategory].color }}
                            >
                              {NPS_LABELS[npsCategory].label}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-[var(--color-text-subtle)]">--</span>
                      )}
                    </div>

                    {/* Content indicators */}
                    <div className="hidden md:flex items-center gap-1">
                      {review.writtenTestimonial && (
                        <span
                          title="Has written testimonial"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '1.5rem',
                            height: '1.5rem',
                            borderRadius: '0.375rem',
                            background: 'var(--color-bg-tertiary)',
                            color: 'var(--color-brand)',
                          }}
                        >
                          <FileText style={{ width: '0.75rem', height: '0.75rem' }} />
                        </span>
                      )}
                      {review.videoUrl && (
                        <span
                          title="Has video testimonial"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '1.5rem',
                            height: '1.5rem',
                            borderRadius: '0.375rem',
                            background: 'var(--color-bg-tertiary)',
                            color: 'var(--color-brand)',
                          }}
                        >
                          <Video style={{ width: '0.75rem', height: '0.75rem' }} />
                        </span>
                      )}
                      {review.clutchReviewUrl && (
                        <span
                          title="Clutch review submitted"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '1.5rem',
                            height: '1.5rem',
                            borderRadius: '0.375rem',
                            background: 'var(--color-bg-tertiary)',
                            color: 'var(--color-brand)',
                          }}
                        >
                          <Globe style={{ width: '0.75rem', height: '0.75rem' }} />
                        </span>
                      )}
                    </div>

                    {/* Status badge */}
                    <span
                      className="inline-flex items-center rounded-full text-xs font-medium whitespace-nowrap"
                      style={{
                        padding: '0.125rem 0.625rem',
                        background: statusCfg.bg,
                        color: statusCfg.color,
                        border: `1px solid ${statusCfg.border}`,
                      }}
                    >
                      {statusCfg.label}
                    </span>

                    {/* Quick actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {review.outreachStatus === 'not_sent' && (
                        <button
                          onClick={e => { e.stopPropagation(); updateStatus(review.orgId, 'asked') }}
                          disabled={isUpdating}
                          className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-brand)' }}
                          title="Mark as asked"
                        >
                          {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                      )}
                      {review.submissionToken && (
                        <button
                          onClick={e => { e.stopPropagation(); copyReviewLink(review.submissionToken) }}
                          className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                          title="Copy review link"
                        >
                          {copiedToken === review.submissionToken
                            ? <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
                            : <Copy className="w-4 h-4" />}
                        </button>
                      )}
                      <ChevronDown
                        className="w-4 h-4 transition-transform"
                        style={{
                          color: 'var(--color-text-subtle)',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: '0 1rem 1rem 1rem',
                        background: 'var(--color-bg-secondary)',
                      }}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ paddingTop: '0.75rem' }}>
                        {/* Review details */}
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
                            Review Details
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <DetailRow label="NPS Score" value={review.npsScore !== null ? String(review.npsScore) : 'Not submitted'} />
                            <DetailRow label="Submitted" value={formatDate(review.submittedAt)} />
                            {review.nextAskAt && (
                              <DetailRow label="Follow-up" value={formatDate(review.nextAskAt)} />
                            )}
                            {review.neverAsk === 1 && (
                              <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                                <AlertCircle style={{ width: '0.75rem', height: '0.75rem' }} />
                                Client opted out of future asks
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Permissions */}
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
                            Permissions Granted
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                            <PermissionRow label="Website use" granted={review.marketingPermission} />
                            <PermissionRow label="Logo use" granted={review.logoPermission} />
                            <PermissionRow label="Case study" granted={review.caseStudyPermission} />
                          </div>
                        </div>

                        {/* Feedback highlights */}
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
                            Feedback
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                            {review.lovedMost && (
                              <div>
                                <span className="text-xs text-[var(--color-text-subtle)]">Loved most:</span>
                                <p className="text-sm text-[var(--color-text)]" style={{ margin: '0.125rem 0 0 0' }}>
                                  {review.lovedMost}
                                </p>
                              </div>
                            )}
                            {review.improve && (
                              <div>
                                <span className="text-xs text-[var(--color-text-subtle)]">To improve:</span>
                                <p className="text-sm text-[var(--color-text)]" style={{ margin: '0.125rem 0 0 0' }}>
                                  {review.improve}
                                </p>
                              </div>
                            )}
                            {!review.lovedMost && !review.improve && (
                              <p className="text-sm text-[var(--color-text-muted)] italic">No feedback submitted yet.</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Written testimonial */}
                      <div style={{ marginTop: '1rem' }}>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
                          Written Testimonial
                        </h4>
                        {review.writtenTestimonial ? (
                          <div
                            style={{
                              padding: '0.75rem',
                              background: 'var(--color-bg)',
                              borderRadius: '0.5rem',
                              border: '1px solid var(--color-border)',
                              borderLeft: '3px solid var(--color-brand)',
                            }}
                          >
                            <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap" style={{ margin: 0 }}>
                              &ldquo;{review.writtenTestimonial}&rdquo;
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-[var(--color-text-muted)] italic">No testimonial submitted yet.</p>
                        )}
                      </div>

                      {/* Video testimonial */}
                      {review.videoUrl && (
                        <div style={{ marginTop: '1rem' }}>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
                            Video Testimonial
                          </h4>
                          <a
                            href={review.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80"
                            style={{
                              padding: '0.5rem 0.75rem',
                              background: 'var(--color-bg)',
                              border: '1px solid var(--color-border)',
                              borderRadius: '0.5rem',
                              color: 'var(--color-brand)',
                              textDecoration: 'none',
                            }}
                          >
                            <Video style={{ width: '1rem', height: '1rem' }} />
                            {isVideoUrl(review.videoUrl) ? 'Watch video testimonial' : 'Open video link'}
                            <ExternalLink style={{ width: '0.75rem', height: '0.75rem', opacity: 0.6 }} />
                          </a>
                        </div>
                      )}

                      {/* Clutch review */}
                      <div style={{ marginTop: '1rem' }}>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
                          Clutch Review
                        </h4>
                        {review.clutchReviewUrl ? (
                          <a
                            href={review.clutchReviewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80"
                            style={{
                              padding: '0.5rem 0.75rem',
                              background: 'var(--color-bg)',
                              border: '1px solid var(--color-border)',
                              borderRadius: '0.5rem',
                              color: 'var(--color-brand)',
                              textDecoration: 'none',
                            }}
                          >
                            <Globe style={{ width: '1rem', height: '1rem' }} />
                            View Clutch review
                            <ExternalLink style={{ width: '0.75rem', height: '0.75rem', opacity: 0.6 }} />
                          </a>
                        ) : (
                          <p className="text-sm text-[var(--color-text-muted)] italic">
                            No Clutch review submitted. Client can leave a review at{' '}
                            <a
                              href={CLUTCH_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--color-brand)', textDecoration: 'underline' }}
                            >
                              clutch.co
                            </a>
                          </p>
                        )}
                      </div>

                      {/* Case study draft */}
                      {review.outreachStatus === 'completed' && review.submissionId && (
                        <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                              Case Study Draft
                            </h4>
                            <button
                              onClick={() => generateDraft(review.submissionId as string)}
                              disabled={generatingDraft === review.submissionId}
                              className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                              style={{
                                padding: '0.25rem 0.75rem',
                                background: 'var(--color-brand)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0 0.5rem 0 0.5rem',
                                cursor: generatingDraft === review.submissionId ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {generatingDraft === review.submissionId
                                ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                                : <Sparkles className="w-3 h-3" aria-hidden="true" />}
                              {generatingDraft === review.submissionId ? 'Generating...' : 'Generate Draft'}
                            </button>
                          </div>
                          {draftContent[review.submissionId as string] && (
                            <pre
                              className="text-xs whitespace-pre-wrap"
                              style={{
                                padding: '0.75rem',
                                background: 'var(--color-bg)',
                                borderRadius: '0.5rem',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text)',
                                maxHeight: '20rem',
                                overflowY: 'auto',
                              }}
                            >
                              {draftContent[review.submissionId as string]}
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Status change buttons */}
                      <div className="flex flex-wrap gap-2" style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
                        <span className="text-xs font-medium text-[var(--color-text-subtle)] mr-2 self-center">
                          Change status:
                        </span>
                        {(['not_sent', 'asked', 'deferred', 'declined', 'in_progress', 'completed'] as const).map(s => {
                          const cfg = STATUS_CFG[s]
                          const isActive = review.outreachStatus === s
                          return (
                            <button
                              key={s}
                              onClick={() => {
                                if (s === 'deferred') {
                                  const nextWeek = new Date()
                                  nextWeek.setDate(nextWeek.getDate() + 7)
                                  updateStatus(review.orgId, s, nextWeek.toISOString())
                                } else {
                                  updateStatus(review.orgId, s)
                                }
                              }}
                              disabled={isActive || isUpdating}
                              className="text-xs font-medium rounded-full transition-colors"
                              style={{
                                padding: '0.25rem 0.625rem',
                                background: isActive ? cfg.bg : 'var(--color-bg)',
                                color: isActive ? cfg.color : 'var(--color-text-muted)',
                                border: `1px solid ${isActive ? cfg.border : 'var(--color-border)'}`,
                                cursor: isActive ? 'default' : 'pointer',
                                opacity: isActive ? 1 : 0.8,
                              }}
                            >
                              {cfg.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, icon, subtitle }: { label: string; value: string | number; icon: React.ReactNode; subtitle?: string }) {
  return (
    <div
      style={{
        padding: '1.25rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
        <span className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide">
          {label}
        </span>
        <span style={{ color: 'var(--color-brand)' }}>{icon}</span>
      </div>
      <span className="text-2xl font-bold text-[var(--color-text)]">{value}</span>
      {subtitle && (
        <span className="block text-xs text-[var(--color-text-subtle)]" style={{ marginTop: '0.125rem' }}>
          {subtitle}
        </span>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="font-medium text-[var(--color-text)]">{value}</span>
    </div>
  )
}

function PermissionRow({ label, granted }: { label: string; granted: boolean | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.25rem',
          height: '1.25rem',
          borderRadius: '0.25rem',
          background: granted ? 'var(--color-success-bg)' : 'var(--color-bg-tertiary)',
          border: `1px solid ${granted ? 'var(--color-success)' : 'var(--color-border)'}`,
        }}
      >
        {granted ? (
          <CheckCircle2 style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-success)' }} />
        ) : granted === false ? (
          <span style={{ width: '0.5rem', height: '0.125rem', background: 'var(--color-text-subtle)', borderRadius: '0.0625rem' }} />
        ) : (
          <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.625rem' }}>?</span>
        )}
      </span>
      <span style={{ color: granted ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
        {label}
      </span>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: '1rem' }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className="flex items-center gap-3"
          style={{
            padding: '0.75rem 0',
            borderBottom: i < 5 ? '1px solid var(--color-border-subtle)' : 'none',
          }}
        >
          <div className="flex-1 min-w-0">
            <div className="animate-pulse" style={{ width: '10rem', height: '0.875rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '0.25rem' }} />
            <div className="animate-pulse" style={{ width: '5rem', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
          </div>
          <div className="animate-pulse" style={{ width: '2.5rem', height: '0.875rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
          <div className="animate-pulse" style={{ width: '5rem', height: '1.25rem', background: 'var(--color-bg-tertiary)', borderRadius: '9999px' }} />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: '3rem 1rem' }}>
      <div
        className="flex items-center justify-center"
        style={{
          width: '3.5rem',
          height: '3.5rem',
          borderRadius: 'var(--radius-leaf)',
          background: 'linear-gradient(135deg, var(--color-brand-light), var(--color-brand-dark))',
          marginBottom: '0.75rem',
        }}
      >
        <Star className="w-7 h-7 text-white" />
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text)]" style={{ marginBottom: '0.25rem' }}>
        No reviews found
      </h3>
      <p className="text-sm text-[var(--color-text-muted)]">
        {search ? 'Try a different search term.' : 'Start outreach to collect client reviews and testimonials.'}
      </p>
    </div>
  )
}
