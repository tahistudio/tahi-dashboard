'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  UserPlus, Plus, Clock, RefreshCw, Save, Trash2, ArrowUpRight,
  Mail, Phone, Building2, Globe, Tag, User, Edit3,
  Sparkles, ExternalLink, ChevronDown, Upload,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input } from '@/components/tahi/input'
import { Avatar } from '@/components/tahi/avatar'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { DiscoveryCallsCard, type DiscoveryCall } from '@/components/tahi/discovery-calls'
import { apiPath } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'

/** Safe wrapper for formatDistanceToNow. Returns null for any input
 *  that doesn't parse to a real date — date-fns throws RangeError on
 *  Invalid Date, which would crash the SlideOver. */
function relTime(input: string | number | Date | null | undefined): string | null {
  if (!input) return null
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return null
  return formatDistanceToNow(d, { addSuffix: true })
}

// -- Types --

interface Lead {
  id: string
  personId: string | null
  name: string
  email: string | null
  phone: string | null
  company: string | null
  jobTitle: string | null
  website: string | null
  source: string
  sourceDetail: string | null
  affiliateCode: string | null
  brief: string | null
  estimatedValue: number | null
  currency: string
  status: string
  archiveReason: string | null
  ownerId: string | null
  ownerName: string | null
  ownerAvatarUrl: string | null
  promotedDealId: string | null
  promotedAt: string | null
  // AI enrichment (populated by /api/admin/leads/[id]/enrich)
  aiScore: number | null
  aiScoreReason: string | null
  aiSummary: string | null
  /** JSON-stringified array of URL strings backing aiSummary claims. */
  aiSources: string | null
  /** JSON-stringified array of 3 lead-specific discovery questions. */
  aiQuestions: string | null
  /** JSON-stringified AiSignals object — structured deal-sizing fields. */
  aiSignals: string | null
  enrichedAt: string | null
  lastAiRunAt: string | null
  aiTokensSpent: number | null
  enrichRepromptSuppressed: boolean | null
  createdAt: string
  updatedAt: string
}

interface AiQuestion {
  text: string
  rationale?: string
}

interface LeadActivity {
  id: string
  type: string
  title: string
  description: string | null
  createdById: string
  createdAt: string
  authorName: string | null
  authorAvatarUrl: string | null
}

interface AiSignals {
  employeeCount?: string
  employeeCountSource?: string
  fundingRaised?: string
  fundingStage?: string
  fundingSource?: string
  revenueEstimate?: string
  revenueSource?: string
  pricingVisible?: string
  pricingSource?: string
  customerCount?: string
  customerSource?: string
  siteTechStack?: string
  siteTechSource?: string
  decisionMaker?: string
  decisionMakerConfidence?: 'low' | 'medium' | 'high'
  suggestedFields?: {
    name?: string
    email?: string
    jobTitle?: string
    company?: string
    website?: string
  }
}

interface StatusDef {
  value: string
  label: string
  tone: BadgeTone
}

interface SourceDef {
  value: string
  label: string
}

const STATUSES: StatusDef[] = [
  { value: 'new',        label: 'New',        tone: 'info'     },
  { value: 'qualifying', label: 'Qualifying', tone: 'brand'    },
  { value: 'nurturing',  label: 'Nurturing',  tone: 'warning'  },
  { value: 'promoted',   label: 'Promoted',   tone: 'positive' },
  { value: 'archived',   label: 'Archived',   tone: 'neutral'  },
]
const STATUS_BY_VALUE = new Map(STATUSES.map(s => [s.value, s]))

const SOURCES: SourceDef[] = [
  { value: 'manual',        label: 'Manual entry' },
  { value: 'webflow',       label: 'Webflow form' },
  { value: 'website',       label: 'Website'      },
  { value: 'email',         label: 'Email'        },
  { value: 'referral',      label: 'Referral'     },
  { value: 'affiliate',     label: 'Affiliate'    },
  { value: 'event',         label: 'Event'        },
  { value: 'cold_outreach', label: 'Cold outreach' },
  { value: 'other',         label: 'Other'        },
]
const SOURCE_LABEL_BY_VALUE = new Map(SOURCES.map(s => [s.value, s.label]))

// -- Main Component --

