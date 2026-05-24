'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Mail, Phone, Building2, Globe, User, Tag, ExternalLink,
  Sparkles, RefreshCw, ArrowUpRight, Trash2, Edit3, Save, X,
  Linkedin, Users, DollarSign, Eye, MapPin, Calendar, Send,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { Input } from '@/components/tahi/input'
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
  // 0047 firmographics
  industry: string | null
  employeeCount: number | null
  revenueBand: string | null
  monthlyVisits: number | null
  leadType: string | null
  linkedinUrl: string | null
  linkedinPersonalUrl: string | null
  techStack: string | null
  cms: string | null
  country: string | null
  yearFounded: number | null
  // AI columns
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

interface PendingReplyDraft {
  id: string
  aiDraftSubject: string | null
  aiDraftBody: string
  finalSubject: string | null
  finalBody: string | null
  status: 'pending' | 'sent' | 'dismissed'
  tokensSpent: number | null
  createdAt: string
}

/** Draft mirrors Lead but numeric fields are strings (form inputs). */
interface LeadDraft {
  name: string
  email: string
  phone: string
  jobTitle: string
  linkedinPersonalUrl: string
  company: string
  website: string
  industry: string
  employeeCount: string
  revenueBand: string
  monthlyVisits: string
  leadType: string
  linkedinUrl: string
  country: string
  yearFounded: string
  techStack: string
  cms: string
  brief: string
  ownerId: string
  status: string
}

