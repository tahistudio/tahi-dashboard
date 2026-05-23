'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  UserPlus, Plus, Clock, RefreshCw, Save, Trash2, ArrowUpRight,
  Mail, Phone, Building2, Globe, Tag, User, Edit3,
  Sparkles, ExternalLink, ChevronDown,
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
  const [discoveryTemplate, setDiscoveryTemplate] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<Lead> | null>(null)
  const [editSnapshot, setEditSnapshot] = useState<{ website: string | null; company: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
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
      const data = await res.json() as { lead: Lead; discoveryQuestionsTemplate?: string[] }
      setSelectedLead(data.lead)
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
        if (data.dealId) window.location.href = apiPath(`/pipeline?deal=${data.dealId}`)
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
      render: r => {
        const s = STATUS_BY_VALUE.get(r.status)
        return (
          <Badge tone={s?.tone ?? 'neutral'} variant="soft" size="sm" dot={false}>
            {s?.label ?? r.status}
          </Badge>
        )
      },
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
        <TahiButton
          size="sm"
          onClick={handleNew}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          New lead
        </TahiButton>
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
          onRowPreview={(r) => openLead(r.id)}
          rowActions={(r) => [
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
        icon={<User size={15} />}
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
                  discoveryTemplate={discoveryTemplate}
                  enriching={enriching}
                  enrichError={enrichError}
                  onRunEnrich={() => runEnrich(selectedLead.id)}
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
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => runEnrich(selectedLead.id)}
                    disabled={enriching}
                    iconLeft={enriching
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <Sparkles className="w-3.5 h-3.5" />}
                  >
                    {enriching ? 'Researching...' : (selectedLead.enrichedAt ? 'Re-run AI' : 'Run AI')}
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
        icon={<Plus size={15} />}
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
  discoveryTemplate,
  enriching,
  enrichError,
  onRunEnrich,
}: {
  lead: Lead
  discoveryTemplate: string[]
  enriching: boolean
  enrichError: string | null
  onRunEnrich: () => void
}) {
  const status = STATUS_BY_VALUE.get(lead.status)
  const aiSources = safeJsonArray<string>(lead.aiSources)
  const aiQuestions = safeJsonArray<string>(lead.aiQuestions)
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
          <a href={`/pipeline?deal=${lead.promotedDealId}`} style={{ fontWeight: 600, color: 'var(--color-brand-dark)', textDecoration: 'underline' }}>
            Open deal
          </a>
        </div>
      )}
    </div>
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
}: {
  lead: Lead
  aiSources: string[]
  aiQuestions: string[]
  aiSignals: AiSignals
  discoveryTemplate: string[]
  enriching: boolean
  enrichError: string | null
  onRunEnrich: () => void
}) {
  const hasEnrichment = !!lead.enrichedAt
  const scoreTone: BadgeTone =
    lead.aiScore == null ? 'neutral'
    : lead.aiScore >= 80 ? 'positive'
    : lead.aiScore >= 60 ? 'brand'
    : lead.aiScore >= 40 ? 'warning'
    : 'neutral'

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '0.875rem 1rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
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
      </header>

      {!hasEnrichment && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          Sonnet 4.6 will research this lead on the web, draft a short briefing with sources, and suggest 3 discovery questions tailored to them. Run it now or wait for the daily cron to scoop it up.
          <div style={{ marginTop: '0.625rem' }}>
            <TahiButton
              size="sm"
              onClick={onRunEnrich}
              disabled={enriching}
              iconLeft={enriching
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />}
            >
              {enriching ? 'Researching...' : 'Run AI now'}
            </TahiButton>
          </div>
        </div>
      )}

      {lead.aiScoreReason && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          {lead.aiScoreReason}
        </p>
      )}

      {lead.aiSummary && <BriefingSummary raw={lead.aiSummary} />}

      {Object.keys(aiSignals).length > 0 && (
        <div>
          <SectionLabel>Company signals</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3125rem' }}>
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
        </div>
      )}

      {aiSources.length > 0 && <SourcesToggle sources={aiSources} />}

      {discoveryTemplate.length > 0 && (
        <div>
          <SectionLabel>Always ask</SectionLabel>
          <ol style={{ margin: 0, paddingLeft: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.4375rem' }}>
            {discoveryTemplate.map((q, i) => (
              <li key={`t-${i}`} style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}

      {aiQuestions.length > 0 && (
        <div>
          <SectionLabel>For this lead</SectionLabel>
          <ol style={{ margin: 0, paddingLeft: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.4375rem' }}>
            {aiQuestions.map((q, i) => (
              <li key={`q-${i}`} style={{
                fontSize: '0.8125rem',
                color: 'var(--color-text)',
                lineHeight: 1.5,
              }}>
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}

      {enrichError && (
        <div style={{
          padding: '0.5rem 0.625rem',
          background: 'var(--color-danger-bg)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.75rem',
          color: 'var(--color-danger)',
        }}>
          {enrichError}
        </div>
      )}

      {lead.aiTokensSpent != null && lead.aiTokensSpent > 0 && (
        <p style={{
          margin: 0,
          fontSize: '0.625rem',
          color: 'var(--color-text-subtle)',
          textAlign: 'right',
        }}>
          {lead.aiTokensSpent.toLocaleString()} tokens spent on this lead
        </p>
      )}
    </section>
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