export function LeadsContent() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'status', values: ['new', 'qualifying', 'nurturing'] },
    { id: 'source', values: [] },
  ])

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [selectedActivities, setSelectedActivities] = useState<LeadActivity[]>([])
  const [discoveryTemplate, setDiscoveryTemplate] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<Lead> | null>(null)
  const [editSnapshot, setEditSnapshot] = useState<{ website: string | null; company: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Lead | null>(null)
  const [pendingPromote, setPendingPromote] = useState<Lead | null>(null)
  const [promoting, setPromoting] = useState(false)

  // AI state
  const [enriching, setEnriching] = useState(false)
  const [enrichError, setEnrichError] = useState<string | null>(null)
  /** Set after a save when website/company changed and the lead has
   *  prior enrichment data + reprompt isn't suppressed. Drives a
   *  ConfirmDialog asking whether to re-run enrichment. */
  const [pendingReenrich, setPendingReenrich] = useState<Lead | null>(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/leads'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { leads: Lead[] }
      setLeads(data.leads ?? [])
    } catch {
      setLeads([])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { fetchLeads() }, [fetchLeads])

  const selectedStatuses = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'status')
    return new Set(f?.values ?? [])
  }, [activeFilters])
  const selectedSources = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'source')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter(l => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(l.status)) return false
      if (selectedSources.size > 0 && !selectedSources.has(l.source)) return false
      if (q) {
        const hay = [l.name, l.email, l.company, l.brief].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [leads, search, selectedStatuses, selectedSources])

  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'status',
      label: 'Status',
      kind: 'multiselect',
      nonRemovable: true,
      options: STATUSES.map(s => ({ value: s.value, label: s.label, tone: s.tone })),
    },
    {
      id: 'source',
      label: 'Source',
      kind: 'multiselect',
      nonRemovable: true,
      options: SOURCES.map(s => ({ value: s.value, label: s.label })),
    },
  ]), [])

  const openLead = async (id: string) => {
    try {
      const res = await fetch(apiPath(`/api/admin/leads/${id}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as {
        lead: Lead
        discoveryQuestionsTemplate?: string[]
        activities?: LeadActivity[]
      }
      setSelectedLead(data.lead)
      setSelectedActivities(data.activities ?? [])
      setDiscoveryTemplate(data.discoveryQuestionsTemplate ?? [])
      setEditing(false)
      setDraft(null)
      setEnrichError(null)
    } catch {
      // ignore
    }
  }

  const handleNew = () => {
    setSelectedLead(null)
    setDraft({
      name: '', email: '', phone: '', company: '', jobTitle: '',
      website: '', source: 'manual', sourceDetail: '', brief: '',
      estimatedValue: null, currency: 'NZD',
    })
    setShowNewForm(true)
  }

  const startEdit = (lead: Lead) => {
    setSelectedLead(lead)
    setDraft({ ...lead })
    setEditSnapshot({ website: lead.website, company: lead.company })
    setEditing(true)
  }

  async function handleCreate() {
    if (!draft?.name?.trim()) return
    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/leads'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { id: string }
      setShowNewForm(false)
      setDraft(null)
      await fetchLeads()
      await openLead(data.id)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!selectedLead || !draft) return
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/leads/${selectedLead.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      await openLead(selectedLead.id)
      await fetchLeads()
      setEditing(false)
      setDraft(null)

      // Re-enrich confirm logic. Trigger only when:
      //   1. The lead already has prior enrichment data (no point
      //      prompting on first edit before any AI has run)
      //   2. Liam hasn't suppressed the prompt for this lead
      //   3. Website OR company actually changed during this edit
      const normalisedSnap = (v: string | null | undefined) => (v ?? '').trim() || null
      const websiteChanged = normalisedSnap(draft.website) !== normalisedSnap(editSnapshot?.website)
      const companyChanged = normalisedSnap(draft.company) !== normalisedSnap(editSnapshot?.company)
      const fieldsChanged = websiteChanged || companyChanged
      const eligible = selectedLead.enrichedAt && !selectedLead.enrichRepromptSuppressed
      if (fieldsChanged && eligible) {
        setPendingReenrich(selectedLead)
      }
      setEditSnapshot(null)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try {
      await fetch(apiPath(`/api/admin/leads/${pendingDelete.id}`), { method: 'DELETE' })
      setSelectedLead(null)
      setPendingDelete(null)
      await fetchLeads()
    } catch {
      // ignore
    }
  }

  async function runEnrich(leadId: string) {
    setEnriching(true)
    setEnrichError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/leads/${leadId}/enrich`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Enrichment failed' })) as { detail?: string; error?: string }
        throw new Error(errJson.detail ?? errJson.error ?? 'Enrichment failed')
      }
      await openLead(leadId)
      await fetchLeads()
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Enrichment failed')
    } finally {
      setEnriching(false)
    }
  }

  async function suppressReenrichPrompt(leadId: string) {
    try {
      await fetch(apiPath(`/api/admin/leads/${leadId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrichRepromptSuppressed: true }),
      })
      await openLead(leadId)
    } catch {
      // best-effort
    }
  }

  // ── Promote-call-to-deal handler. The shared DiscoveryCallsCard
  // owns create/update/delete/extract internally; only this lead-
  // specific action stays here. ────────────────────────────────────

  async function promoteCallToDeal(leadId: string, call: DiscoveryCall) {
    // Build a deal-notes blob from the call's captured fields. Easier
    // than threading them into separate deal columns and Liam can
    // refine on the deal page itself.
    const notesParts: string[] = []
    if (call.summary) notesParts.push(`Call summary: ${call.summary}`)
    if (call.scopeNotes) notesParts.push(`Scope: ${call.scopeNotes}`)
    if (call.outcomeNotes) notesParts.push(`Next step: ${call.outcomeNotes}`)
    if (call.budgetMin || call.budgetMax) {
      const range = call.budgetMin && call.budgetMax && call.budgetMin !== call.budgetMax
        ? `${call.budgetMin} - ${call.budgetMax}`
        : String(call.budgetMin ?? call.budgetMax ?? '')
      notesParts.push(`Budget signal: ${range} ${call.budgetCurrency ?? ''}`.trim())
    }
    if (call.timeline) notesParts.push(`Timeline: ${call.timeline}`)

    // Use the budget midpoint as the upfront if we have a range.
    const upfrontValue = call.budgetMin && call.budgetMax
      ? Math.round((call.budgetMin + call.budgetMax) / 2)
      : (call.budgetMin ?? call.budgetMax ?? undefined)

    try {
      const res = await fetch(apiPath(`/api/admin/leads/${leadId}/promote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createOrg: true,
          notes: notesParts.join('\n\n') || undefined,
          upfrontValue,
          currency: call.budgetCurrency || undefined,
          sourceCallId: call.id,
        }),
      })
      if (res.ok) {
        const data = await res.json() as { dealId?: string }
        if (data.dealId) window.location.href = apiPath(`/deals?deal=${data.dealId}`)
      }
    } catch {
      // best-effort — UI just keeps the call in place if promote fails
    }
  }

  /** Patches the lead with AI-suggested values for fields that are
   *  currently empty. After applying, the suggestion banner naturally
   *  hides because the corresponding lead fields are no longer empty. */
  async function applySuggestions(leadId: string, patch: Partial<Lead>) {
    try {
      await fetch(apiPath(`/api/admin/leads/${leadId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      await openLead(leadId)
      await fetchLeads()
    } catch {
      // best-effort — UI just leaves the banner visible if the patch fails
    }
  }

  async function confirmPromote() {
    if (!pendingPromote) return
    setPromoting(true)
    try {
      const res = await fetch(apiPath(`/api/admin/leads/${pendingPromote.id}/promote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createOrg: true }),
      })
      if (res.ok) {
        const data = await res.json() as { dealId: string }
        setPendingPromote(null)
        setSelectedLead(null)
        await fetchLeads()
        // Redirect to the new deal so Liam lands where he can keep
        // working — pipeline → deal detail.
        if (data.dealId) window.location.href = apiPath(`/deals?deal=${data.dealId}`)
      }
    } finally {
      setPromoting(false)
    }
  }

  const columns: DataTableColumn<Lead>[] = [
    {
      key: 'name',
      header: 'Lead',
      sortable: true,
      sortValue: r => r.name.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <Avatar name={r.name} size="xs" />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontWeight: 600, color: 'var(--color-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{r.name}</div>
            {(r.company || r.email) && (
              <div style={{
                fontSize: '0.6875rem', color: 'var(--color-text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {[r.company, r.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      width: '8.5rem',
      edit: {
        value: r => r.status,
        options: STATUSES.map(s => ({ value: s.value, label: s.label, tone: s.tone })),
        onChange: async (r, next) => {
          // Optimistic local update so the chip changes instantly,
          // then PATCH. Refetch on completion to pick up any side
          // effects (e.g. archive activity row).
          setLeads(prev => prev.map(l => l.id === r.id ? { ...l, status: next } : l))
          try {
            await fetch(apiPath(`/api/admin/leads/${r.id}`), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: next }),
            })
          } finally {
            fetchLeads()
          }
        },
      },
    },
    {
      key: 'aiScore',
      header: 'AI score',
      sortable: true,
      sortValue: r => r.aiScore ?? -1,
      width: '7rem',
      render: r => {
        if (r.aiScore == null) {
          return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>
        }
        const tone: BadgeTone =
          r.aiScore >= 80 ? 'positive'
          : r.aiScore >= 60 ? 'brand'
          : r.aiScore >= 40 ? 'warning'
          : 'neutral'
        return (
          <Badge tone={tone} variant="soft" size="sm" dot={false}>
            {r.aiScore}
          </Badge>
        )
      },
    },
    {
      key: 'website',
      header: 'Site',
      width: '3rem',
      align: 'center',
      render: r => r.website ? (
        <a
          href={normaliseUrl(r.website)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${r.website}`}
          title={r.website}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.5rem',
            height: '1.5rem',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            transition: 'background 120ms ease, color 120ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-bg-tertiary)'
            e.currentTarget.style.color = 'var(--color-brand-dark)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      ) : <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>,
    },
    {
      key: 'source',
      header: 'Source',
      sortable: true,
      sortValue: r => r.source,
      width: '9rem',
      render: r => (
        <span style={{
          fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 500,
        }}>{SOURCE_LABEL_BY_VALUE.get(r.source) ?? r.source}</span>
      ),
    },
    {
      key: 'value',
      header: 'Estimate',
      sortable: true,
      sortValue: r => r.estimatedValue ?? 0,
      width: '7rem',
      render: r => r.estimatedValue ? (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(r.estimatedValue, r.currency)}
        </span>
      ) : <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>,
    },
    {
      key: 'owner',
      header: 'Owner',
      sortable: true,
      sortValue: r => r.ownerName ?? '',
      width: '8rem',
      render: r => r.ownerName ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3125rem' }}>
          <Avatar name={r.ownerName} src={r.ownerAvatarUrl ?? undefined} size="xs" />
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text)' }}>{r.ownerName.split(' ')[0]}</span>
        </div>
      ) : <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      sortValue: r => r.updatedAt,
      width: '9rem',
      render: r => (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3125rem',
          fontSize: '0.75rem', color: 'var(--color-text-muted)',
        }}>
          <Clock size={11} aria-hidden="true" />
          {relTime(r.updatedAt) ?? 'unknown'}
        </span>
      ),
    },
  ]

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <h1 style={{
            margin: 0, fontSize: '1.5rem', fontWeight: 700,
            color: 'var(--color-text)', letterSpacing: '-0.015em',
          }}>Leads</h1>
          <p style={{
            margin: '0.25rem 0 0', fontSize: '0.875rem',
            color: 'var(--color-text-muted)', lineHeight: 1.5,
          }}>
            Pre-qualification inbox. New prospects land here, get a discovery call, then promote to a deal in the pipeline.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <TahiButton
            size="sm"
            variant="secondary"
            onClick={() => setShowBulkImport(true)}
            iconLeft={<Upload className="w-3.5 h-3.5" />}
          >
            Bulk import
          </TahiButton>
          <TahiButton
            size="sm"
            onClick={handleNew}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
          >
            New lead
          </TahiButton>
        </div>
      </div>

      {/* Filter row */}
      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search by name, company, email...',
        }}
        size="sm"
      />

      {/* Table */}
      <Card padding="none">
        <DataTable<Lead>
          ariaLabel="Leads"
          columns={columns}
          rows={filteredLeads}
          getRowId={r => r.id}
          defaultSort={{ key: 'updatedAt', dir: 'desc' }}
          loading={loading}
          empty={
            <EmptyState
              title={leads.length === 0 ? 'No leads yet' : 'No matches'}
              description={leads.length === 0
                ? 'Capture your first lead manually, or wait for one to land via Webflow / referral.'
                : 'Try clearing a filter or adjusting your search.'}
              action={
                leads.length === 0 ? (
                  <TahiButton size="sm" onClick={handleNew} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                    New lead
                  </TahiButton>
                ) : undefined
              }
            />
          }
          onRowClick={(r) => { window.location.href = apiPath(`/leads/${r.id}`) }}
          rowActions={(r) => [
            { label: 'Quick view (slide-over)', icon: <Edit3 size={14} />, onClick: () => openLead(r.id) },
            { label: 'Edit', icon: <Edit3 size={14} />, onClick: () => startEdit(r) },
            ...(r.status !== 'promoted' ? [
              { label: 'Promote to deal', icon: <ArrowUpRight size={14} />, onClick: () => setPendingPromote(r) },
            ] : []),
            { label: 'Delete', icon: <Trash2 size={14} />, tone: 'danger' as const, onClick: () => setPendingDelete(r) },
          ]}
        />
      </Card>

      {/* View / edit slide-over */}
      <SlideOver
        open={!!selectedLead && !showNewForm}
        onClose={() => { setSelectedLead(null); setEditing(false); setDraft(null) }}
        title={editing ? (draft?.name?.trim() || 'New lead') : (selectedLead?.name ?? '')}
        subtitle={selectedLead && !editing ? leadSubtitle(selectedLead) : undefined}
        maxWidth="48rem"
      >
        {selectedLead && (
          <>
            <SlideOver.Body>
              {editing && draft ? (
                <LeadForm draft={draft} onChange={setDraft} />
              ) : (
                <LeadDetail
                  lead={selectedLead}
                  activities={selectedActivities}
                  discoveryTemplate={discoveryTemplate}
                  enriching={enriching}
                  enrichError={enrichError}
                  onRunEnrich={() => runEnrich(selectedLead.id)}
                  onApplySuggestions={(patch) => applySuggestions(selectedLead.id, patch)}
                  onCallsChanged={() => openLead(selectedLead.id)}
                  onPromoteCallToDeal={(call) => promoteCallToDeal(selectedLead.id, call)}
                />
              )}
            </SlideOver.Body>
            <SlideOver.Footer>
              {editing ? (
                <>
                  <TahiButton variant="secondary" size="sm" onClick={() => { setEditing(false); setDraft(null) }}>
                    Cancel
                  </TahiButton>
                  <TahiButton
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || !draft?.name?.trim()}
                    iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </TahiButton>
                </>
              ) : (
                <>
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setPendingDelete(selectedLead)}
                    iconLeft={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    Delete
                  </TahiButton>
                  <div style={{ flex: 1 }} />
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => startEdit(selectedLead)}
                  >
                    Edit
                  </TahiButton>
                  {selectedLead.status !== 'promoted' && (
                    <TahiButton
                      size="sm"
                      onClick={() => setPendingPromote(selectedLead)}
                      iconLeft={<ArrowUpRight className="w-3.5 h-3.5" />}
                    >
                      Promote to deal
                    </TahiButton>
                  )}
                </>
              )}
            </SlideOver.Footer>
          </>
        )}
      </SlideOver>

      {/* New-lead slide-over */}
      <SlideOver
        open={showNewForm}
        onClose={() => { setShowNewForm(false); setDraft(null) }}
        title="New lead"
        subtitle="Capture a prospect before the discovery call."
        maxWidth="48rem"
      >
        {draft && (
          <>
            <SlideOver.Body>
              <LeadForm draft={draft} onChange={setDraft} />
            </SlideOver.Body>
            <SlideOver.Footer>
              <TahiButton variant="secondary" size="sm" onClick={() => { setShowNewForm(false); setDraft(null) }}>
                Cancel
              </TahiButton>
              <TahiButton
                size="sm"
                onClick={handleCreate}
                disabled={saving || !draft?.name?.trim()}
                iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              >
                {saving ? 'Saving...' : 'Create lead'}
              </TahiButton>
            </SlideOver.Footer>
          </>
        )}
      </SlideOver>

      {/* Bulk import slide-over */}
      <SlideOver
        open={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        title="Bulk import leads"
        subtitle="Paste a CSV. We'll preview before writing anything."
        maxWidth="52rem"
      >
        <BulkImportPanel
          onDone={async () => {
            setShowBulkImport(false)
            await fetchLeads()
          }}
        />
      </SlideOver>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete lead "${pendingDelete?.name ?? ''}"?`}
        description="This removes the lead row. The canonical person record is kept (other roles for them still apply)."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Promote confirm */}
      <ConfirmDialog
        open={!!pendingPromote}
        title={`Promote "${pendingPromote?.name ?? ''}" to a deal?`}
        description={`A new ${pendingPromote?.company ? `organisation (${pendingPromote.company})` : 'organisation'} + contact + deal will be created in the pipeline. The lead status flips to 'promoted'.`}
        confirmLabel={promoting ? 'Promoting...' : 'Promote to deal'}
        onConfirm={confirmPromote}
        onCancel={() => setPendingPromote(null)}
      />

      {/* Re-enrich confirm. Fires after a save when website or company
          changed AND the lead has prior enrichment data AND Liam hasn't
          suppressed the prompt for this lead. */}
      <ConfirmDialog
        open={!!pendingReenrich}
        title="Re-run enrichment?"
        description="The website or company changed. Would you like the AI to refresh its research and discovery questions based on the new info?"
        confirmLabel="Re-run now"
        cancelLabel="Skip"
        variant="primary"
        onConfirm={async () => {
          const lead = pendingReenrich
          setPendingReenrich(null)
          if (lead) await runEnrich(lead.id)
        }}
        onCancel={() => setPendingReenrich(null)}
        secondaryAction={pendingReenrich ? {
          label: "Don't ask again",
          onClick: async () => {
            const lead = pendingReenrich
            setPendingReenrich(null)
            if (lead) await suppressReenrichPrompt(lead.id)
          },
        } : undefined}
      />
    </div>
  )
}

// -- Lead form (shared between create + edit) --

function LeadForm({
  draft,
  onChange,
}: {
  draft: Partial<Lead>
  onChange: (next: Partial<Lead>) => void
}) {
  const update = (patch: Partial<Lead>) => onChange({ ...draft, ...patch })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <Field label="Name *">
        <Input
          value={draft.name ?? ''}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Anna Walker"
          inputSize="md"
        />
      </Field>

      {/* All 2-col rows stack on mobile (<640px) and split 50/50 on
          desktop. Equal columns align cleanly across every row.
          Tailwind sm: breakpoint = 640px. */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Field label="Email">
          <Input
            value={draft.email ?? ''}
            onChange={(e) => update({ email: e.target.value })}
            placeholder="anna@glasswall.com"
            inputSize="md"
            leadingIcon={<Mail size={13} aria-hidden="true" />}
          />
        </Field>
        <Field label="Phone">
          <Input
            value={draft.phone ?? ''}
            onChange={(e) => update({ phone: e.target.value })}
            placeholder="+64 ..."
            inputSize="md"
            leadingIcon={<Phone size={13} aria-hidden="true" />}
          />
        </Field>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Field label="Company">
          <Input
            value={draft.company ?? ''}
            onChange={(e) => update({ company: e.target.value })}
            placeholder="Glasswall"
            inputSize="md"
            leadingIcon={<Building2 size={13} aria-hidden="true" />}
          />
        </Field>
        <Field label="Job title">
          <Input
            value={draft.jobTitle ?? ''}
            onChange={(e) => update({ jobTitle: e.target.value })}
            placeholder="Head of Marketing"
            inputSize="md"
          />
        </Field>
      </div>

      <Field label="Website">
        <Input
          value={draft.website ?? ''}
          onChange={(e) => update({ website: e.target.value })}
          placeholder="https://..."
          inputSize="md"
          leadingIcon={<Globe size={13} aria-hidden="true" />}
        />
      </Field>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Field label="Source">
          <select
            value={draft.source ?? 'manual'}
            onChange={(e) => update({ source: e.target.value })}
            className="tahi-select"
            style={selectStyle}
          >
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Source detail">
          <Input
            value={draft.sourceDetail ?? ''}
            onChange={(e) => update({ sourceDetail: e.target.value })}
            placeholder="e.g. spoke at Meetup in March"
            inputSize="md"
          />
        </Field>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Field label="Estimated value">
          <Input
            type="number"
            value={draft.estimatedValue ?? ''}
            onChange={(e) => update({ estimatedValue: e.target.value ? Number(e.target.value) : null })}
            placeholder="30000"
            inputSize="md"
          />
        </Field>
        <Field label="Currency">
          <select
            value={draft.currency ?? 'NZD'}
            onChange={(e) => update({ currency: e.target.value })}
            className="tahi-select"
            style={selectStyle}
          >
            <option value="NZD">NZD</option>
            <option value="USD">USD</option>
            <option value="AUD">AUD</option>
            <option value="GBP">GBP</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
      </div>

      <Field label="Brief">
        <textarea
          value={draft.brief ?? ''}
          onChange={(e) => update({ brief: e.target.value })}
          placeholder="What they want, signals from the first touch, anything that should be top-of-mind on the discovery call."
          rows={4}
          className="tahi-textarea"
          style={textareaStyle}
        />
      </Field>
    </div>
  )
}

// -- Lead detail (view mode) --

function LeadDetail({
  lead,
  activities,
  discoveryTemplate,
  enriching,
  enrichError,
  onRunEnrich,
  onApplySuggestions,
  onCallsChanged,
  onPromoteCallToDeal,
}: {
  lead: Lead
  activities: LeadActivity[]
  discoveryTemplate: string[]
  enriching: boolean
  enrichError: string | null
  onRunEnrich: () => void
  onApplySuggestions: (patch: Partial<Lead>) => void
  onCallsChanged: () => void
  onPromoteCallToDeal: (call: DiscoveryCall) => Promise<void>
}) {
  const status = STATUS_BY_VALUE.get(lead.status)
  const aiSources = safeJsonArray<string>(lead.aiSources)
  const aiQuestionsRaw = safeJsonArray<string | AiQuestion>(lead.aiQuestions)
  // Normalise legacy string[] entries into { text } shape so downstream code
  // doesn't care about the storage history.
  const aiQuestions: AiQuestion[] = aiQuestionsRaw.map(q =>
    typeof q === 'string' ? { text: q } : q,
  )
  const aiSignals = safeJsonObject<AiSignals>(lead.aiSignals)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
        {status && <Badge tone={status.tone} variant="soft" size="sm" dot={false}>{status.label}</Badge>}
        <Badge tone="neutral" variant="outline" size="sm" dot={false}>
          {SOURCE_LABEL_BY_VALUE.get(lead.source) ?? lead.source}
        </Badge>
        {lead.estimatedValue ? (
          <Badge tone="brand" variant="soft" size="sm" dot={false}>
            {formatMoney(lead.estimatedValue, lead.currency)}
          </Badge>
        ) : null}
        {lead.affiliateCode ? (
          <Badge tone="purple" variant="soft" size="sm" dot={false}>
            <Tag size={10} aria-hidden="true" style={{ marginRight: '0.25rem', display: 'inline' }} />
            {lead.affiliateCode}
          </Badge>
        ) : null}
      </div>

      <DetailGrid>
        {lead.email && <DetailRow icon={<Mail size={12} />} label="Email" value={lead.email} />}
        {lead.phone && <DetailRow icon={<Phone size={12} />} label="Phone" value={lead.phone} />}
        {lead.company && <DetailRow icon={<Building2 size={12} />} label="Company" value={lead.company} />}
        {lead.jobTitle && <DetailRow icon={<User size={12} />} label="Job title" value={lead.jobTitle} />}
        {lead.website && <DetailRow icon={<Globe size={12} />} label="Website" value={lead.website} />}
        {lead.sourceDetail && <DetailRow icon={<Tag size={12} />} label="Source detail" value={lead.sourceDetail} />}
        {lead.ownerName && <DetailRow icon={<User size={12} />} label="Owner" value={lead.ownerName} />}
      </DetailGrid>

      <AiSection
        lead={lead}
        aiSources={aiSources}
        aiQuestions={aiQuestions}
        aiSignals={aiSignals}
        discoveryTemplate={discoveryTemplate}
        enriching={enriching}
        enrichError={enrichError}
        onRunEnrich={onRunEnrich}
        onApplySuggestions={onApplySuggestions}
      />

      {lead.brief && (
        <div>
          <SectionLabel>Brief</SectionLabel>
          <p style={{
            margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text)',
            whiteSpace: 'pre-wrap', lineHeight: 1.55,
          }}>{lead.brief}</p>
        </div>
      )}

      {lead.promotedDealId && (
        <div style={{
          padding: '0.5rem 0.625rem',
          background: 'var(--color-brand-50)',
          border: '1px solid var(--color-brand-100)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.75rem',
          color: 'var(--color-text-active)',
        }}>
          ✓ Promoted{relTime(lead.promotedAt) ? ` ${relTime(lead.promotedAt)}` : ''}
          {' · '}
          <a href={`/deals?deal=${lead.promotedDealId}`} style={{ fontWeight: 600, color: 'var(--color-brand-dark)', textDecoration: 'underline' }}>
            Open deal
          </a>
        </div>
      )}

      <DiscoveryCallsCard
        parentType="lead"
        parentId={lead.id}
        onChanged={onCallsChanged}
        parentAlreadyPromoted={!!lead.promotedDealId}
        promoteToDealAction={onPromoteCallToDeal}
      />

      {activities.length > 0 && <ActivityTimeline activities={activities} />}
    </div>
  )
}

