'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Star, Search, ChevronDown, Loader2, Copy,
  Send, CheckCircle2,
  MessageSquare, ThumbsUp, Sparkles,
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
  marketingPermission: boolean | null
  logoPermission: boolean | null
  submittedAt: string | null
  nextAskAt: string | null
  neverAsk: number
  submissionToken: string | null
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
  { label: 'Completed', value: 'completed' },
  { label: 'Declined', value: 'declined' },
  { label: 'Deferred', value: 'deferred' },
]

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
  const avgNps = reviews
    .filter(r => r.npsScore !== null)
    .reduce((sum, r, _, arr) => sum + (r.npsScore ?? 0) / arr.length, 0)
  const withPermission = reviews.filter(r => r.marketingPermission).length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Reviews and Testimonials</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Manage client outreach and review submissions.
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Clients" value={totalOrgs} icon={<MessageSquare className="w-5 h-5" />} />
        <StatCard label="Reviews Completed" value={completed} icon={<CheckCircle2 className="w-5 h-5" />} />
        <StatCard label="Avg NPS" value={avgNps > 0 ? avgNps.toFixed(1) : '--'} icon={<Star className="w-5 h-5" />} />
        <StatCard label="Marketing Permission" value={withPermission} icon={<ThumbsUp className="w-5 h-5" />} />
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
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-subtle)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div
              className="w-14 h-14 flex items-center justify-center mb-3"
              style={{
                borderRadius: 'var(--radius-leaf)',
                background: 'linear-gradient(135deg, var(--color-brand-light), var(--color-brand-dark))',
              }}
            >
              <Star className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-base font-semibold text-[var(--color-text)] mb-1">No reviews found</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              {search ? 'Try a different search term.' : 'Start outreach to collect client reviews.'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((review, i) => {
              const isExpanded = expandedId === review.orgId
              const statusCfg = STATUS_CFG[review.outreachStatus] ?? STATUS_CFG.not_sent
              const isUpdating = updatingId === review.orgId

              return (
                <div
                  key={review.orgId}
                  style={{
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                  }}
                >
                  {/* Main row */}
                  <div
                    className="flex items-center gap-3 cursor-pointer transition-colors hover:bg-[var(--color-bg-secondary)]"
                    style={{ padding: '0.75rem 1rem' }}
                    onClick={() => setExpandedId(isExpanded ? null : review.orgId)}
                  >
                    {/* Org name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-[var(--color-text)] truncate block">
                        {review.orgName}
                      </span>
                      {review.planType && (
                        <span className="text-xs text-[var(--color-text-subtle)]">{review.planType}</span>
                      )}
                    </div>

                    {/* NPS */}
                    <div className="hidden sm:block" style={{ width: '4rem', textAlign: 'center' }}>
                      {review.npsScore !== null ? (
                        <span
                          className="text-sm font-bold"
                          style={{ color: getNpsColor(review.npsScore) }}
                        >
                          {review.npsScore}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-subtle)]">--</span>
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
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                        {/* Review details */}
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)] mb-2">
                            Review Details
                          </h4>
                          <div className="space-y-2">
                            <DetailRow label="NPS Score" value={review.npsScore !== null ? String(review.npsScore) : 'Not submitted'} />
                            <DetailRow label="Submitted" value={formatDate(review.submittedAt)} />
                            <DetailRow label="Marketing Permission" value={review.marketingPermission ? 'Yes' : review.marketingPermission === false ? 'No' : '--'} />
                            <DetailRow label="Logo Permission" value={review.logoPermission ? 'Yes' : review.logoPermission === false ? 'No' : '--'} />
                            {review.nextAskAt && (
                              <DetailRow label="Follow-up" value={formatDate(review.nextAskAt)} />
                            )}
                          </div>
                        </div>

                        {/* Testimonial text */}
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)] mb-2">
                            Written Testimonial
                          </h4>
                          {review.writtenTestimonial ? (
                            <p
                              className="text-sm text-[var(--color-text)] whitespace-pre-wrap"
                              style={{
                                padding: '0.75rem',
                                background: 'var(--color-bg)',
                                borderRadius: '0.5rem',
                                border: '1px solid var(--color-border)',
                              }}
                            >
                              {review.writtenTestimonial}
                            </p>
                          ) : (
                            <p className="text-sm text-[var(--color-text-muted)] italic">No testimonial submitted yet.</p>
                          )}
                        </div>
                      </div>

                      {/* Case study draft */}
                      {review.outreachStatus === 'completed' && review.submissionId && (
                        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                          <div className="flex items-center justify-between mb-2">
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
                      <div className="flex flex-wrap gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
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

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '1rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.75rem',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide">
          {label}
        </span>
        <span style={{ color: 'var(--color-brand)' }}>{icon}</span>
      </div>
      <span className="text-2xl font-bold text-[var(--color-text)]">{value}</span>
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
