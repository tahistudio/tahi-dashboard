'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  Star, Copy,
  Send, CheckCircle2, ExternalLink, Video, Globe,
  MessageSquare, ThumbsUp, Sparkles, FileText,
  AlertCircle, ChevronDown,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { PageToolbar } from '@/components/tahi/page-toolbar'
import { EmptyState } from '@/components/tahi/empty-state'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'

// Types

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

// Constants

const STATUS_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  not_sent:    { label: 'Not sent',    tone: 'neutral'  },
  asked:       { label: 'Asked',       tone: 'info'     },
  declined:    { label: 'Declined',    tone: 'danger'   },
  deferred:    { label: 'Deferred',    tone: 'warning'  },
  in_progress: { label: 'In progress', tone: 'brand'    },
  completed:   { label: 'Completed',   tone: 'positive' },
}

const FILTER_TABS: Array<{ label: string; value: string }> = [
  { label: 'All',         value: 'all' },
  { label: 'Not sent',    value: 'not_sent' },
  { label: 'Asked',       value: 'asked' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Completed',   value: 'completed' },
  { label: 'Declined',    value: 'declined' },
  { label: 'Deferred',    value: 'deferred' },
]

const NPS_LABELS: Record<string, { label: string; color: string }> = {
  promoter:  { label: 'Promoter',  color: 'var(--color-success)' },
  passive:   { label: 'Passive',   color: 'var(--color-warning)' },
  detractor: { label: 'Detractor', color: 'var(--color-danger)' },
}

const CLUTCH_URL = 'https://clutch.co'

// Helpers

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

// Component

export function ReviewsContent() {
  const { data, isLoading: loading, mutate: mutateReviews } = useSWR<{ reviews: ReviewItem[] }>('/api/admin/reviews')
  const reviews = data?.reviews ?? []
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState<Record<string, string>>({})
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  const updateStatus = async (orgId: string, outreachStatus: string, nextAskAt?: string) => {
    setUpdatingId(orgId)
    try {
      await fetch(apiPath('/api/admin/reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, outreachStatus, nextAskAt }),
      })
      await mutateReviews()
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Reviews and testimonials"
        subtitle="Manage client outreach, collect NPS scores, testimonials, and build case studies."
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5" style={{ gap: 'var(--space-3)' }}>
        <StatCard label="Total clients"         value={totalOrgs}                                                                                                  icon={<MessageSquare className="w-5 h-5" />} />
        <StatCard label="Reviews completed"     value={completed}                                                                                                  icon={<CheckCircle2 className="w-5 h-5"  />} />
        <StatCard label="NPS score"             value={npsNet !== null ? `${npsNet > 0 ? '+' : ''}${npsNet}` : '--'} subtitle={avgNps > 0 ? `Avg: ${avgNps.toFixed(1)}` : undefined} icon={<Star className="w-5 h-5"          />} />
        <StatCard label="Marketing permission"  value={withPermission}                                                                                             icon={<ThumbsUp className="w-5 h-5"      />} />
        <StatCard label="Video testimonials"    value={withVideo}                                                                                                  icon={<Video className="w-5 h-5"         />} />
      </div>

      <Card padding="none">
        {/* Toolbar */}
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <PageToolbar>
            <PageToolbar.Search value={search} onChange={setSearch} placeholder="Search clients..." maxWidth="20rem" />
          </PageToolbar>
        </div>

        {/* Filter tabs */}
        <div
          className="flex items-end overflow-x-auto"
          style={{ borderBottom: '1px solid var(--color-border)', paddingLeft: '0.25rem', paddingRight: '1rem' }}
        >
          {FILTER_TABS.map(tab => {
            const isActive = filterStatus === tab.value
            const count = tab.value === 'all'
              ? reviews.length
              : reviews.filter(r => r.outreachStatus === tab.value).length
            return (
              <button
                key={tab.value}
                onClick={() => setFilterStatus(tab.value)}
                className="font-medium whitespace-nowrap flex-shrink-0"
                style={{
                  padding: '0.625rem 1rem',
                  fontSize: 'var(--text-sm)',
                  border: 0,
                  borderBottom: isActive ? '2px solid var(--color-brand)' : '2px solid transparent',
                  marginBottom: '-1px',
                  color: isActive ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                  background: 'transparent',
                  cursor: 'pointer',
                  transition: 'color 150ms ease, border-color 150ms ease',
                }}
              >
                {tab.label}
                <span style={{ marginLeft: '0.375rem', fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Content */}
        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<Star className="w-8 h-8" />}
            title="No reviews found"
            description={search ? 'Try a different search term.' : 'Start outreach to collect client reviews and testimonials.'}
          />
        ) : (
          <div>
            {filtered.map((review, i) => {
              const isExpanded = expandedId === review.orgId
              const cfg = STATUS_TONE[review.outreachStatus] ?? STATUS_TONE.not_sent
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
                      {review.writtenTestimonial && <ContentTag icon={<FileText style={{ width: '0.75rem', height: '0.75rem' }} />} title="Has written testimonial" />}
                      {review.videoUrl && <ContentTag icon={<Video style={{ width: '0.75rem', height: '0.75rem' }} />} title="Has video testimonial" />}
                      {review.clutchReviewUrl && <ContentTag icon={<Globe style={{ width: '0.75rem', height: '0.75rem' }} />} title="Clutch review submitted" />}
                    </div>

                    {/* Status badge */}
                    <Badge tone={cfg.tone} variant="soft" leader="dot">{cfg.label}</Badge>

                    {/* Quick actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {review.outreachStatus === 'not_sent' && (
                        <TahiButton
                          variant="ghost"
                          size="sm"
                          loading={isUpdating}
                          onClick={(e) => { e.stopPropagation(); updateStatus(review.orgId, 'asked') }}
                          iconLeft={<Send size={14} aria-hidden="true" />}
                          aria-label="Mark as asked"
                        />
                      )}
                      {review.submissionToken && (
                        <TahiButton
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); copyReviewLink(review.submissionToken) }}
                          iconLeft={copiedToken === review.submissionToken
                            ? <CheckCircle2 size={14} aria-hidden="true" style={{ color: 'var(--color-success)' }} />
                            : <Copy size={14} aria-hidden="true" />}
                          aria-label="Copy review link"
                        />
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
                          <SectionLabel>Review details</SectionLabel>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <DetailRow label="NPS score" value={review.npsScore !== null ? String(review.npsScore) : 'Not submitted'} />
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
                          <SectionLabel>Permissions granted</SectionLabel>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                            <PermissionRow label="Website use" granted={review.marketingPermission} />
                            <PermissionRow label="Logo use"    granted={review.logoPermission} />
                            <PermissionRow label="Case study"  granted={review.caseStudyPermission} />
                          </div>
                        </div>

                        {/* Feedback highlights */}
                        <div>
                          <SectionLabel>Feedback</SectionLabel>
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
                        <SectionLabel>Written testimonial</SectionLabel>
                        {review.writtenTestimonial ? (
                          <div
                            style={{
                              padding: '0.75rem',
                              background: 'var(--color-bg)',
                              borderRadius: 'var(--radius-md)',
                              border: '1px solid var(--color-border)',
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
                          <SectionLabel>Video testimonial</SectionLabel>
                          <a
                            href={review.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80"
                            style={{
                              padding: '0.5rem 0.75rem',
                              background: 'var(--color-bg)',
                              border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-md)',
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
                        <SectionLabel>Clutch review</SectionLabel>
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
                              borderRadius: 'var(--radius-md)',
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
                            <SectionLabel>Case study draft</SectionLabel>
                            <TahiButton
                              variant="primary"
                              size="sm"
                              loading={generatingDraft === review.submissionId}
                              onClick={() => generateDraft(review.submissionId as string)}
                              iconLeft={<Sparkles size={13} aria-hidden="true" />}
                            >
                              {generatingDraft === review.submissionId ? 'Generating...' : 'Generate draft'}
                            </TahiButton>
                          </div>
                          {draftContent[review.submissionId as string] && (
                            <pre
                              className="text-xs whitespace-pre-wrap"
                              style={{
                                padding: '0.75rem',
                                background: 'var(--color-bg)',
                                borderRadius: 'var(--radius-md)',
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
                      <div className="flex flex-wrap gap-2 items-center" style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
                        <span className="text-xs font-medium text-[var(--color-text-subtle)]" style={{ marginRight: '0.25rem' }}>
                          Change status:
                        </span>
                        {(['not_sent', 'asked', 'deferred', 'declined', 'in_progress', 'completed'] as const).map(s => {
                          const stCfg = STATUS_TONE[s]
                          const isActive = review.outreachStatus === s
                          return (
                            <Badge
                              key={s}
                              tone={stCfg.tone}
                              variant={isActive ? 'soft' : 'outline'}
                              size="sm"
                              leader={isActive ? 'dot' : false}
                              selected={isActive}
                              disabled={isActive || isUpdating}
                              onClick={() => {
                                if (s === 'deferred') {
                                  const nextWeek = new Date()
                                  nextWeek.setDate(nextWeek.getDate() + 7)
                                  updateStatus(review.orgId, s, nextWeek.toISOString())
                                } else {
                                  updateStatus(review.orgId, s)
                                }
                              }}
                            >
                              {stCfg.label}
                            </Badge>
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
      </Card>
    </div>
  )
}

// Sub-components

function StatCard({ label, value, icon, subtitle }: { label: string; value: string | number; icon: React.ReactNode; subtitle?: string }) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
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
    </Card>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
      {children}
    </h4>
  )
}

function ContentTag({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.5rem',
        height: '1.5rem',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-tertiary)',
        color: 'var(--color-brand)',
      }}
    >
      {icon}
    </span>
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