function ActivityTimeline({ activities }: { activities: LeadActivity[] }) {
  // Newest first. The API returns oldest-first by default; sort here
  // so the freshest event is at the top.
  const sorted = [...activities].sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  )
  return (
    <div>
      <SectionLabel>Activity</SectionLabel>
      <ul style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}>
        {sorted.map((a) => (
          <ActivityRow key={a.id} activity={a} />
        ))}
      </ul>
    </div>
  )
}

function ActivityRow({ activity }: { activity: LeadActivity }) {
  const isSystem = activity.createdById === 'system' || activity.type === 'lead_enriched'
  const accent = isSystem ? 'var(--color-brand)' : 'var(--color-text-subtle)'
  return (
    <li style={{ display: 'flex', gap: '0.5625rem', alignItems: 'flex-start' }}>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          marginTop: '0.4375rem',
          width: '0.4375rem',
          height: '0.4375rem',
          borderRadius: '50%',
          background: accent,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.4 }}>
          {activity.title}
        </div>
        {activity.description && (
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.45,
            marginTop: '0.125rem',
          }}>
            {activity.description}
          </div>
        )}
        <div style={{
          fontSize: '0.625rem',
          color: 'var(--color-text-subtle)',
          marginTop: '0.1875rem',
        }}>
          {isSystem ? 'AI' : (activity.authorName ?? 'Tahi')}
          {relTime(activity.createdAt) ? ` · ${relTime(activity.createdAt)}` : ''}
        </div>
      </div>
    </li>
  )
}

