'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Mail, Phone, Building2, Globe, User, Tag, ExternalLink,
  Sparkles, RefreshCw, ArrowUpRight, Trash2, Edit3,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { DiscoveryCallsCard } from '@/components/tahi/discovery-calls'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'

// ── Types (kept local; mirrors /api/admin/leads/[id] response) ───────────

interface Lead {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  jobTitle: string | null
  website: string | null
  source: string
  sourceDetail: string | null
  brief: string | null
  estimatedValue: number | null
  currency: string
  status: string
  ownerId: string | null
  ownerName?: string | null
  promotedDealId: string | null
  promotedAt: string | null
  aiScore: number | null
  aiScoreReason: string | null
  aiSummary: string | null
  aiSources: string | null
  aiQuestions: string | null
  aiSignals: string | null
  enrichedAt: string | null
  lastAiRunAt: string | null
  aiTokensSpent: number | null
  createdAt: string
  updatedAt: string
}

interface LeadActivity {
  id: string
  type: string
  title: string
  description: string | null
  createdAt: string
  authorName: string | null
}

const STATUS_TONES: Record<string, BadgeTone> = {
  new: 'info',
  qualifying: 'brand',
  nurturing: 'warning',
  promoted: 'positive',
  archived: 'neutral',
}

function relTime(input: string | null | undefined): string | null {
  if (!input) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) return null
  return formatDistanceToNow(d, { addSuffix: true })
}

function safeJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as T[] : [] }
  catch { return [] }
}

