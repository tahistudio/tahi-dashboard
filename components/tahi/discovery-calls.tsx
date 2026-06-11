'use client'

/**
 * <DiscoveryCallsCard>
 *
 * Polymorphic discovery-calls UI. Renders the "Calls" card on any
 * parent surface (lead, deal, request, task, org). Self-contained:
 * fetches its own data, handles its own CRUD, calls `onChanged` so
 * the host page can refresh its own activity timeline.
 *
 * Inline form for scheduling. Each call row expands to reveal post-call
 * fields (transcript, summary, outcome, scope, budget, timeline) plus
 * AI extraction button + (lead-only) "Create deal from this call".
 *
 *   <DiscoveryCallsCard
 *     parentType="deal"
 *     parentId={deal.id}
 *     onChanged={() => refetchDeal()}
 *   />
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Plus, ArrowUpRight, ChevronDown, Sparkles, RefreshCw } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Input } from '@/components/tahi/input'
import { apiPath } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────

export type CallParentType = 'lead' | 'deal' | 'request' | 'task' | 'org'

export interface DiscoveryCall {
  id: string
  leadId: string | null
  dealId: string | null
  requestId: string | null
  taskId: string | null
  orgId: string | null
  title: string
  scheduledAt: string
  durationMinutes: number
  googleMeetUrl: string | null
  googleCalendarEventId: string | null
  attendees: string
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled'
  transcript: string | null
  transcriptSource: string | null
  summary: string | null
  outcome: string | null
  outcomeNotes: string | null
  scopeNotes: string | null
  budgetMin: number | null
  budgetMax: number | null
  budgetCurrency: string | null
  timeline: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

const CALL_OUTCOMES: Array<{ value: string; label: string; tone: BadgeTone }> = [
  { value: 'good_call', label: 'Good call',            tone: 'positive' },
  { value: 'promote',   label: 'Ready to promote',     tone: 'brand' },
  { value: 'nurture',   label: 'Nurture',              tone: 'warning' },
  { value: 'archive',   label: 'Archive',              tone: 'neutral' },
  { value: 'no_show',   label: 'No-show',              tone: 'danger' },
]
const CALL_TIMELINES: Array<{ value: string; label: string }> = [
  { value: 'urgent',       label: 'Urgent (this month)' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year',    label: 'This year' },
  { value: 'no_rush',      label: 'No rush' },
]

const PARENT_PATH: Record<CallParentType, string> = {
  lead: '/api/admin/leads',
  deal: '/api/admin/deals',
  request: '/api/admin/requests',
  task: '/api/admin/tasks',
  // orgs are at /api/admin/clients in this codebase (legacy naming —
  // see Decision #001 in DECISIONS.md). Same `organisations` table.
  org: '/api/admin/clients',
}

// ── Main component ────────────────────────────────────────────────────────

export interface DiscoveryCallsCardProps {
  parentType: CallParentType
  parentId: string
  /** Fires after any mutation. Lets the parent page refetch its own
   *  activity timeline so call_scheduled / call_completed events show up. */
  onChanged?: () => void
  /** Lead-only: shown as a "Create deal from this call" button on
   *  completed calls with outcome=promote or good_call. The parent
   *  page is responsible for the actual promotion flow. */
  promoteToDealAction?: (call: DiscoveryCall) => Promise<void>
  /** When true, suppress the "Create deal" button (already promoted). */
  parentAlreadyPromoted?: boolean
}