// -- Shared bits --

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: '0.625rem', fontWeight: 600,
        letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--color-text-subtle)', marginBottom: '0.3125rem',
      }}>{label}</label>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: 'block', fontSize: '0.625rem', fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--color-text-subtle)', marginBottom: '0.3125rem',
    }}>{children}</label>
  )
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl style={{
      margin: 0, display: 'grid',
      gridTemplateColumns: 'minmax(6rem, max-content) 1fr',
      gap: '0.3125rem 0.75rem',
      fontSize: 'var(--text-sm)',
    }}>{children}</dl>
  )
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <>
      <dt style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.3125rem',
        color: 'var(--color-text-muted)', fontSize: '0.75rem',
      }}>
        <span style={{ color: 'var(--color-text-subtle)' }}>{icon}</span>
        {label}
      </dt>
      <dd style={{ margin: 0, color: 'var(--color-text)' }}>{value}</dd>
    </>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  height: '2rem',
  padding: '0 0.5625rem',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text)',
  outline: 'none',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.4375rem 0.625rem',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text)',
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.55,
  outline: 'none',
}

function leadSubtitle(lead: Lead): string {
  const parts: string[] = []
  if (lead.company) parts.push(lead.company)
  if (lead.email) parts.push(lead.email)
  const updated = relTime(lead.updatedAt)
  if (updated) parts.push(`Updated ${updated}`)
  return parts.join(' · ')
}