interface TeamMemberLite {
  id: string
  name: string
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

function toDraft(lead: Lead): LeadDraft {
  return {
    name: lead.name ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    jobTitle: lead.jobTitle ?? '',
    linkedinPersonalUrl: lead.linkedinPersonalUrl ?? '',
    company: lead.company ?? '',
    website: lead.website ?? '',
    industry: lead.industry ?? '',
    employeeCount: lead.employeeCount != null ? String(lead.employeeCount) : '',
    revenueBand: lead.revenueBand ?? '',
    monthlyVisits: lead.monthlyVisits != null ? String(lead.monthlyVisits) : '',
    leadType: lead.leadType ?? '',
    linkedinUrl: lead.linkedinUrl ?? '',
    country: lead.country ?? '',
    yearFounded: lead.yearFounded != null ? String(lead.yearFounded) : '',
    techStack: safeJsonArray<string>(lead.techStack).join(', '),
    cms: lead.cms ?? '',
    brief: lead.brief ?? '',
    ownerId: lead.ownerId ?? '',
    status: lead.status,
  }
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
  // Edit-in-place state
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<LeadDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Team members for owner dropdown
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([])
  // Activity composer state
  const [newActivityNote, setNewActivityNote] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  // AI reply draft state
  const [replyDraft, setReplyDraft] = useState<PendingReplyDraft | null>(null)
  const [draftingReply, setDraftingReply] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  // Editable working copy of the AI draft (so the user can tweak before send).
  const [replySubjectEdit, setReplySubjectEdit] = useState('')
  const [replyBodyEdit, setReplyBodyEdit] = useState('')

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
        pendingReplyDraft?: PendingReplyDraft | null
      }
      setLead(data.lead)
      setActivities(data.activities ?? [])
      setDiscoveryTemplate(data.discoveryQuestionsTemplate ?? [])
      const pending = data.pendingReplyDraft ?? null
      setReplyDraft(pending)
      if (pending) {
        setReplySubjectEdit(pending.finalSubject ?? pending.aiDraftSubject ?? '')
        setReplyBodyEdit(pending.finalBody ?? pending.aiDraftBody)
      } else {
        setReplySubjectEdit('')
        setReplyBodyEdit('')
      }
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => { void load() }, [load])

  // Team members for owner dropdown — fetch once
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(apiPath('/api/admin/team-members'))
        if (!res.ok) return
        const data = await res.json() as { items?: TeamMemberLite[]; members?: TeamMemberLite[] }
        const items = data.items ?? data.members ?? []
        setTeamMembers(items.filter(m => m && m.id && m.name))
      } catch { /* ignore */ }
    })()
  }, [])

  async function saveActivity() {
    if (!lead || !newActivityNote.trim()) return
    setSavingActivity(true)
    setActivityError(null)
    try {
      const res = await fetch(apiPath('/api/admin/activities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'note',
          title: newActivityNote.trim().slice(0, 80),
          description: newActivityNote.trim().length > 80 ? newActivityNote.trim() : null,
          leadId: lead.id,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to save note')
      }
      setNewActivityNote('')
      await load()
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : 'Failed to save note')
    } finally {
      setSavingActivity(false)
    }
  }

  async function quickPatchLead(updates: Record<string, unknown>) {
    if (!lead) return
    try {
      await fetch(apiPath(`/api/admin/leads/${lead.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      await load()
    } catch {
      // ignore — UI will show stale state until next refresh
    }
  }

  function startEdit() {
    if (!lead) return
    setDraft(toDraft(lead))
    setEditing(true)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(null)
    setSaveError(null)
  }

  async function saveEdit() {
    if (!lead || !draft) return
    setSaving(true)
    setSaveError(null)
    try {
      // Build PATCH body. Empty strings become null; numeric strings
      // get parsed; techStack splits on commas.
      const techArr = draft.techStack
        .split(',').map(s => s.trim()).filter(Boolean)
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        jobTitle: draft.jobTitle.trim() || null,
        linkedinPersonalUrl: draft.linkedinPersonalUrl.trim() || null,
        company: draft.company.trim() || null,
        website: draft.website.trim() || null,
        industry: draft.industry.trim() || null,
        employeeCount: draft.employeeCount.trim()
          ? parseInt(draft.employeeCount.replace(/[^0-9]/g, ''), 10) || null
          : null,
        revenueBand: draft.revenueBand.trim() || null,
        monthlyVisits: draft.monthlyVisits.trim()
          ? parseInt(draft.monthlyVisits.replace(/[^0-9]/g, ''), 10) || null
          : null,
        leadType: draft.leadType.trim() || null,
        linkedinUrl: draft.linkedinUrl.trim() || null,
        country: draft.country.trim() || null,
        yearFounded: draft.yearFounded.trim()
          ? parseInt(draft.yearFounded.replace(/[^0-9]/g, ''), 10) || null
          : null,
        techStack: techArr,
        cms: draft.cms.trim() || null,
        brief: draft.brief.trim() || null,
      }
      const res = await fetch(apiPath(`/api/admin/leads/${lead.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Save failed')
      }
      await load()
      setEditing(false)
      setDraft(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function generateReplyDraft() {
    if (!lead) return
    setDraftingReply(true)
    setReplyError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/leads/${lead.id}/draft-reply`), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail ?? err.error ?? 'Draft generation failed')
      }
      await load()
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Draft generation failed')
    } finally {
      setDraftingReply(false)
    }
  }

  async function sendReplyDraft() {
    if (!replyDraft) return
    setSendingReply(true)
    setReplyError(null)
    try {
      // Persist edits first (only if changed from current saved state)
      const subjectChanged = replySubjectEdit !== (replyDraft.finalSubject ?? replyDraft.aiDraftSubject ?? '')
      const bodyChanged = replyBodyEdit !== (replyDraft.finalBody ?? replyDraft.aiDraftBody)
      if (subjectChanged || bodyChanged) {
        await fetch(apiPath(`/api/admin/ai-reply-drafts/${replyDraft.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalSubject: replySubjectEdit, finalBody: replyBodyEdit }),
        })
      }
      const res = await fetch(apiPath(`/api/admin/ai-reply-drafts/${replyDraft.id}/send`), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail ?? err.error ?? 'Send failed')
      }
      await load()
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSendingReply(false)
    }
  }

  async function dismissReplyDraft() {
    if (!replyDraft) return
    try {
      await fetch(apiPath(`/api/admin/ai-reply-drafts/${replyDraft.id}`), { method: 'DELETE' })
      await load()
    } catch {
      // ignore
    }
  }

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
  const techStack = safeJsonArray<string>(lead.techStack)
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
    <div style={{ padding: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '88rem' }}>
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
            {/* Status quick-picker (always editable, no edit-mode required) */}
            <select
              value={lead.status}
              onChange={e => { void quickPatchLead({ status: e.target.value }) }}
              aria-label="Lead status"
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                padding: '0.1875rem 0.5rem 0.1875rem 0.4375rem',
                borderRadius: '9999px',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              <option value="new">new</option>
              <option value="qualifying">qualifying</option>
              <option value="nurturing">nurturing</option>
              <option value="promoted">promoted</option>
              <option value="archived">archived</option>
            </select>
            {lead.aiScore != null && (
              <Badge tone={scoreTone} variant="soft" size="sm" dot={false}>
                Score {lead.aiScore}
              </Badge>
            )}
            {/* Owner quick-picker (always editable). Falls back to a
                read-only label until the team-members list arrives. */}
            {teamMembers.length > 0 ? (
              <select
                value={lead.ownerId ?? ''}
                onChange={e => { void quickPatchLead({ ownerId: e.target.value || null }) }}
                aria-label="Lead owner"
                style={{
                  fontSize: '0.6875rem',
                  padding: '0.1875rem 0.5rem',
                  borderRadius: '9999px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                <option value="">Unassigned</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            ) : lead.ownerName ? (
              <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                Owner: {lead.ownerName}
              </span>
            ) : null}
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
          {editing ? (
            <>
              <TahiButton
                size="sm"
                onClick={() => { void saveEdit() }}
                disabled={saving}
                iconLeft={saving
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <Save className="w-3.5 h-3.5" />}
              >
                {saving ? 'Saving...' : 'Save'}
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={cancelEdit}
                disabled={saving}
                iconLeft={<X className="w-3.5 h-3.5" />}
              >
                Cancel
              </TahiButton>
            </>
          ) : (
            <>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={startEdit}
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
            </>
          )}
        </div>
      </header>

      {saveError && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--color-danger-bg)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.75rem',
          color: 'var(--color-danger)',
        }}>{saveError}</div>
      )}

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
          {!editing && lead.enrichedAt && (
            <PageCard title="AI briefing">
              <ScoreHistorySparkline activities={activities} currentScore={lead.aiScore} />
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

          {/* AI reply draft — only shown when the lead has an email
              (otherwise there's nowhere to send the reply) */}
          {!editing && lead.email && (
            <PageCard title="AI first reply">
              {!replyDraft ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{
                    margin: 0,
                    fontSize: '0.8125rem',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.55,
                  }}>
                    Generate a personalised first reply to {lead.email}. The draft uses lead context, AI briefing, and your past edits as tone examples.
                  </p>
                  <div>
                    <TahiButton
                      size="sm"
                      onClick={() => { void generateReplyDraft() }}
                      disabled={draftingReply}
                      iconLeft={draftingReply
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <Sparkles className="w-3.5 h-3.5" />}
                    >
                      {draftingReply ? 'Drafting...' : 'Draft a reply'}
                    </TahiButton>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <label style={{
                      fontSize: '0.625rem',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-subtle)',
                    }}>Subject</label>
                    <Input
                      value={replySubjectEdit}
                      onChange={e => setReplySubjectEdit(e.target.value)}
                      placeholder="(no subject)"
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <label style={{
                      fontSize: '0.625rem',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-subtle)',
                    }}>Body</label>
                    <textarea
                      value={replyBodyEdit}
                      onChange={e => setReplyBodyEdit(e.target.value)}
                      rows={10}
                      style={{
                        width: '100%',
                        fontSize: '0.8125rem',
                        fontFamily: 'inherit',
                        color: 'var(--color-text)',
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        padding: '0.5rem 0.625rem',
                        lineHeight: 1.55,
                        resize: 'vertical',
                      }}
                    />
                  </div>
                  {replyError && (
                    <div style={{
                      padding: '0.5rem 0.75rem',
                      background: 'var(--color-danger-bg)',
                      border: '1px solid var(--color-danger)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.75rem',
                      color: 'var(--color-danger)',
                    }}>{replyError}</div>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <TahiButton
                      size="sm"
                      onClick={() => { void sendReplyDraft() }}
                      disabled={sendingReply || !replyBodyEdit.trim()}
                      iconLeft={sendingReply
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <Send className="w-3.5 h-3.5" />}
                    >
                      {sendingReply ? 'Sending...' : `Send to ${lead.email}`}
                    </TahiButton>
                    <TahiButton
                      variant="secondary"
                      size="sm"
                      onClick={() => { void generateReplyDraft() }}
                      disabled={draftingReply}
                      iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
                    >
                      Regenerate
                    </TahiButton>
                    <TahiButton
                      variant="secondary"
                      size="sm"
                      onClick={() => { void dismissReplyDraft() }}
                      iconLeft={<X className="w-3.5 h-3.5" />}
                    >
                      Dismiss
                    </TahiButton>
                    {replyDraft.tokensSpent != null && replyDraft.tokensSpent > 0 && (
                      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', marginLeft: 'auto' }}>
                        {replyDraft.tokensSpent.toLocaleString()} tokens
                      </span>
                    )}
                  </div>
                </div>
              )}
            </PageCard>
          )}

          {/* Discovery questions */}
          {!editing && (discoveryTemplate.length > 0 || aiQuestions.length > 0) && (
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

          {/* Calls */}
          {!editing && (
            <DiscoveryCallsCard
              parentType="lead"
              parentId={lead.id}
              parentAlreadyPromoted={!!lead.promotedDealId}
              onChanged={load}
            />
          )}

          {/* Activity composer + timeline */}
          {!editing && (
            <PageCard title="Activity">
              {/* Compose a note */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: activities.length > 0 ? '0.875rem' : 0 }}>
                <textarea
                  value={newActivityNote}
                  onChange={e => setNewActivityNote(e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      void saveActivity()
                    }
                  }}
                  placeholder="Log a note (Cmd/Ctrl+Enter to save)…"
                  rows={2}
                  style={{
                    flex: 1,
                    fontSize: '0.8125rem',
                    fontFamily: 'inherit',
                    color: 'var(--color-text)',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.4375rem 0.5625rem',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    minHeight: '2.5rem',
                  }}
                />
                <TahiButton
                  size="sm"
                  onClick={() => { void saveActivity() }}
                  disabled={savingActivity || !newActivityNote.trim()}
                >
                  {savingActivity ? 'Saving…' : 'Log'}
                </TahiButton>
              </div>
              {activityError && (
                <div style={{
                  padding: '0.4375rem 0.625rem',
                  marginBottom: '0.625rem',
                  background: 'var(--color-danger-bg)',
                  border: '1px solid var(--color-danger)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.75rem',
                  color: 'var(--color-danger)',
                }}>{activityError}</div>
              )}
              {activities.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                  No activity yet. Log a note above, or any AI/manual action will show up here.
                </p>
              ) : null}
            </PageCard>
          )}

          {/* Activity timeline */}
          {!editing && activities.length > 0 && (
            <PageCard title="Timeline">
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {[...activities].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).map(a => {
                  const isSystem = a.type === 'lead_enriched' || (a.type === 'lead_status_changed' && !a.authorName)
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
          {/* Person card */}
          <PageCard title="Person">
            {editing && draft ? (
              <EditGrid>
                <EditRow label="Name" value={draft.name} onChange={v => setDraft({ ...draft, name: v })} />
                <EditRow label="Email" value={draft.email} onChange={v => setDraft({ ...draft, email: v })} type="email" />
                <EditRow label="Phone" value={draft.phone} onChange={v => setDraft({ ...draft, phone: v })} type="tel" />
                <EditRow label="Role" value={draft.jobTitle} onChange={v => setDraft({ ...draft, jobTitle: v })} />
                <EditRow label="Personal LinkedIn" value={draft.linkedinPersonalUrl} onChange={v => setDraft({ ...draft, linkedinPersonalUrl: v })} placeholder="https://linkedin.com/in/..." />
              </EditGrid>
            ) : (
              <DetailGrid>
                {lead.email && <DetailRow icon={<Mail size={12} />} label="Email" value={
                  <a href={`mailto:${lead.email}`} style={{ color: 'var(--color-text-active)', textDecoration: 'underline' }}>{lead.email}</a>
                } />}
                {lead.phone && <DetailRow icon={<Phone size={12} />} label="Phone" value={lead.phone} />}
                {lead.jobTitle && <DetailRow icon={<User size={12} />} label="Role" value={lead.jobTitle} />}
                {lead.linkedinPersonalUrl && (
                  <DetailRow icon={<Linkedin size={12} />} label="LinkedIn" value={
                    <a href={normaliseUrl(lead.linkedinPersonalUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-active)', textDecoration: 'underline', wordBreak: 'break-all' }}>
                      Profile <ExternalLink size={10} style={{ display: 'inline', verticalAlign: 'baseline' }} />
                    </a>
                  } />
                )}
                {lead.ownerName && <DetailRow icon={<User size={12} />} label="Owner" value={lead.ownerName} />}
              </DetailGrid>
            )}
          </PageCard>

          {/* Company card */}
          <PageCard title="Company">
            {editing && draft ? (
              <EditGrid>
                <EditRow label="Company" value={draft.company} onChange={v => setDraft({ ...draft, company: v })} />
                <EditRow label="Website" value={draft.website} onChange={v => setDraft({ ...draft, website: v })} placeholder="https://" />
                <EditRow label="CMS / builder" value={draft.cms} onChange={v => setDraft({ ...draft, cms: v })} placeholder="Webflow, WordPress, Framer..." />
                <EditRow label="Company LinkedIn" value={draft.linkedinUrl} onChange={v => setDraft({ ...draft, linkedinUrl: v })} placeholder="https://linkedin.com/company/..." />
                <EditRow label="Industry" value={draft.industry} onChange={v => setDraft({ ...draft, industry: v })} />
                <EditRow label="Country" value={draft.country} onChange={v => setDraft({ ...draft, country: v })} />
                <EditRow label="Type" value={draft.leadType} onChange={v => setDraft({ ...draft, leadType: v })} placeholder="Prospect" />
                <EditRow label="Employees" value={draft.employeeCount} onChange={v => setDraft({ ...draft, employeeCount: v })} type="number" />
                <EditRow label="Revenue" value={draft.revenueBand} onChange={v => setDraft({ ...draft, revenueBand: v })} placeholder="$10M - $50M" />
                <EditRow label="Year founded" value={draft.yearFounded} onChange={v => setDraft({ ...draft, yearFounded: v })} type="number" />
                <EditRow label="Page views/mo" value={draft.monthlyVisits} onChange={v => setDraft({ ...draft, monthlyVisits: v })} type="number" />
                <EditRow label="Tech stack" value={draft.techStack} onChange={v => setDraft({ ...draft, techStack: v })} placeholder="Webflow, HubSpot, GA" />
              </EditGrid>
            ) : (
              <DetailGrid>
                {lead.company && <DetailRow icon={<Building2 size={12} />} label="Name" value={lead.company} />}
                {lead.website && (
                  <DetailRow icon={<Globe size={12} />} label="Website" value={
                    <a href={normaliseUrl(lead.website)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-active)', textDecoration: 'underline', wordBreak: 'break-all' }}>{lead.website}</a>
                  } />
                )}
                {lead.linkedinUrl && (
                  <DetailRow icon={<Linkedin size={12} />} label="LinkedIn" value={
                    <a href={normaliseUrl(lead.linkedinUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-active)', textDecoration: 'underline', wordBreak: 'break-all' }}>
                      Profile <ExternalLink size={10} style={{ display: 'inline', verticalAlign: 'baseline' }} />
                    </a>
                  } />
                )}
                {lead.cms && (
                  <DetailRow icon={<Globe size={12} />} label="CMS" value={
                    <Badge tone="brand" variant="soft" size="sm" dot={false}>{lead.cms}</Badge>
                  } />
                )}
                {lead.industry && <DetailRow icon={<Tag size={12} />} label="Industry" value={lead.industry} />}
                {lead.country && <DetailRow icon={<MapPin size={12} />} label="Country" value={lead.country} />}
                {lead.leadType && <DetailRow icon={<Tag size={12} />} label="Type" value={lead.leadType} />}
                {lead.employeeCount != null && <DetailRow icon={<Users size={12} />} label="Employees" value={lead.employeeCount.toLocaleString()} />}
                {lead.revenueBand && <DetailRow icon={<DollarSign size={12} />} label="Revenue" value={lead.revenueBand} />}
                {lead.yearFounded != null && <DetailRow icon={<Calendar size={12} />} label="Founded" value={String(lead.yearFounded)} />}
                {lead.monthlyVisits != null && <DetailRow icon={<Eye size={12} />} label="Page views" value={`${lead.monthlyVisits.toLocaleString()}/mo`} />}
                {techStack.length > 0 && (
                  <DetailRow icon={<Tag size={12} />} label="Tech" value={
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {techStack.map(t => (
                        <Badge key={t} tone="brand" variant="soft" size="sm" dot={false}>{t}</Badge>
                      ))}
                    </div>
                  } />
                )}
                {!lead.company && !lead.website && !lead.industry && !lead.cms && !lead.country && !lead.employeeCount && techStack.length === 0 && (
                  <DetailRow icon={<Building2 size={12} />} label="" value={
                    <span style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>No company details yet. Run AI to enrich.</span>
                  } />
                )}
              </DetailGrid>
            )}
          </PageCard>

          {/* Source */}
          {!editing && (
            <PageCard title="Source">
              <DetailGrid>
                <DetailRow icon={<Tag size={12} />} label="Source" value={`${lead.source}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ''}`} />
                {lead.estimatedValue != null && (
                  <DetailRow icon={<DollarSign size={12} />} label="Estimate" value={`${lead.estimatedValue.toLocaleString()} ${lead.currency}`} />
                )}
              </DetailGrid>
            </PageCard>
          )}

          {/* Brief — full-width textarea in edit mode, prose in view mode */}
          {editing && draft ? (
            <PageCard title="Brief / notes">
              <textarea
                value={draft.brief}
                onChange={e => setDraft({ ...draft, brief: e.target.value })}
                rows={6}
                placeholder="Anything we know about this lead beyond the structured fields above."
                style={{
                  width: '100%',
                  fontSize: '0.8125rem',
                  fontFamily: 'inherit',
                  color: 'var(--color-text)',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.5rem 0.625rem',
                  lineHeight: 1.55,
                  resize: 'vertical',
                }}
              />
            </PageCard>
          ) : (
            lead.brief && (
              <PageCard title="Brief">
                <p style={{
                  margin: 0,
                  fontSize: '0.8125rem',
                  color: 'var(--color-text)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}>{lead.brief}</p>
              </PageCard>
            )
          )}

          {!editing && lead.promotedDealId && (
            <div style={{
              padding: '0.625rem 0.75rem',
              background: 'var(--color-brand-50)',
              border: '1px solid var(--color-brand-100)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--color-text)',
            }}>
              Promoted to deal{relTime(lead.promotedAt) ? ` ${relTime(lead.promotedAt)}` : ''}.{' '}
              <Link href={`/deals?deal=${lead.promotedDealId}`} style={{ fontWeight: 600, color: 'var(--color-brand-dark)', textDecoration: 'underline' }}>
                Open deal
              </Link>
            </div>
          )}

          {!editing && lead.aiTokensSpent != null && lead.aiTokensSpent > 0 && (
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

function EditGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {children}
    </div>
  )
}

function EditRow({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'email' | 'tel' | 'number' | 'url'
  placeholder?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
      }}>{label}</label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
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

// Tiny inline SVG sparkline of the lead's score history, parsed from
// the activities timeline. Looks for lead_scored + lead_enriched rows
// with "score N" in title/description. Renders 60×24 sparkline.
function ScoreHistorySparkline({
  activities, currentScore,
}: { activities: LeadActivity[]; currentScore: number | null }) {
  const points: Array<{ score: number; at: string }> = []
  for (const a of activities) {
    if (a.type !== 'lead_scored' && a.type !== 'lead_enriched') continue
    // Try description first (carries "score:N"), then title ("Score: A → B" or "Score: B")
    let score: number | null = null
    const descMatch = a.description?.match(/score:(\d{1,3})/i)
    if (descMatch) score = parseInt(descMatch[1], 10)
    if (score == null) {
      const titleMatch = a.title.match(/\b(?:score|→)\s*(\d{1,3})\b/i)
      if (titleMatch) score = parseInt(titleMatch[1], 10)
    }
    if (score != null && score >= 0 && score <= 100) {
      points.push({ score, at: a.createdAt })
    }
  }
  // Chronological asc for plotting
  points.sort((a, b) => a.at.localeCompare(b.at))
  // Append the current score as the rightmost point if it's not already
  // captured (e.g. score was set by a path that didn't stamp an activity)
  if (currentScore != null && (points.length === 0 || points[points.length - 1].score !== currentScore)) {
    points.push({ score: currentScore, at: new Date().toISOString() })
  }
  if (points.length < 2) return null

  const W = 200, H = 28, P = 2
  const xs = points.map((_, i) => P + (i / (points.length - 1)) * (W - 2 * P))
  const ys = points.map(p => P + (1 - p.score / 100) * (H - 2 * P))
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  const latestY = ys[ys.length - 1]
  const latestX = xs[xs.length - 1]
  const min = Math.min(...points.map(p => p.score))
  const max = Math.max(...points.map(p => p.score))

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.625rem',
      padding: '0.5rem 0.625rem',
      marginBottom: '0.625rem',
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Score trend
      </span>
      <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }} aria-label={`Score history: ${points.length} points, min ${min}, max ${max}, current ${currentScore ?? '?'}`}>
        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={latestX} cy={latestY} r="2.5" fill="var(--color-brand)" />
      </svg>
      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
        {points.length} pts · min {min} · max {max}
      </span>
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