export function DiscoveryCallsCard({
  parentType,
  parentId,
  onChanged,
  promoteToDealAction,
  parentAlreadyPromoted,
}: DiscoveryCallsCardProps) {
  const [calls, setCalls] = useState<DiscoveryCall[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const fetchCalls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`${PARENT_PATH[parentType]}/${parentId}/calls`))
      if (!res.ok) { setCalls([]); return }
      const data = await res.json() as { calls: DiscoveryCall[] }
      setCalls(data.calls ?? [])
    } catch {
      setCalls([])
    } finally {
      setLoading(false)
    }
  }, [parentType, parentId])

  useEffect(() => { void fetchCalls() }, [fetchCalls])

  async function refreshAndBubble() {
    await fetchCalls()
    onChanged?.()
  }

  async function createCall(body: CallScheduleBody) {
    await fetch(apiPath(`${PARENT_PATH[parentType]}/${parentId}/calls`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await refreshAndBubble()
  }

  async function updateCall(callId: string, patch: Partial<DiscoveryCall>) {
    await fetch(apiPath(`/api/admin/discovery-calls/${callId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await refreshAndBubble()
  }

  async function deleteCall(callId: string) {
    await fetch(apiPath(`/api/admin/discovery-calls/${callId}`), { method: 'DELETE' })
    await refreshAndBubble()
  }

  async function extractCall(callId: string): Promise<Partial<DiscoveryCall> | null> {
    const res = await fetch(apiPath(`/api/admin/discovery-calls/${callId}/extract`), { method: 'POST' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
      throw new Error(err.detail ?? err.error ?? 'Extraction failed')
    }
    const data = await res.json() as { suggestions: Partial<DiscoveryCall> }
    return data.suggestions ?? null
  }

  const now = Date.now()
  const upcoming = calls.filter(c => new Date(c.scheduledAt).getTime() >= now && c.status === 'scheduled')
  const past = calls.filter(c => !upcoming.includes(c))

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
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
        }}>Calls</div>
        {!showForm && (
          <TahiButton
            size="sm"
            variant="secondary"
            onClick={() => setShowForm(true)}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
          >
            Schedule
          </TahiButton>
        )}
      </header>

      {showForm && (
        <CallScheduleForm
          onSubmit={async (body) => { await createCall(body); setShowForm(false) }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading && !showForm && calls.length === 0 && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Loading calls...</p>
      )}

      {!loading && calls.length === 0 && !showForm && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)', lineHeight: 1.5 }}>
          No calls yet. Schedule one to start tracking transcripts, outcomes, and scope.
        </p>
      )}

      {upcoming.length > 0 && (
        <div>
          <SubSectionLabel>Upcoming</SubSectionLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4375rem' }}>
            {upcoming.map(c => (
              <CallRow
                key={c.id}
                call={c}
                showPromote={!!promoteToDealAction && !parentAlreadyPromoted}
                onUpdate={(p) => updateCall(c.id, p)}
                onDelete={() => deleteCall(c.id)}
                onExtract={() => extractCall(c.id)}
                onPromote={promoteToDealAction ? () => promoteToDealAction(c) : null}
              />
            ))}
          </ul>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <SubSectionLabel>{upcoming.length > 0 ? 'Past' : 'Past calls'}</SubSectionLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4375rem' }}>
            {past.map(c => (
              <CallRow
                key={c.id}
                call={c}
                showPromote={!!promoteToDealAction && !parentAlreadyPromoted}
                onUpdate={(p) => updateCall(c.id, p)}
                onDelete={() => deleteCall(c.id)}
                onExtract={() => extractCall(c.id)}
                onPromote={promoteToDealAction ? () => promoteToDealAction(c) : null}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ── Internals ─────────────────────────────────────────────────────────────

interface CallScheduleBody {
  title: string
  scheduledAt: string
  durationMinutes?: number
  googleMeetUrl?: string | null
  attendees?: Array<{ name?: string; email?: string; role?: string }>
}

function SubSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.5625rem',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--color-text-subtle)',
      marginBottom: '0.375rem',
      marginTop: '0.5rem',
    }}>{children}</div>
  )
}

function CallScheduleForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: CallScheduleBody) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState('Discovery call')
  const defaultDateTime = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(10, 0, 0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })()
  const [scheduledAt, setScheduledAt] = useState(defaultDateTime)
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [meetUrl, setMeetUrl] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim() || !scheduledAt) return
    setSaving(true)
    try {
      await onSubmit({
        title: title.trim(),
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: durationMinutes || 30,
        googleMeetUrl: meetUrl.trim() || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      padding: '0.75rem',
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    }}>
      <FieldLabel label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} inputSize="sm" />
      </FieldLabel>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        <FieldLabel label="When">
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="tahi-input"
            style={{ ...miniInputStyle, width: '100%' }}
          />
        </FieldLabel>
        <FieldLabel label="Duration (min)">
          <Input
            type="number"
            value={String(durationMinutes)}
            onChange={(e) => setDurationMinutes(Number(e.target.value) || 30)}
            inputSize="sm"
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Meet URL (paste from Google Calendar)">
        <Input
          value={meetUrl}
          onChange={(e) => setMeetUrl(e.target.value)}
          placeholder="https://meet.google.com/..."
          inputSize="sm"
        />
      </FieldLabel>
      <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
        <TahiButton variant="secondary" size="sm" onClick={onCancel}>Cancel</TahiButton>
        <TahiButton size="sm" onClick={submit} disabled={saving || !title.trim() || !scheduledAt}>
          {saving ? 'Scheduling...' : 'Schedule call'}
        </TahiButton>
      </div>
    </div>
  )
}

function CallRow({
  call,
  showPromote,
  onUpdate,
  onDelete,
  onExtract,
  onPromote,
}: {
  call: DiscoveryCall
  showPromote: boolean
  onUpdate: (patch: Partial<DiscoveryCall>) => Promise<void>
  onDelete: () => Promise<void>
  onExtract: () => Promise<Partial<DiscoveryCall> | null>
  onPromote: (() => Promise<void>) | null
}) {
  const [expanded, setExpanded] = useState(false)
  const isUpcoming = new Date(call.scheduledAt).getTime() >= Date.now() && call.status === 'scheduled'
  const outcomeDef = CALL_OUTCOMES.find(o => o.value === call.outcome)
  const promoteOk = showPromote && call.status === 'completed' && (call.outcome === 'promote' || call.outcome === 'good_call')

  return (
    <li style={{
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-bg-secondary)',
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '0.5rem 0.75rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-private style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
            {call.title}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
            {formatCallDate(call.scheduledAt)} · {call.durationMinutes} min
          </div>
        </div>
        {outcomeDef && (
          <Badge tone={outcomeDef.tone} variant="soft" size="sm" dot={false}>
            {outcomeDef.label}
          </Badge>
        )}
        {isUpcoming && (
          <Badge tone="info" variant="soft" size="sm" dot={false}>Upcoming</Badge>
        )}
        <ChevronDown
          size={12}
          aria-hidden="true"
          style={{
            color: 'var(--color-text-subtle)',
            transition: 'transform 200ms ease',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {expanded && (
        <div style={{
          padding: '0.75rem',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.625rem',
        }}>
          {call.googleMeetUrl && (
            <div style={{ fontSize: '0.75rem' }}>
              <a
                href={call.googleMeetUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--color-text-active)',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                  textDecorationColor: 'var(--color-brand-100)',
                }}
              >
                Open Meet link
              </a>
            </div>
          )}

          <CallPostFields call={call} onUpdate={onUpdate} onExtract={onExtract} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => { void onDelete() }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-danger)',
                fontSize: '0.6875rem',
                cursor: 'pointer',
                padding: '0.25rem 0.4375rem',
              }}
            >
              Delete call
            </button>
            {promoteOk && onPromote && (
              <TahiButton
                size="sm"
                onClick={() => { void onPromote() }}
                iconLeft={<ArrowUpRight className="w-3.5 h-3.5" />}
              >
                Create deal from this call
              </TahiButton>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function CallPostFields({
  call,
  onUpdate,
  onExtract,
}: {
  call: DiscoveryCall
  onUpdate: (patch: Partial<DiscoveryCall>) => Promise<void>
  onExtract: () => Promise<Partial<DiscoveryCall> | null>
}) {
  const [transcript, setTranscript] = useState(call.transcript ?? '')
  const [summary, setSummary] = useState(call.summary ?? '')
  const [outcome, setOutcome] = useState(call.outcome ?? '')
  const [outcomeNotes, setOutcomeNotes] = useState(call.outcomeNotes ?? '')
  const [scopeNotes, setScopeNotes] = useState(call.scopeNotes ?? '')
  const [budgetMin, setBudgetMin] = useState(call.budgetMin?.toString() ?? '')
  const [budgetMax, setBudgetMax] = useState(call.budgetMax?.toString() ?? '')
  const [budgetCurrency, setBudgetCurrency] = useState(call.budgetCurrency ?? 'NZD')
  const [timeline, setTimeline] = useState(call.timeline ?? '')
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<Partial<DiscoveryCall> | null>(null)

  const dirty =
    transcript !== (call.transcript ?? '')
    || summary !== (call.summary ?? '')
    || outcome !== (call.outcome ?? '')
    || outcomeNotes !== (call.outcomeNotes ?? '')
    || scopeNotes !== (call.scopeNotes ?? '')
    || budgetMin !== (call.budgetMin?.toString() ?? '')
    || budgetMax !== (call.budgetMax?.toString() ?? '')
    || budgetCurrency !== (call.budgetCurrency ?? 'NZD')
    || timeline !== (call.timeline ?? '')

  async function save() {
    setSaving(true)
    try {
      const patch: Partial<DiscoveryCall> = {
        transcript: transcript.trim() || null,
        transcriptSource: transcript.trim() ? (call.transcriptSource ?? 'manual_paste') : null,
        summary: summary.trim() || null,
        outcome: outcome || null,
        outcomeNotes: outcomeNotes.trim() || null,
        scopeNotes: scopeNotes.trim() || null,
        budgetMin: budgetMin ? Number(budgetMin) : null,
        budgetMax: budgetMax ? Number(budgetMax) : null,
        budgetCurrency: budgetCurrency || null,
        timeline: timeline || null,
      }
      if (outcome && call.status === 'scheduled') {
        (patch as Record<string, unknown>).status = 'completed'
      }
      await onUpdate(patch)
    } finally {
      setSaving(false)
    }
  }

  async function runExtraction() {
    setExtracting(true)
    setExtractionError(null)
    try {
      const s = await onExtract()
      if (s && Object.keys(s).length > 0) setSuggestion(s)
      else setExtractionError('No suggestions returned. Make sure the transcript has been saved first.')
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  function applySuggestion() {
    if (!suggestion) return
    if (suggestion.outcome && !outcome) setOutcome(suggestion.outcome)
    if (suggestion.summary && !summary.trim()) setSummary(suggestion.summary)
    if (suggestion.outcomeNotes && !outcomeNotes.trim()) setOutcomeNotes(suggestion.outcomeNotes)
    if (suggestion.scopeNotes && !scopeNotes.trim()) setScopeNotes(suggestion.scopeNotes)
    if (suggestion.budgetMin != null && !budgetMin) setBudgetMin(String(suggestion.budgetMin))
    if (suggestion.budgetMax != null && !budgetMax) setBudgetMax(String(suggestion.budgetMax))
    if (suggestion.budgetCurrency && budgetCurrency === 'NZD') setBudgetCurrency(suggestion.budgetCurrency)
    if (suggestion.timeline && !timeline) setTimeline(suggestion.timeline)
    setSuggestion(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {transcript.trim() && !suggestion && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0.5rem 0.625rem',
          background: 'var(--color-brand-50)',
          border: '1px solid var(--color-brand-100)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.75rem',
          color: 'var(--color-brand-dark)',
        }}>
          <span>Have AI extract outcome, scope, budget, and next step from the transcript.</span>
          <TahiButton
            size="sm"
            variant="secondary"
            onClick={() => { void runExtraction() }}
            disabled={extracting}
            iconLeft={extracting
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
          >
            {extracting ? 'Extracting...' : 'Extract'}
          </TahiButton>
        </div>
      )}

      {suggestion && (
        <div style={{
          padding: '0.75rem 0.875rem',
          background: 'var(--color-brand-50)',
          border: '1px solid var(--color-brand-100)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-brand-dark)' }}>
            AI suggestions from the transcript
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {suggestion.outcome && <SuggestionLine label="Outcome" value={CALL_OUTCOMES.find(o => o.value === suggestion.outcome)?.label ?? suggestion.outcome} />}
            {suggestion.summary && <SuggestionLine label="Summary" value={suggestion.summary} />}
            {suggestion.outcomeNotes && <SuggestionLine label="Next step" value={suggestion.outcomeNotes} />}
            {suggestion.scopeNotes && <SuggestionLine label="Scope" value={suggestion.scopeNotes} />}
            {(suggestion.budgetMin != null || suggestion.budgetMax != null) && (
              <SuggestionLine label="Budget" value={`${suggestion.budgetMin ?? '?'} - ${suggestion.budgetMax ?? '?'} ${suggestion.budgetCurrency ?? ''}`.trim()} />
            )}
            {suggestion.timeline && <SuggestionLine label="Timeline" value={CALL_TIMELINES.find(t => t.value === suggestion.timeline)?.label ?? suggestion.timeline} />}
          </ul>
          <div style={{ display: 'flex', gap: '0.4375rem', justifyContent: 'flex-end' }}>
            <TahiButton size="sm" variant="secondary" onClick={() => setSuggestion(null)}>Dismiss</TahiButton>
            <TahiButton size="sm" onClick={applySuggestion}>Apply to empty fields</TahiButton>
          </div>
        </div>
      )}

      {extractionError && (
        <div style={{
          padding: '0.4375rem 0.625rem',
          background: 'var(--color-danger-bg)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.6875rem',
          color: 'var(--color-danger)',
        }}>{extractionError}</div>
      )}

      <FieldLabel label="Outcome">
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="tahi-select"
          style={miniInputStyle}
        >
          <option value="">— pick after the call —</option>
          {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FieldLabel>

      <FieldLabel label="Summary (2-3 lines, the headline)">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="tahi-textarea"
          style={textareaStyle}
        />
      </FieldLabel>

      <FieldLabel label="Outcome notes (what's the next step?)">
        <textarea
          value={outcomeNotes}
          onChange={(e) => setOutcomeNotes(e.target.value)}
          rows={2}
          className="tahi-textarea"
          style={textareaStyle}
        />
      </FieldLabel>

      <FieldLabel label="Scope notes (pages, design, integrations, etc)">
        <textarea
          value={scopeNotes}
          onChange={(e) => setScopeNotes(e.target.value)}
          rows={3}
          className="tahi-textarea"
          style={textareaStyle}
        />
      </FieldLabel>

      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        <FieldLabel label="Budget (min - max)">
          <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
            <Input type="number" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="min" inputSize="sm" />
            <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.75rem' }}>to</span>
            <Input type="number" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="max" inputSize="sm" />
            <select
              value={budgetCurrency}
              onChange={(e) => setBudgetCurrency(e.target.value)}
              className="tahi-select"
              style={{ ...miniInputStyle, width: '5rem' }}
            >
              <option value="NZD">NZD</option>
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </FieldLabel>
        <FieldLabel label="Timeline">
          <select
            value={timeline}
            onChange={(e) => setTimeline(e.target.value)}
            className="tahi-select"
            style={miniInputStyle}
          >
            <option value="">— unknown —</option>
            {CALL_TIMELINES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </FieldLabel>
      </div>

      <FieldLabel label="Transcript (paste from Google Meet Gemini)">
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={6}
          placeholder="Paste the Gemini transcript here. Capped at 50k characters."
          className="tahi-textarea"
          style={textareaStyle}
        />
      </FieldLabel>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <TahiButton size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving...' : 'Save call notes'}
        </TahiButton>
      </div>
    </div>
  )
}

function SuggestionLine({ label, value }: { label: string; value: string }) {
  return (
    <li style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', lineHeight: 1.5 }}>
      <span style={{ width: '5.5rem', flexShrink: 0, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
      <span data-private style={{ flex: 1, color: 'var(--color-text)', wordBreak: 'break-word' }}>{value}</span>
    </li>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.3125rem',
      }}>{label}</label>
      {children}
    </div>
  )
}

function formatCallDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const miniInputStyle: React.CSSProperties = {
  height: '2rem',
  padding: '0 0.5625rem',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text)',
  outline: 'none',
  width: '100%',
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