// -- AI section (shown inside LeadDetail when AI data is available) --

function AiSection({
  lead,
  aiSources,
  aiQuestions,
  aiSignals,
  discoveryTemplate,
  enriching,
  enrichError,
  onRunEnrich,
  onApplySuggestions,
}: {
  lead: Lead
  aiSources: string[]
  aiQuestions: AiQuestion[]
  aiSignals: AiSignals
  discoveryTemplate: string[]
  enriching: boolean
  enrichError: string | null
  onRunEnrich: () => void
  onApplySuggestions: (patch: Partial<Lead>) => void
}) {
  // Build the apply-suggestion patch: only fields the AI suggested AND
  // the lead is currently missing. If nothing actionable, no banner.
  const suggestionPatch: Partial<Lead> = {}
  const suggested = aiSignals.suggestedFields
  if (suggested) {
    if (suggested.name && !lead.name?.trim().includes(suggested.name)) suggestionPatch.name = suggested.name
    if (suggested.email && !lead.email?.trim()) suggestionPatch.email = suggested.email
    if (suggested.jobTitle && !lead.jobTitle?.trim()) suggestionPatch.jobTitle = suggested.jobTitle
    if (suggested.company && !lead.company?.trim()) suggestionPatch.company = suggested.company
    if (suggested.website && !lead.website?.trim()) suggestionPatch.website = suggested.website
  }
  const suggestionEntries = Object.entries(suggestionPatch) as Array<[keyof Lead, string]>
  const hasEnrichment = !!lead.enrichedAt
  const scoreTone: BadgeTone =
    lead.aiScore == null ? 'neutral'
    : lead.aiScore >= 80 ? 'positive'
    : lead.aiScore >= 60 ? 'brand'
    : lead.aiScore >= 40 ? 'warning'
    : 'neutral'

  // Single layout for both states. The Discovery card always shows
  // when the always-ask template exists (they're universal, not AI-
  // dependent). The briefing / signals / sources / score header only
  // show after enrichment has run.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Score header + Run AI button. Header only when enriched; Run AI
          button always so Liam can fire / re-fire from anywhere. */}
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {hasEnrichment && (
          <>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: 'var(--color-brand-dark)', fontWeight: 600, fontSize: '0.8125rem' }}>
              <Sparkles size={13} aria-hidden="true" />
              AI briefing
            </div>
            {lead.aiScore != null && (
              <Badge tone={scoreTone} variant="soft" size="sm" dot={false}>
                Score {lead.aiScore}
              </Badge>
            )}
            {relTime(lead.enrichedAt) && (
              <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                Enriched {relTime(lead.enrichedAt)}
              </span>
            )}
            <div style={{ flex: 1 }} />
          </>
        )}
        <TahiButton
          size="sm"
          variant={hasEnrichment ? 'secondary' : 'primary'}
          onClick={onRunEnrich}
          disabled={enriching}
          iconLeft={enriching
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5" />}
        >
          {enriching ? 'Researching...' : (hasEnrichment ? 'Re-run AI' : 'Run AI')}
        </TahiButton>
      </header>

      {hasEnrichment && lead.aiScoreReason && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic', lineHeight: 1.5 }}>
          {lead.aiScoreReason}
        </p>
      )}

      {/* Auto-fill suggestions — brand-50 banner, only when actionable */}
      {suggestionEntries.length > 0 && (
        <div style={{
          padding: '0.75rem 0.875rem',
          background: 'var(--color-brand-50)',
          border: '1px solid var(--color-brand-100)',
          borderRadius: 'var(--radius-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-brand-dark)' }}>
            AI found {suggestionEntries.length} field{suggestionEntries.length === 1 ? '' : 's'} to fill in
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {suggestionEntries.map(([field, value]) => (
              <li key={field} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', lineHeight: 1.5 }}>
                <span style={{ width: '5.5rem', flexShrink: 0, color: 'var(--color-text-muted)', textTransform: 'capitalize', fontWeight: 500 }}>
                  {fieldLabel(field)}
                </span>
                <span style={{ flex: 1, color: 'var(--color-text)', wordBreak: 'break-word' }}>{value}</span>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '0.4375rem' }}>
            <TahiButton size="sm" onClick={() => onApplySuggestions(suggestionPatch)}>Apply all</TahiButton>
          </div>
        </div>
      )}

      {/* Discovery questions card — top priority for pre-call glance */}
      {(discoveryTemplate.length > 0 || aiQuestions.length > 0) && (
        <AiCard title="Discovery call">
          {discoveryTemplate.length > 0 && (
            <QuestionGroup
              label="Always ask"
              questions={discoveryTemplate.map(q => ({ text: q }))}
            />
          )}
          {discoveryTemplate.length > 0 && aiQuestions.length > 0 && <CardDivider />}
          {aiQuestions.length > 0 && (
            <QuestionGroup label="For this lead" questions={aiQuestions} />
          )}
        </AiCard>
      )}

      {/* Briefing card — snapshot / fit / watch-outs */}
      {lead.aiSummary && (
        <AiCard title="Briefing">
          <BriefingSummary raw={lead.aiSummary} />
        </AiCard>
      )}

      {/* Company signals card */}
      {Object.keys(aiSignals).length > 0 && hasAnyVisibleSignal(aiSignals) && (
        <AiCard title="Company signals">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4375rem' }}>
            {aiSignals.employeeCount && (
              <SignalRow label="Team" value={aiSignals.employeeCount} source={aiSignals.employeeCountSource} />
            )}
            {aiSignals.fundingRaised && (
              <SignalRow
                label="Funding"
                value={`${aiSignals.fundingRaised}${aiSignals.fundingStage ? ` (${aiSignals.fundingStage})` : ''}`}
                source={aiSignals.fundingSource}
              />
            )}
            {aiSignals.revenueEstimate && (
              <SignalRow label="Revenue" value={aiSignals.revenueEstimate} source={aiSignals.revenueSource} />
            )}
            {aiSignals.pricingVisible && (
              <SignalRow label="Pricing" value={aiSignals.pricingVisible} source={aiSignals.pricingSource} />
            )}
            {aiSignals.customerCount && (
              <SignalRow label="Customers" value={aiSignals.customerCount} source={aiSignals.customerSource} />
            )}
            {aiSignals.siteTechStack && (
              <SignalRow label="Tech" value={aiSignals.siteTechStack} source={aiSignals.siteTechSource} />
            )}
            {aiSignals.decisionMaker && (
              <SignalRow
                label="Decision-maker"
                value={`${aiSignals.decisionMaker}${aiSignals.decisionMakerConfidence ? ` · ${aiSignals.decisionMakerConfidence} confidence` : ''}`}
              />
            )}
          </div>
        </AiCard>
      )}

      {/* Sources + token footer */}
      {(aiSources.length > 0 || (lead.aiTokensSpent && lead.aiTokensSpent > 0)) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          {aiSources.length > 0 ? <SourcesToggle sources={aiSources} /> : <span />}
          {lead.aiTokensSpent != null && lead.aiTokensSpent > 0 && (
            <span style={{
              fontSize: '0.625rem',
              color: 'var(--color-text-subtle)',
            }}>
              {lead.aiTokensSpent.toLocaleString()} tokens spent
            </span>
          )}
        </div>
      )}

      {enrichError && <EnrichErrorBox message={enrichError} />}
    </div>
  )
}