function normaliseUrl(input: string | null | undefined): string {
  if (!input) return '#'
  const t = input.trim()
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

// ── Main page content ─────────────────────────────────────────────────────

export function LeadPageContent({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [discoveryTemplate, setDiscoveryTemplate] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [enriching, setEnriching] = useState(false)
  const [enrichError, setEnrichError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [pendingPromote, setPendingPromote] = useState(false)
  const [promoting, setPromoting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`/api/admin/leads/${leadId}`))
      if (!res.ok) {
        setLead(null)
        return
      }
      const data = await res.json() as {
        lead: Lead
        activities?: LeadActivity[]
        discoveryQuestionsTemplate?: string[]
      }
      setLead(data.lead)
      setActivities(data.activities ?? [])
      setDiscoveryTemplate(data.discoveryQuestionsTemplate ?? [])
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => { void load() }, [load])

  async function runEnrich() {
    if (!lead) return
    setEnriching(true)
    setEnrichError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/leads/${lead.id}/enrich`), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail ?? err.error ?? 'Enrichment failed')
      }
      await load()
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Enrichment failed')
    } finally {
      setEnriching(false)
    }
  }

  async function confirmDelete() {
    if (!lead) return
    try {
      await fetch(apiPath(`/api/admin/leads/${lead.id}`), { method: 'DELETE' })
      router.push('/leads')
    } catch {
      // ignore
    }
  }

  async function confirmPromote() {
    if (!lead) return
    setPromoting(true)
    try {
      const res = await fetch(apiPath(`/api/admin/leads/${lead.id}/promote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createOrg: true }),
      })
      if (res.ok) {
        const data = await res.json() as { dealId?: string }
        if (data.dealId) router.push(`/deals?deal=${data.dealId}`)
      }
    } finally {
      setPromoting(false)
      setPendingPromote(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-subtle)', fontSize: 'var(--text-sm)' }}>
        Loading lead...
      </div>
    )
  }

  if (!lead) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Lead not found.{' '}
          <Link href="/leads" style={{ color: 'var(--color-text-active)', textDecoration: 'underline' }}>
            Back to leads
          </Link>
        </p>
      </div>
    )
  }

  const aiSources = safeJsonArray<string>(lead.aiSources)
  const aiQuestions = safeJsonArray<{ text: string; rationale?: string } | string>(lead.aiQuestions)
    .map(q => typeof q === 'string' ? { text: q } : q)
  let aiSignals: Record<string, string | undefined> = {}
  if (lead.aiSignals) {
    try {
      const p = JSON.parse(lead.aiSignals)
      if (p && typeof p === 'object') aiSignals = p as Record<string, string>
    } catch { /* ignore */ }
  }
  const scoreTone: BadgeTone =
    lead.aiScore == null ? 'neutral'
    : lead.aiScore >= 80 ? 'positive'
    : lead.aiScore >= 60 ? 'brand'
    : lead.aiScore >= 40 ? 'warning'
    : 'neutral'

  return (
    <div style={{ padding: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '72rem' }}>
      <Breadcrumb
        items={[
          { label: 'Leads', href: '/leads' },
          { label: lead.name },
        ]}
      />

      {/* Hero */}
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '16rem' }}>
          <h1 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            letterSpacing: '-0.015em',
          }}>{lead.name}</h1>
          <div style={{ marginTop: '0.4375rem', display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
            <Badge tone={STATUS_TONES[lead.status] ?? 'neutral'} variant="soft" size="sm" dot={false}>
              {lead.status}
            </Badge>
            {lead.aiScore != null && (
              <Badge tone={scoreTone} variant="soft" size="sm" dot={false}>
                Score {lead.aiScore}
              </Badge>
            )}
            {lead.company && (
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                {lead.company}
              </span>
            )}
            {relTime(lead.updatedAt) && (
              <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                Updated {relTime(lead.updatedAt)}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.4375rem', flexWrap: 'wrap' }}>
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/leads?lead=${lead.id}`)}
            iconLeft={<Edit3 className="w-3.5 h-3.5" />}
          >
            Edit
          </TahiButton>
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => { void runEnrich() }}
            disabled={enriching}
            iconLeft={enriching
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
          >
            {enriching ? 'Researching...' : (lead.enrichedAt ? 'Re-run AI' : 'Run AI')}
          </TahiButton>
          {lead.status !== 'promoted' && (
            <TahiButton
              size="sm"
              onClick={() => setPendingPromote(true)}
              iconLeft={<ArrowUpRight className="w-3.5 h-3.5" />}
            >
              Promote to deal
            </TahiButton>
          )}
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => setPendingDelete(true)}
            iconLeft={<Trash2 className="w-3.5 h-3.5" />}
          >
            Delete
          </TahiButton>
        </div>
      </header>

      {enrichError && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--color-danger-bg)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.75rem',
          color: 'var(--color-danger)',
        }}>{enrichError}</div>
      )}

      {/* Two-column layout: main on left, sidebar on right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1rem' }} className="lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* MAIN COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* AI briefing — only when enriched */}
          {lead.enrichedAt && (
            <PageCard title="AI briefing">
              {lead.aiScoreReason && (
                <p style={{
                  margin: '0 0 0.625rem', fontSize: '0.8125rem',
                  color: 'var(--color-text-muted)', fontStyle: 'italic', lineHeight: 1.55,
                }}>{lead.aiScoreReason}</p>
              )}
              {lead.aiSummary && <BriefingBody raw={lead.aiSummary} />}
              {Object.keys(aiSignals).length > 0 && (
                <div style={{ marginTop: '0.875rem' }}>
                  <SubLabel>Company signals</SubLabel>
                  <SignalsList signals={aiSignals} />
                </div>
              )}
              {aiSources.length > 0 && (
                <div style={{ marginTop: '0.875rem' }}>
                  <SubLabel>Sources ({aiSources.length})</SubLabel>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {aiSources.map((src, i) => (
                      <li key={i} style={{ fontSize: '0.75rem' }}>
                        <a
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3125rem',
                            color: 'var(--color-text-active)',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                            textDecorationColor: 'var(--color-brand-100)',
                            wordBreak: 'break-all',
                          }}
                        >
                          <ExternalLink size={11} />
                          {src}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </PageCard>
          )}

          {/* Discovery questions — show whenever the always-ask
              template exists (universal, not AI-dependent) */}
          {(discoveryTemplate.length > 0 || aiQuestions.length > 0) && (
            <PageCard title="Discovery call">
              {discoveryTemplate.length > 0 && (
                <div>
                  <SubLabel>Always ask</SubLabel>
                  <NumberedList items={discoveryTemplate.map(t => ({ text: t }))} />
                </div>
              )}
              {discoveryTemplate.length > 0 && aiQuestions.length > 0 && (
                <div style={{ borderTop: '1px solid var(--color-border-subtle)', margin: '0.875rem 0' }} />
              )}
              {aiQuestions.length > 0 && (
                <div>
                  <SubLabel>For this lead</SubLabel>
                  <NumberedList items={aiQuestions} />
                </div>
              )}
            </PageCard>
          )}

          {/* Calls — full polymorphic component */}
          <DiscoveryCallsCard
            parentType="lead"
            parentId={lead.id}
            parentAlreadyPromoted={!!lead.promotedDealId}
            onChanged={load}
          />

          {/* Activity timeline */}
          {activities.length > 0 && (
            <PageCard title="Activity">
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {[...activities].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).map(a => {
                  const isSystem = a.type === 'lead_enriched' || a.type === 'lead_status_changed' && !a.authorName
                  return (
                    <li key={a.id} style={{ display: 'flex', gap: '0.5625rem', alignItems: 'flex-start' }}>
                      <span style={{
                        flexShrink: 0,
                        marginTop: '0.4375rem',
                        width: '0.4375rem',
                        height: '0.4375rem',
                        borderRadius: '50%',
                        background: isSystem ? 'var(--color-brand)' : 'var(--color-text-subtle)',
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{a.title}</div>
                        {a.description && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                            {a.description}
                          </div>
                        )}
                        <div style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', marginTop: '0.1875rem' }}>
                          {isSystem ? 'AI' : (a.authorName ?? 'Tahi')}
                          {relTime(a.createdAt) ? ` · ${relTime(a.createdAt)}` : ''}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </PageCard>
          )}
        </div>

        {/* SIDEBAR */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <PageCard title="Contact">
            <DetailGrid>
              {lead.email && <DetailRow icon={<Mail size={12} />} label="Email" value={
                <a href={`mailto:${lead.email}`} style={{ color: 'var(--color-text-active)', textDecoration: 'underline' }}>{lead.email}</a>
              } />}
              {lead.phone && <DetailRow icon={<Phone size={12} />} label="Phone" value={lead.phone} />}
              {lead.jobTitle && <DetailRow icon={<User size={12} />} label="Role" value={lead.jobTitle} />}
              {lead.company && <DetailRow icon={<Building2 size={12} />} label="Company" value={lead.company} />}
              {lead.website && (
                <DetailRow icon={<Globe size={12} />} label="Website" value={
                  <a href={normaliseUrl(lead.website)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-active)', textDecoration: 'underline', wordBreak: 'break-all' }}>{lead.website}</a>
                } />
              )}
              {lead.ownerName && <DetailRow icon={<User size={12} />} label="Owner" value={lead.ownerName} />}
              <DetailRow icon={<Tag size={12} />} label="Source" value={`${lead.source}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ''}`} />
              {lead.estimatedValue != null && (
                <DetailRow icon={<Tag size={12} />} label="Estimate" value={`${lead.estimatedValue.toLocaleString()} ${lead.currency}`} />
              )}
            </DetailGrid>
          </PageCard>

          {lead.brief && (
            <PageCard title="Brief">
              <p style={{
                margin: 0,
                fontSize: '0.8125rem',
                color: 'var(--color-text)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}>{lead.brief}</p>
            </PageCard>
          )}

          {lead.promotedDealId && (
            <div style={{
              padding: '0.625rem 0.75rem',
              background: 'var(--color-brand-50)',
              border: '1px solid var(--color-brand-100)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--color-text)',
            }}>
              ✓ Promoted to deal{relTime(lead.promotedAt) ? ` ${relTime(lead.promotedAt)}` : ''}.{' '}
              <Link href={`/deals?deal=${lead.promotedDealId}`} style={{ fontWeight: 600, color: 'var(--color-brand-dark)', textDecoration: 'underline' }}>
                Open deal
              </Link>
            </div>
          )}

          {lead.aiTokensSpent != null && lead.aiTokensSpent > 0 && (
            <p style={{ margin: 0, fontSize: '0.625rem', color: 'var(--color-text-subtle)', textAlign: 'right' }}>
              {lead.aiTokensSpent.toLocaleString()} tokens spent on AI
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title={`Delete "${lead.name}"?`}
        description="This removes the lead row. The canonical person record is kept."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(false)}
      />

      <ConfirmDialog
        open={pendingPromote}
        title={`Promote "${lead.name}" to a deal?`}
        description={`A new ${lead.company ? `organisation (${lead.company})` : 'organisation'} + contact + deal will be created in the pipeline.`}
        confirmLabel={promoting ? 'Promoting...' : 'Promote to deal'}
        variant="primary"
        onConfirm={confirmPromote}
        onCancel={() => setPendingPromote(false)}
      />
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────

function PageCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      padding: '0.875rem 1rem',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-card)',
    }}>
      <div style={{
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.625rem',
      }}>{title}</div>
      {children}
    </section>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.5625rem',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--color-text-subtle)',
      marginBottom: '0.375rem',
    }}>{children}</div>
  )
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl style={{
      margin: 0,
      display: 'grid',
      gridTemplateColumns: 'minmax(5.5rem, max-content) 1fr',
      gap: '0.3125rem 0.625rem',
      fontSize: 'var(--text-sm)',
    }}>{children}</dl>
  )
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <>
      <dt style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3125rem',
        color: 'var(--color-text-muted)',
        fontSize: '0.75rem',
      }}>
        <span style={{ color: 'var(--color-text-subtle)' }}>{icon}</span>
        {label}
      </dt>
      <dd style={{ margin: 0, color: 'var(--color-text)', fontSize: '0.8125rem', wordBreak: 'break-word' }}>{value}</dd>
    </>
  )
}

function NumberedList({ items }: { items: Array<{ text: string; rationale?: string }> }) {
  return (
    <ol style={{
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.6875rem',
    }}>
      {items.map((q, i) => (
        <li
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1.25rem 1fr',
            gap: '0.4375rem',
            alignItems: 'baseline',
          }}
        >
          <span style={{
            color: 'var(--color-text-subtle)',
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}>{i + 1}.</span>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.5 }}>{q.text}</div>
            {q.rationale && (
              <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: '0.1875rem' }}>
                {q.rationale}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function BriefingBody({ raw }: { raw: string }) {
  let parsed: { snapshot?: string; fit?: string; watchOuts?: string } | null = null
  try {
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && (p.snapshot || p.fit || p.watchOuts)) parsed = p
  } catch { /* not JSON — fall through */ }

  if (!parsed) {
    return (
      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {raw}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {parsed.snapshot && <BriefBlock label="Snapshot" body={parsed.snapshot} />}
      {parsed.fit && <BriefBlock label="Why they might fit" body={parsed.fit} />}
      {parsed.watchOuts && <BriefBlock label="Watch-outs" body={parsed.watchOuts} />}
    </div>
  )
}

function BriefBlock({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <SubLabel>{label}</SubLabel>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.55 }}>{body}</p>
    </div>
  )
}

function SignalsList({ signals }: { signals: Record<string, string | undefined> }) {
  const rows: Array<[string, string, string | undefined]> = [
    ['Team',            signals.employeeCount     ?? '', signals.employeeCountSource],
    ['Funding',         [signals.fundingRaised, signals.fundingStage ? `(${signals.fundingStage})` : ''].filter(Boolean).join(' '), signals.fundingSource],
    ['Revenue',         signals.revenueEstimate   ?? '', signals.revenueSource],
    ['Pricing',         signals.pricingVisible    ?? '', signals.pricingSource],
    ['Customers',       signals.customerCount     ?? '', signals.customerSource],
    ['Tech',            signals.siteTechStack     ?? '', signals.siteTechSource],
    ['Decision-maker',  [signals.decisionMaker, signals.decisionMakerConfidence ? `· ${signals.decisionMakerConfidence} confidence` : ''].filter(Boolean).join(' '), undefined],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4375rem' }}>
      {rows.filter(r => r[1]).map(([label, value, source]) => (
        <div key={label} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', alignItems: 'flex-start' }}>
          <span style={{ width: '6rem', flexShrink: 0, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
          <span style={{ flex: 1, color: 'var(--color-text)' }}>
            {value}
            {source && (
              <>
                {' '}
                <a href={source} target="_blank" rel="noopener noreferrer" aria-label={`Source for ${label}`}
                  style={{ display: 'inline-flex', color: 'var(--color-text-subtle)', verticalAlign: 'baseline', marginLeft: '0.125rem' }}>
                  <ExternalLink size={10} />
                </a>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