/** Bordered subsection card. Used for Discovery / Briefing / Signals so each
 *  block reads as its own scannable unit instead of one mega-card. */
function AiCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      padding: '0.875rem 1rem',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-card)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.625rem',
    }}>
      <div style={{
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
      }}>{title}</div>
      {children}
    </section>
  )
}

function CardDivider() {
  return <div style={{ borderTop: '1px solid var(--color-border-subtle)', margin: '0.125rem 0' }} />
}

/** Renders one group of questions (e.g. "Always ask" or "For this lead").
 *  Each question is a numbered line with its rationale as small muted
 *  text below. Generous spacing between questions so the whole block is
 *  scannable as a call brief. */
function QuestionGroup({ label, questions }: { label: string; questions: AiQuestion[] }) {
  return (
    <div>
      <div style={{
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.5rem',
      }}>{label}</div>
      <ol style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        counterReset: 'q',
      }}>
        {questions.map((q, i) => (
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
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
                {q.text}
              </div>
              {q.rationale && (
                <div style={{
                  fontSize: '0.6875rem',
                  color: 'var(--color-text-muted)',
                  fontStyle: 'italic',
                  marginTop: '0.1875rem',
                  lineHeight: 1.4,
                }}>
                  {q.rationale}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function EnrichErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      padding: '0.5rem 0.625rem',
      background: 'var(--color-danger-bg)',
      border: '1px solid var(--color-danger)',
      borderRadius: 'var(--radius-sm)',
      fontSize: '0.75rem',
      color: 'var(--color-danger)',
    }}>{message}</div>
  )
}

function hasAnyVisibleSignal(s: AiSignals): boolean {
  return !!(
    s.employeeCount || s.fundingRaised || s.revenueEstimate
    || s.pricingVisible || s.customerCount || s.siteTechStack
    || s.decisionMaker
  )
}

function safeJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function safeJsonObject<T extends object>(raw: string | null | undefined): T {
  if (!raw) return {} as T
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed as T
      : {} as T
  } catch {
    return {} as T
  }
}

/** Renders the structured 3-section briefing (snapshot / fit / watch-outs).
 *  Falls back to plain text if the stored value is a legacy summary
 *  blob rather than the JSON shape. */
function BriefingSummary({ raw }: { raw: string }) {
  let parsed: { snapshot?: string; fit?: string; watchOuts?: string } | null = null
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object' && (obj.snapshot || obj.fit || obj.watchOuts)) {
      parsed = obj
    }
  } catch {
    // not JSON — legacy plain summary
  }

  if (!parsed) {
    return (
      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {raw}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      {parsed.snapshot && <BriefingBlock label="Snapshot" body={parsed.snapshot} />}
      {parsed.fit && <BriefingBlock label="Why they might fit" body={parsed.fit} />}
      {parsed.watchOuts && <BriefingBlock label="Watch-outs" body={parsed.watchOuts} />}
    </div>
  )
}

function BriefingBlock({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div style={{
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.25rem',
      }}>{label}</div>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.55 }}>{body}</p>
    </div>
  )
}

/** Sources collapsed by default. Click the header to expand the URL list.
 *  Mirrors a native <details>/<summary> but styled to match the rest of
 *  the AI card. */
function SourcesToggle({ sources }: { sources: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.375rem',
          padding: '0.25rem 0.4375rem',
          margin: '-0.25rem -0.4375rem',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          transition: 'background-color 120ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        Sources ({sources.length})
        <ChevronDown
          size={11}
          aria-hidden="true"
          style={{
            transition: 'transform 200ms ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>
      {open && (
        <ul style={{ margin: '0.375rem 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {sources.map((src, i) => (
            <li key={i}>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3125rem',
                  color: 'var(--color-text-active)',
                  fontSize: '0.75rem',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                  textDecorationColor: 'var(--color-brand-100)',
                  textUnderlineOffset: '0.1875rem',
                  wordBreak: 'break-all',
                }}
              >
                <ExternalLink size={11} aria-hidden="true" />
                {src}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SignalRow({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', lineHeight: 1.5, alignItems: 'flex-start' }}>
      <span style={{ width: '6rem', flexShrink: 0, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1, color: 'var(--color-text)' }}>
        {value}
        {source && (
          <>
            {' '}
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Source for ${label}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                color: 'var(--color-text-subtle)',
                verticalAlign: 'baseline',
                marginLeft: '0.125rem',
              }}
            >
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          </>
        )}
      </span>
    </div>
  )
}

// ── BulkImportPanel ────────────────────────────────────────────────────────
//
// Paste-CSV importer. Two phases: paste-and-map, then dry-run preview,
// then actually write. Column mapping auto-detects sensible header
// names (Name, Email, Company, Website, Phone, Job title, Brief, Source
// detail, Estimated value) and lets you override.

function BulkImportPanel({ onDone }: { onDone: () => Promise<void> }) {
  const [csv, setCsv] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [defaultSource, setDefaultSource] = useState('cold_outreach')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null)
  const [summary, setSummary] = useState<{ parsed: number; created: number; skipped: number; errors: Array<{ row: number; error: string }> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const LEAD_FIELDS: Array<{ key: string; label: string }> = [
    { key: 'name', label: 'Name *' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'company', label: 'Company' },
    { key: 'jobTitle', label: 'Job title' },
    { key: 'website', label: 'Website' },
    { key: 'brief', label: 'Brief / notes' },
    { key: 'sourceDetail', label: 'Source detail' },
    { key: 'estimatedValue', label: 'Estimated value' },
  ]

  function parseHeadersFromCsv(raw: string) {
    const firstLine = raw.split(/\r?\n/)[0] ?? ''
    if (!firstLine.trim()) { setHeaders([]); return }
    // Same simple CSV parse as the backend (good enough for the header row).
    const cols: string[] = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i]
      if (inQuotes) {
        if (ch === '"' && firstLine[i + 1] !== '"') inQuotes = false
        else if (ch === '"') { field += '"'; i++ }
        else field += ch
      } else {
        if (ch === '"') inQuotes = true
        else if (ch === ',') { cols.push(field); field = '' }
        else field += ch
      }
    }
    cols.push(field)
    const trimmed = cols.map(c => c.trim())
    setHeaders(trimmed)

    // Auto-detect mappings on header-name match (case-insensitive).
    const next: Record<string, string> = {}
    for (const f of LEAD_FIELDS) {
      const match = trimmed.find(h => h.toLowerCase().replace(/[\s_]/g, '') === f.key.toLowerCase().replace(/[\s_]/g, ''))
        ?? trimmed.find(h => h.toLowerCase() === f.label.toLowerCase().replace(' *', ''))
        ?? trimmed.find(h => f.key === 'name' && /^(name|full ?name|contact|lead)$/i.test(h))
        ?? trimmed.find(h => f.key === 'company' && /^(company|organisation|organization|business)$/i.test(h))
        ?? trimmed.find(h => f.key === 'website' && /^(website|url|domain|site)$/i.test(h))
        ?? trimmed.find(h => f.key === 'email' && /^(email|e-?mail)$/i.test(h))
        ?? trimmed.find(h => f.key === 'phone' && /^(phone|mobile|tel)$/i.test(h))
        ?? trimmed.find(h => f.key === 'jobTitle' && /^(title|job ?title|role|position)$/i.test(h))
      if (match) next[f.key] = match
    }
    setMapping(next)
  }

  async function runDryRun() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/leads/bulk-import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv,
          mapping,
          defaults: { source: defaultSource },
          skipDuplicates,
          dryRun: true,
        }),
      })
      const data = await res.json() as {
        parsed?: number; created?: number; skipped?: number
        errors?: Array<{ row: number; error: string }>
        preview?: Record<string, unknown>[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Dry-run failed')
      setSummary({
        parsed: data.parsed ?? 0,
        created: 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? [],
      })
      setPreview(data.preview ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dry-run failed')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/leads/bulk-import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv,
          mapping,
          defaults: { source: defaultSource },
          skipDuplicates,
          dryRun: false,
        }),
      })
      const data = await res.json() as {
        parsed?: number; created?: number; skipped?: number
        errors?: Array<{ row: number; error: string }>
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setSummary({
        parsed: data.parsed ?? 0,
        created: data.created ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? [],
      })
      setPreview(null)
      // If everything imported cleanly, close + refresh after a beat.
      if ((data.errors?.length ?? 0) === 0) {
        setTimeout(() => { void onDone() }, 1200)
      } else {
        await onDone()  // refresh in background; keep panel open so Liam sees errors
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SlideOver.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {/* CSV paste */}
          <Field label="CSV (paste from Google Sheets, Excel, etc — include header row)">
            <textarea
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value)
                parseHeadersFromCsv(e.target.value)
                setPreview(null)
                setSummary(null)
              }}
              rows={10}
              placeholder="Name, Email, Company, Website&#10;Anna Walker, anna@glasswall.com, Glasswall, glasswall.com&#10;..."
              className="tahi-textarea"
              style={{ ...textareaStyle, fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
          </Field>

          {headers.length > 0 && (
            <div>
              <SectionLabel>Map columns</SectionLabel>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                {LEAD_FIELDS.map(f => (
                  <Field key={f.key} label={f.label}>
                    <select
                      value={mapping[f.key] ?? ''}
                      onChange={(e) => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                      className="tahi-select"
                      style={selectStyle}
                    >
                      <option value="">— ignore —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </div>
          )}

          {headers.length > 0 && (
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              <Field label="Default source for all rows">
                <select
                  value={defaultSource}
                  onChange={(e) => setDefaultSource(e.target.value)}
                  className="tahi-select"
                  style={selectStyle}
                >
                  {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Duplicate handling">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-sm)' }}>
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                  />
                  Skip rows whose email already exists
                </label>
              </Field>
            </div>
          )}

          {error && (
            <div style={{
              padding: '0.5rem 0.625rem',
              background: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--color-danger)',
            }}>{error}</div>
          )}

          {summary && (
            <div style={{
              padding: '0.75rem 0.875rem',
              background: summary.created > 0 ? 'var(--color-brand-50)' : 'var(--color-bg-secondary)',
              border: `1px solid ${summary.created > 0 ? 'var(--color-brand-100)' : 'var(--color-border-subtle)'}`,
              borderRadius: 'var(--radius-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.375rem',
              fontSize: '0.8125rem',
            }}>
              <div>
                <strong>{summary.parsed}</strong> rows parsed ·
                {summary.created > 0 && <> <strong>{summary.created}</strong> created ·</>}
                {summary.skipped > 0 && <> <strong>{summary.skipped}</strong> skipped ·</>}
                {summary.errors.length > 0 && <> <strong style={{ color: 'var(--color-danger)' }}>{summary.errors.length}</strong> errors</>}
              </div>
              {summary.errors.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '1.125rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                  {summary.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>Row {e.row}: {e.error}</li>
                  ))}
                  {summary.errors.length > 20 && <li>...and {summary.errors.length - 20} more</li>}
                </ul>
              )}
            </div>
          )}

          {preview && preview.length > 0 && (
            <div>
              <SectionLabel>Preview (first {preview.length})</SectionLabel>
              <div style={{
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                overflow: 'auto',
                maxHeight: '16rem',
              }}>
                <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg-secondary)' }}>
                      <th style={previewTh}>#</th>
                      <th style={previewTh}>Name</th>
                      <th style={previewTh}>Email</th>
                      <th style={previewTh}>Company</th>
                      <th style={previewTh}>Website</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                        <td style={previewTd}>{String((p as { rowIndex?: number }).rowIndex ?? i + 2)}</td>
                        <td style={previewTd}>{String((p as { name?: string }).name ?? '')}</td>
                        <td style={previewTd}>{String((p as { email?: string | null }).email ?? '')}</td>
                        <td style={previewTd}>{String((p as { company?: string | null }).company ?? '')}</td>
                        <td style={previewTd}>{String((p as { website?: string | null }).website ?? '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={() => { void onDone() }} disabled={busy}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          variant="secondary"
          size="sm"
          onClick={runDryRun}
          disabled={busy || !csv.trim() || !mapping.name}
        >
          {busy && !summary?.created ? 'Checking...' : 'Preview'}
        </TahiButton>
        <TahiButton
          size="sm"
          onClick={runImport}
          disabled={busy || !csv.trim() || !mapping.name || !preview}
          iconLeft={<Upload className="w-3.5 h-3.5" />}
        >
          {busy && summary != null ? 'Importing...' : 'Import leads'}
        </TahiButton>
      </SlideOver.Footer>
    </>
  )
}

const previewTh: React.CSSProperties = {
  padding: '0.4375rem 0.625rem',
  textAlign: 'left',
  fontSize: '0.625rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
  whiteSpace: 'nowrap',
}
const previewTd: React.CSSProperties = {
  padding: '0.375rem 0.625rem',
  color: 'var(--color-text)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '12rem',
}

function fieldLabel(field: keyof Lead): string {
  switch (field) {
    case 'jobTitle': return 'Job title'
    case 'name':     return 'Name'
    case 'email':    return 'Email'
    case 'company':  return 'Company'
    case 'website':  return 'Website'
    case 'phone':    return 'Phone'
    default:         return String(field)
  }
}

function normaliseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return '#'
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString()}`
  }
}
