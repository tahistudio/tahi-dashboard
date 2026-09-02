'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import {
  X, Loader2, Zap, CheckCircle2, Lock, Layers, AlignLeft,
  Sparkles, ChevronRight, Check, Inbox, ArrowUp, ArrowLeftRight,
} from 'lucide-react'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { useToast } from '@/components/tahi/toast'
import { usePermissions } from '@/components/tahi/permissions-context'
import { AiRequestWizard } from '@/components/tahi/ai-request-wizard'
import {
  suggestRequestSize,
  sizeToRequestType,
  type SizeSuggestion,
} from '@/lib/request-size-suggestion'

// ── Constants ──────────────────────────────────────────────────────────────────

const BRAND_HEX = 'var(--color-brand)'

// ── Types ──────────────────────────────────────────────────────────────────────

interface OrgOption {
  id: string
  name: string
  planType?: string | null
}

interface NewRequestDialogProps {
  open: boolean
  onClose: () => void
  isAdmin: boolean
  /** Portal only: does the client's plan allow large_task requests? */
  canUseLargeTrack?: boolean
  /** Pre-select a client org when opening from a client's page */
  defaultOrgId?: string
  /** When set: the new request will be created as a sub-request of this parent.
   *  Posts to /api/admin/requests/{parentRequestId}/sub-requests, locks client
   *  to parent's org, and hides the client picker. */
  parentRequestId?: string
  /** When set together with parentRequestId: locks client picker to this org
   *  and hides it. Use for the "New sub-request" button on a parent's detail
   *  page. */
  forceOrgId?: string
  /** Optional callback invoked after a successful creation. If provided we
   *  skip the default navigation to /requests/[id] — the caller typically
   *  wants to stay on the parent page and refresh. */
  onCreated?: (newRequestId: string) => void
  /** Pre-fills the form from an AI-authored draft. Marks the size suggestion
   *  as AI-attributed ("Suggested by AI assist: ..."). */
  aiDraft?: { title?: string; description?: string; category?: string } | null
}

/** Where a client wants their new request to sit against work already moving. */
type Placement = 'queue' | 'top' | 'replace'

const PLACEMENT_OPTIONS: Array<{
  value: Placement
  label: string
  sub: string
  icon: typeof Inbox
}> = [
  {
    value: 'queue',
    label: 'Add to my queue',
    sub: 'Slots in after anything ahead of it',
    icon: Inbox,
  },
  {
    value: 'top',
    label: 'Bump to the top',
    sub: 'Do this one next, before the rest',
    icon: ArrowUp,
  },
  {
    value: 'replace',
    label: 'Replace what is in progress',
    sub: 'Pause the current build and start this now',
    icon: ArrowLeftRight,
  },
]

/** What the portal POST hands back once a placement was sent. */
interface CreatedSummary {
  id: string
  requestNumber: number | null
  placement: Placement | null
  queuePosition: number | null
  planLabel: string | null
  retainer: boolean
}

const REQUEST_TYPES = [
  {
    value: 'small_task',
    label: 'Small task',
    desc: '≤ 1 day',
    icon: AlignLeft,
    hint: 'Content updates, bug fixes, quick changes',
  },
  {
    value: 'large_task',
    label: 'Large task',
    desc: 'Multi-day',
    icon: Layers,
    hint: 'New features, redesigns, complex builds',
    requiresScale: true,
  },
]

const CATEGORIES = [
  { value: 'development', label: 'Development' },
  { value: 'design',      label: 'Design'      },
  { value: 'content',     label: 'Content'     },
  { value: 'strategy',    label: 'Strategy'    },
  { value: 'admin',       label: 'Admin'       },
  { value: 'bug',         label: 'Bug fix'     },
]

// ── Component ──────────────────────────────────────────────────────────────────

export function NewRequestDialog({
  open, onClose, isAdmin, canUseLargeTrack = true, defaultOrgId,
  parentRequestId, forceOrgId, onCreated, aiDraft,
}: NewRequestDialogProps) {
  const isSubRequest = !!parentRequestId
  const router = useRouter()
  const { showToast } = useToast()
  // The ported dialog (AI entry, size as a suggestion, queue placement,
  // confirmation screen) is Liam and Staci only while it beds in. Everyone
  // else, real clients included, keeps the dialog they have today. The one
  // exception is the team hint line under the size control, which is purely
  // additive and ships for every team user.
  const { isSuperAdmin } = usePermissions()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createAnother, setCreateAnother] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Admin: client picker
  const [clients, setClients] = useState<OrgOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientOrgId, setClientOrgId] = useState('')

  // Admin: brand picker (filtered by selected client)
  const [brandOptions, setBrandOptions] = useState<{ id: string; name: string }[]>([])
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [brandId, setBrandId] = useState('')

  // Derived: does the selected client use tracks (maintain/scale)?
  const selectedClient = clients.find(c => c.id === clientOrgId)
  const clientUsesTracks = isAdmin
    ? selectedClient?.planType === 'maintain' || selectedClient?.planType === 'scale'
    : canUseLargeTrack // portal: parent component controls this
  const showTrackSelector = isAdmin ? clientUsesTracks : true

  // Form fields
  const [title, setTitle] = useState('')
  const [type, setType] = useState('small_task')
  const [category, setCategory] = useState('development')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('standard')
  const [isInternal, setIsInternal] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')

  // ── Ported dialog state (super-admin path) ────────────────────────────────
  // Client audience: where the request sits against work already moving.
  const [placement, setPlacement] = useState<Placement>('queue')
  // Client audience: the size control stays hidden behind the suggestion
  // until the person opens Change.
  const [sizeChangeOpen, setSizeChangeOpen] = useState(false)
  // True once the brief was drafted by the AI assist, which the chip credits.
  const [aiDrafted, setAiDrafted] = useState(false)
  // The AI wizard replaces the panel while it is open, matching the
  // prototype's form / ai / done views.
  const [aiOpen, setAiOpen] = useState(false)
  // Set on a successful client submit so the confirmation screen replaces
  // the form instead of navigating away.
  const [created, setCreated] = useState<CreatedSummary | null>(null)

  // Intake form questions (portal only)
  interface FormQuestion {
    id: string
    type: 'text' | 'textarea' | 'url' | 'select' | 'multiselect' | 'checkbox' | 'file'
    label: string
    required: boolean
    options?: string[]
  }
  const [intakeQuestions, setIntakeQuestions] = useState<FormQuestion[]>([])
  const [formResponses, setFormResponses] = useState<Record<string, string>>({})
  const [intakeLoading, setIntakeLoading] = useState(false)

  // Load intake form when category changes (portal only)
  useEffect(() => {
    if (isAdmin || !open) return
    setIntakeLoading(true)
    fetch(apiPath(`/api/portal/request-forms?category=${category}`))
      .then(r => r.json() as Promise<{ form?: { questions: string } }>)
      .then(data => {
        if (data.form?.questions) {
          // API may return already-parsed array or JSON string
          const q = data.form.questions
          const parsed = typeof q === 'string' ? JSON.parse(q) as FormQuestion[] : q as unknown as FormQuestion[]
          setIntakeQuestions(Array.isArray(parsed) ? parsed : [])
        } else {
          setIntakeQuestions([])
        }
      })
      .catch(() => setIntakeQuestions([]))
      .finally(() => setIntakeLoading(false))
  }, [category, open, isAdmin])

  // Load client list for admin
  useEffect(() => {
    if (!open || !isAdmin) return
    setClientsLoading(true)
    fetch(apiPath('/api/admin/clients?status=active'))
      .then(r => r.json() as Promise<{ organisations: Array<{ id: string; name: string; planType?: string | null }> }>)
      .then(data => setClients((data.organisations ?? []).map(o => ({ id: o.id, name: o.name, planType: o.planType }))))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false))
  }, [open, isAdmin])

  // Fetch brands when client changes (admin only)
  useEffect(() => {
    if (!isAdmin || !clientOrgId) {
      setBrandOptions([])
      setBrandId('')
      return
    }
    setBrandsLoading(true)
    fetch(apiPath(`/api/admin/brands?orgId=${clientOrgId}`))
      .then(r => r.json() as Promise<{ items: Array<{ id: string; name: string }> }>)
      .then(data => setBrandOptions((data.items ?? []).map(b => ({ id: b.id, name: b.name }))))
      .catch(() => setBrandOptions([]))
      .finally(() => setBrandsLoading(false))
  }, [isAdmin, clientOrgId])

  // Reset on open
  useEffect(() => {
    if (open) {
      setTitle('')
      setType('small_task')
      setCategory('development')
      setDescription('')
      setPriority('standard')
      setIsInternal(false)
      setFormResponses({})
      setIntakeQuestions([])
      setStartDate('')
      setDueDate('')
      setEstimatedHours('')
      setClientOrgId(forceOrgId ?? defaultOrgId ?? '')
      setBrandId('')
      setBrandOptions([])
      setError(null)
      setSuccessMessage(null)
      setCreateAnother(false)
      setPlacement('queue')
      setSizeChangeOpen(false)
      setAiDrafted(false)
      setAiOpen(false)
      setCreated(null)
    }
  }, [open])

  // Reset type to small_task if selected client is on maintain plan
  useEffect(() => {
    if (isAdmin && selectedClient?.planType === 'maintain' && type === 'large_task') {
      setType('small_task')
    }
  }, [isAdmin, selectedClient?.planType, type])

  // ── Size suggestion ───────────────────────────────────────────────────────
  // Whether a multi-day track is on the table at all. Admin reads it off the
  // selected client's plan, the portal off the prop its page resolved.
  const largeAllowed = isAdmin ? selectedClient?.planType !== 'maintain' : canUseLargeTrack
  const suggestion: SizeSuggestion = useMemo(
    () => suggestRequestSize({
      brief: description,
      category,
      canUseLargeTrack: largeAllowed,
      fromAi: aiDrafted,
    }),
    [description, category, largeAllowed, aiDrafted],
  )
  // Clients see the suggestion instead of the control until they open Change.
  const clientSuggestion = !isAdmin && isSuperAdmin
  const suggestionShowing = clientSuggestion && !sizeChangeOpen
  // While the suggestion is showing it drives the submitted type, so what the
  // chip says and what we post can never drift apart.
  useEffect(() => {
    if (!suggestionShowing) return
    const next = sizeToRequestType(suggestion.size)
    setType(prev => (prev === next ? prev : next))
  }, [suggestionShowing, suggestion.size])

  // An AI-authored draft pre-fills the form and marks the suggestion as its own.
  useEffect(() => {
    if (!open || !aiDraft) return
    if (aiDraft.title) setTitle(aiDraft.title)
    if (aiDraft.description) setDescription(aiDraft.description)
    if (aiDraft.category) setCategory(aiDraft.category)
    setAiDrafted(true)
  }, [open, aiDraft])

  async function handleSubmit(e: React.FormEvent, saveAndCreateAnother = false) {
    e.preventDefault()
    if (!title.trim()) return
    if (isAdmin && !isSubRequest && !clientOrgId) {
      setError('Please select a client.')
      return
    }
    setError(null)
    setSuccessMessage(null)
    setSubmitting(true)

    try {
      // Sub-request creation uses the dedicated endpoint which forces orgId
      // from parent + enforces the one-level-only nesting rule. Top-level
      // creation uses the normal requests endpoints.
      const url = isSubRequest
        ? apiPath(`/api/admin/requests/${parentRequestId}/sub-requests`)
        : (isAdmin ? apiPath('/api/admin/requests') : apiPath('/api/portal/requests'))

      const reqBody = isSubRequest
        ? {
            title: title.trim(),
            description,
            // sub-requests endpoint expects `size` not `type`; map small_task→small, large_task→large.
            size: (type === 'large_task' ? 'large' : 'small') as 'small' | 'large',
            category,
            priority,
            dueDate: dueDate || null,
            estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          }
        : isAdmin
        ? {
            clientOrgId, title: title.trim(), type, category, description, priority,
            isInternal: isInternal ? 1 : 0,
            startDate: startDate || null,
            dueDate: dueDate || null,
            estimatedHours: estimatedHours ? Number(estimatedHours) : null,
            brandId: brandId || null,
          }
        : {
            title: title.trim(), type, category, description, dueDate: dueDate || null,
            formResponses: Object.keys(formResponses).length > 0 ? JSON.stringify(formResponses) : undefined,
            // Clients set placement, never priority. The route maps it onto
            // priority plus a queue position and hands back where it landed.
            ...(clientSuggestion ? { placement } : {}),
          }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      const data = await res.json() as {
        id: string
        requestNumber?: number | null
        placement?: Placement | null
        queuePosition?: number | null
        planLabel?: string | null
        retainer?: boolean
      }

      showToast('Request created successfully')

      // Client audience on the ported path lands on a confirmation screen
      // showing where the request sits in their queue, rather than being
      // dropped straight onto the request.
      if (clientSuggestion && !saveAndCreateAnother) {
        setCreated({
          id: data.id,
          requestNumber: data.requestNumber ?? null,
          placement: data.placement ?? placement,
          queuePosition: data.queuePosition ?? null,
          planLabel: data.planLabel ?? null,
          retainer: data.retainer ?? false,
        })
        return
      }

      if (saveAndCreateAnother) {
        // Reset form but keep client and category pre-selected
        setTitle('')
        setDescription('')
        setPriority('standard')
        setStartDate('')
        setDueDate('')
        setEstimatedHours('')
        setSuccessMessage('Request created successfully. Create another one below.')
        setCreateAnother(true)
      } else if (onCreated) {
        onCreated(data.id)
        onClose()
      } else {
        onClose()
        router.push(`/requests/${data.id}`)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  // The AI assist takes over the whole surface, exactly as it does in the
  // prototype: the form is still mounted underneath and comes back on close.
  if (aiOpen) {
    return (
      <AiRequestWizard
        open
        onClose={() => setAiOpen(false)}
        onRequestsCreated={() => { setAiOpen(false); onClose() }}
        context={isAdmin
          ? { orgId: clientOrgId || undefined, speaker: 'admin' }
          : { speaker: 'client' }}
        wizardEndpoint={isAdmin ? '/api/admin/ai/request-wizard' : '/api/portal/ai/request-wizard'}
        submitEndpoint={isAdmin ? '/api/admin/requests' : '/api/portal/requests'}
        onDraftToForm={(draft) => {
          setTitle(draft.title)
          setDescription(draft.description)
          setCategory(draft.category)
          // The wizard's vocabulary is wider than the two sizes the dialog
          // offers, so anything bigger than a small task lands on large.
          setType(draft.type === 'large_task' || draft.type === 'new_feature' ? 'large_task' : 'small_task')
          setAiDrafted(true)
          setSizeChangeOpen(false)
          setAiOpen(false)
          showToast('Draft ready. Review it below.')
        }}
      />
    )
  }

  // Client confirmation: where the request landed, before anything else.
  if (created) {
    return (
      <RequestConfirmation
        created={created}
        onDone={() => { onCreated?.(created.id); onClose() }}
      />
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(2px)',
          zIndex: 60,
        }}
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-request-dialog-title"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '100%',
          maxWidth: '32.5rem',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 70,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          <div>
            <h2 id="new-request-dialog-title" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
              {isAdmin ? 'Create a request' : 'Submit a request'}
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              {isAdmin
                ? 'Create a request on behalf of a client.'
                : "Tell us what you need and we'll get started."}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '0.375rem',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-subtle)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginLeft: '0.75rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable form body */}
        <form
          id="new-request-form"
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* AI assist entry. Opens the existing wizard over the form. */}
            {isSuperAdmin && !isSubRequest && (
              <AiAssistCard
                rebuild={aiDrafted}
                isAdmin={isAdmin}
                onOpen={() => setAiOpen(true)}
              />
            )}

            {/* Sub-request indicator — locks client to parent's org */}
            {isSubRequest && (
              <div
                role="note"
                style={{
                  padding: '0.625rem 0.75rem',
                  borderRadius: 'var(--radius-card)',
                  background: 'var(--color-brand-50)',
                  border: '1px solid var(--color-brand-100)',
                  fontSize: '0.75rem',
                  color: 'var(--color-brand-dark)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Layers size={13} aria-hidden="true" />
                <span>This will be created as a <strong>sub-request</strong> of the current request. Client is locked to the parent&rsquo;s organisation.</span>
              </div>
            )}

            {/* Client selector (admin only) — hidden for sub-requests since
                org is forced to parent's. */}
            {isAdmin && !isSubRequest && (
              <FieldGroup label="Client" required htmlFor="req-client">
                {clientsLoading ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    height: '2.625rem', padding: '0 0.75rem',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-input)',
                    fontSize: '0.8125rem', color: 'var(--color-text-subtle)',
                  }}>
                    <Loader2 size={13} className="animate-spin" />
                    Loading clients...
                  </div>
                ) : (
                  <SearchableSelect
                    options={clients.map(c => ({ value: c.id, label: c.name }))}
                    value={clientOrgId || null}
                    onChange={(v) => setClientOrgId(v ?? '')}
                    placeholder="Select a client..."
                    searchPlaceholder="Search clients..."
                  />
                )}
              </FieldGroup>
            )}

            {/* Brand selector (admin only, shown when client has brands) */}
            {isAdmin && clientOrgId && (brandOptions.length > 0 || brandsLoading) && (
              <FieldGroup label="Brand" htmlFor="req-brand">
                {brandsLoading ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    height: '2.625rem', padding: '0 0.75rem',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-input)',
                    fontSize: '0.8125rem', color: 'var(--color-text-subtle)',
                  }}>
                    <Loader2 size={13} className="animate-spin" />
                    Loading brands...
                  </div>
                ) : (
                  <SearchableSelect
                    options={brandOptions.map(b => ({ value: b.id, label: b.name }))}
                    value={brandId || null}
                    onChange={(v) => setBrandId(v ?? '')}
                    placeholder="Select a brand (optional)..."
                    searchPlaceholder="Search brands..."
                    allowClear
                  />
                )}
              </FieldGroup>
            )}

            {/* Title */}
            <FieldGroup label="Request title" required htmlFor="req-title">
              <StyledInput
                id="req-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                maxLength={200}
                placeholder="e.g. Update homepage hero section"
              />
            </FieldGroup>

            {/* Flow indicator */}
            {isAdmin && clientOrgId && (
              <div style={{
                padding: '0.625rem 0.75rem',
                borderRadius: 'var(--radius-card)',
                background: clientUsesTracks ? 'var(--color-brand-50)' : 'var(--color-bg-secondary)',
                border: `1px solid ${clientUsesTracks ? 'var(--color-brand-100)' : 'var(--color-border-subtle)'}`,
                fontSize: '0.75rem',
                color: clientUsesTracks ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <Zap size={12} aria-hidden="true" />
                {clientUsesTracks
                  ? `Retainer client (${selectedClient?.planType}) - select task size below`
                  : 'Project / hourly client - no track selection needed'}
              </div>
            )}

            {/* Type tiles: only visible for retainer plans (maintain/scale) */}
            {showTrackSelector && suggestionShowing && (
              <FieldGroup label="Size">
                <SizeSuggestionChip
                  suggestion={suggestion}
                  canChange={largeAllowed}
                  onChange={() => setSizeChangeOpen(true)}
                />
              </FieldGroup>
            )}

            {showTrackSelector && !suggestionShowing && (
            <FieldGroup label={clientSuggestion ? 'Size' : 'Task size'}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                {REQUEST_TYPES.map(t => {
                  // Block large tasks for maintain plans - for both admin and portal
                  const clientPlan = selectedClient?.planType
                  const locked = t.requiresScale && (
                    isAdmin
                      ? clientPlan === 'maintain'  // Admin: block if selected client is on maintain
                      : !canUseLargeTrack          // Portal: parent controls via prop
                  )
                  const active = type === t.value
                  const Icon = t.icon
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={locked}
                      onClick={() => !locked && setType(t.value)}
                      style={{
                        padding: '0.875rem 0.75rem',
                        borderRadius: 'var(--radius-card)',
                        border: active
                          ? `2px solid var(--color-brand)`
                          : locked
                            ? `2px solid var(--color-border-subtle)`
                            : `2px solid var(--color-border)`,
                        background: active
                          ? 'var(--color-brand-50)'
                          : locked
                            ? 'var(--color-bg-secondary)'
                            : 'var(--color-bg)',
                        cursor: locked ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        opacity: locked ? 0.6 : 1,
                        transition: 'border-color 0.1s, background 0.1s',
                        position: 'relative',
                      }}
                      onMouseEnter={e => {
                        if (!active && !locked) {
                          e.currentTarget.style.borderColor = 'var(--color-brand-200)'
                          e.currentTarget.style.background = 'var(--color-bg-secondary)'
                        }
                      }}
                      onMouseLeave={e => {
                        if (!active && !locked) {
                          e.currentTarget.style.borderColor = 'var(--color-border)'
                          e.currentTarget.style.background = 'var(--color-bg)'
                        }
                      }}
                    >
                      {active && (
                        <CheckCircle2
                          size={13}
                          style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', color: BRAND_HEX }}
                        />
                      )}
                      {locked && (
                        <Lock
                          size={12}
                          style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', color: 'var(--color-text-subtle)' }}
                        />
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.3125rem' }}>
                        <Icon size={14} style={{ color: active ? BRAND_HEX : 'var(--color-text-muted)', flexShrink: 0 }} />
                        <p style={{
                          fontSize: '0.8125rem', fontWeight: 600,
                          color: active ? 'var(--color-brand-dark)' : 'var(--color-text)',
                          margin: 0,
                        }}>
                          {t.label}
                        </p>
                        <span style={{
                          fontSize: '0.6875rem', fontWeight: 500,
                          color: active ? 'var(--color-brand)' : 'var(--color-text-subtle)',
                          background: active ? 'var(--color-brand-100)' : 'var(--color-bg-tertiary)',
                          padding: '0.0625rem 0.375rem',
                          borderRadius: 'var(--radius-full)',
                        }}>
                          {t.desc}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: 0, lineHeight: 1.4 }}>
                        {locked ? 'Scale plan required' : t.hint}
                      </p>
                    </button>
                  )
                })}
              </div>
              {/* Client audience: a way back to the suggestion. */}
              {clientSuggestion && (
                <QuietLink onClick={() => setSizeChangeOpen(false)}>Use suggestion</QuietLink>
              )}
              {/* Team audience: the same suggestion as a hint line. Additive,
                  so it ships for every team user rather than behind the gate. */}
              {isAdmin && (
                <p style={{
                  fontSize: '0.75rem',
                  color: 'var(--color-text-subtle)',
                  margin: '0.375rem 0 0',
                  lineHeight: 1.45,
                }}>
                  {suggestion.hint}
                </p>
              )}
            </FieldGroup>
            )}

            {/* Category + Priority row */}
            <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: '1rem' }}>
              <FieldGroup label="Category" htmlFor="req-category">
                <StyledSelect id="req-category" value={category} onChange={setCategory}>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </StyledSelect>
              </FieldGroup>

              {isAdmin && (
                <FieldGroup label="Priority">
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {(['standard', 'high'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        style={{
                          flex: 1,
                          height: '2.625rem',
                          borderRadius: 'var(--radius-button)',
                          border: priority === p
                            ? p === 'high' ? '2px solid var(--status-in-review-dot)' : '2px solid var(--color-brand)'
                            : '2px solid var(--color-border)',
                          background: priority === p
                            ? p === 'high' ? 'var(--status-in-review-bg)' : 'var(--color-brand-50)'
                            : 'var(--color-bg)',
                          color: priority === p
                            ? p === 'high' ? 'var(--status-in-review-text)' : 'var(--color-brand-dark)'
                            : 'var(--color-text-muted)',
                          fontSize: '0.8125rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3125rem',
                          transition: 'all 0.1s',
                        }}
                      >
                        {p === 'high' && <Zap size={13} />}
                        {p === 'high' ? 'High' : 'Standard'}
                      </button>
                    ))}
                  </div>
                </FieldGroup>
              )}
            </div>

            {/* "Internal only" toggle removed — per-message visibility is now
                handled by the Public/Internal segmented control in the
                <MessageComposer>. Creating a request is always a client-facing
                action; admins can still post internal notes within the
                thread. The isInternal state is kept on the form for backend
                compat but defaults to false. */}

            {/* Dates + hours (admin only) */}
            {isAdmin && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <FieldGroup label="Start date">
                  <StyledInput type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </FieldGroup>
                <FieldGroup label="Due date">
                  <StyledInput type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </FieldGroup>
                <FieldGroup label="Est. hours">
                  <StyledInput
                    type="number" min="0.5" max="999" step="0.5"
                    value={estimatedHours}
                    onChange={e => setEstimatedHours(e.target.value)}
                    placeholder="e.g. 4"
                  />
                </FieldGroup>
              </div>
            )}

            {/* Queue placement (client audience). Clients never set priority;
                they say where the work sits against everything already
                moving, and the route maps that onto priority + position. */}
            {clientSuggestion && (
              <FieldGroup label="When would you like it?">
                <div
                  role="radiogroup"
                  aria-label="When would you like it?"
                  style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
                >
                  {PLACEMENT_OPTIONS.map(o => (
                    <PlacementOption
                      key={o.value}
                      option={o}
                      selected={placement === o.value}
                      onSelect={() => setPlacement(o.value)}
                    />
                  ))}
                </div>
              </FieldGroup>
            )}

            {/* Due date (portal users) */}
            {!isAdmin && (
              <FieldGroup label="Due date (optional)" htmlFor="req-due-date-portal">
                <StyledInput
                  id="req-due-date-portal"
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </FieldGroup>
            )}

            {/* Description */}
            <FieldGroup label="Description" htmlFor="req-description">
              <StyledTextarea
                id="req-description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe what you need: include links, context, and any steps you have in mind."
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.375rem' }}>
                You can add files, images, and voice notes after submitting.
              </p>
            </FieldGroup>

            {/* Dynamic intake form questions (portal only) */}
            {!isAdmin && intakeQuestions.length > 0 && (
              <div style={{
                borderTop: '1px solid var(--color-border-subtle)',
                paddingTop: '1rem',
                marginTop: '0.5rem',
              }}>
                <p style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.05em',
                  marginBottom: '0.75rem',
                }}>
                  Additional questions
                </p>
                {intakeQuestions.map(q => (
                  <FieldGroup key={q.id} label={`${q.label}${q.required ? ' *' : ''}`} htmlFor={`intake-${q.id}`}>
                    {q.type === 'textarea' ? (
                      <StyledTextarea
                        id={`intake-${q.id}`}
                        value={formResponses[q.id] ?? ''}
                        onChange={e => setFormResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
                        rows={3}
                        required={q.required}
                      />
                    ) : q.type === 'select' ? (
                      <StyledSelect
                        id={`intake-${q.id}`}
                        value={formResponses[q.id] ?? ''}
                        onChange={v => setFormResponses(prev => ({ ...prev, [q.id]: v }))}
                        required={q.required}
                      >
                        <option value="">Select...</option>
                        {(q.options ?? []).map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </StyledSelect>
                    ) : q.type === 'checkbox' ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                        <input
                          type="checkbox"
                          checked={formResponses[q.id] === 'true'}
                          onChange={e => setFormResponses(prev => ({ ...prev, [q.id]: e.target.checked ? 'true' : 'false' }))}
                        />
                        {q.label}
                      </label>
                    ) : (
                      <StyledInput
                        id={`intake-${q.id}`}
                        type={q.type === 'url' ? 'url' : 'text'}
                        value={formResponses[q.id] ?? ''}
                        onChange={e => setFormResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
                        required={q.required}
                      />
                    )}
                  </FieldGroup>
                ))}
              </div>
            )}
            {!isAdmin && intakeLoading && (
              <div style={{ textAlign: 'center', padding: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                Loading form...
              </div>
            )}

            {/* Success message */}
            <div aria-live="polite">
              {successMessage && (
                <div style={{
                  fontSize: '0.8125rem',
                  color: 'var(--color-success)',
                  background: 'var(--color-success-bg)',
                  border: '1px solid var(--color-success)',
                  borderRadius: 'var(--radius-button)',
                  padding: '0.625rem 0.875rem',
                }}>
                  {successMessage}
                </div>
              )}
            </div>

            {/* Error */}
            <div aria-live="polite">
              {error && (
                <div style={{
                  fontSize: '0.8125rem',
                  color: 'var(--color-danger)',
                  background: 'var(--color-danger-bg)',
                  border: '1px solid var(--color-danger)',
                  borderRadius: 'var(--radius-button)',
                  padding: '0.625rem 0.875rem',
                }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.5rem',
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            Cancel
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={submitting || !title.trim()}
              onClick={e => handleSubmit(e, true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.5625rem 0.875rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: submitting || !title.trim() ? 'var(--color-text-subtle)' : 'var(--color-brand)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-button)',
                cursor: submitting || !title.trim() ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!submitting && title.trim()) {
                  e.currentTarget.style.borderColor = 'var(--color-brand)'
                  e.currentTarget.style.background = 'var(--color-brand-50)'
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.background = 'var(--color-bg)'
              }}
            >
              {submitting && createAnother && <Loader2 size={13} className="animate-spin" />}
              Save + another
            </button>
            <button
              type="submit"
              form="new-request-form"
              disabled={submitting || !title.trim()}
              onClick={handleSubmit}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5625rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'white',
                background: submitting || !title.trim() ? 'var(--color-brand-200)' : BRAND_HEX,
                border: 'none',
                borderRadius: 'var(--radius-button)',
                cursor: submitting || !title.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (!submitting && title.trim()) e.currentTarget.style.background = 'var(--color-brand-dark)'
              }}
              onMouseLeave={e => {
                if (!submitting && title.trim()) e.currentTarget.style.background = BRAND_HEX
              }}
            >
              {submitting && !createAnother && <Loader2 size={14} className="animate-spin" />}
              {isAdmin ? 'Create request' : 'Submit request'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── AI assist entry ────────────────────────────────────────────────────────────

/** The card at the top of the form that hands over to the AI wizard. */
function AiAssistCard({
  rebuild, isAdmin, onOpen,
}: {
  rebuild: boolean
  isAdmin: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tahi-focus-ring"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        columnGap: '0.75rem',
        width: '100%',
        minHeight: '2.75rem',
        padding: '0.75rem 0.875rem',
        textAlign: 'left',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-brand-100)',
        background: 'var(--color-brand-50)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.background = 'var(--color-brand-100)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-brand-100)'
        e.currentTarget.style.background = 'var(--color-brand-50)'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '2rem',
          height: '2rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: 'var(--color-brand)',
          color: 'var(--color-bg)',
        }}
      >
        <Sparkles size={17} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-brand-dark)' }}>
          {rebuild ? 'Rebuild with AI' : 'Build with AI'}
        </span>
        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem', lineHeight: 1.4 }}>
          {isAdmin
            ? 'Draft the title and brief from a few answers.'
            : 'Not sure how to word it? We will ask a few questions.'}
        </span>
      </span>
      <ChevronRight size={17} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
    </button>
  )
}

// ── Size suggestion ────────────────────────────────────────────────────────────

/** The chip a client sees instead of the size control, with the quiet link
 *  that reveals the control when the suggestion is wrong. */
function SizeSuggestionChip({
  suggestion, canChange, onChange,
}: {
  suggestion: SizeSuggestion
  canChange: boolean
  onChange: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: '0.375rem',
        padding: '0.375rem 0.75rem',
        borderRadius: 'var(--radius-full)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-brand-50)',
        color: 'var(--color-brand-dark)',
        fontSize: '0.75rem',
        fontWeight: 600,
      }}>
        {suggestion.chipLabel}
      </span>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.625rem',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
          {suggestion.helper}
        </span>
        {canChange && <QuietLink onClick={onChange}>Change</QuietLink>}
      </div>
    </div>
  )
}

/** A quiet text link. 44px of touch reach without 44px of ink. */
function QuietLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tahi-focus-ring"
      style={{
        position: 'relative',
        alignSelf: 'flex-start',
        margin: 0,
        padding: '0.625rem 0',
        border: 'none',
        background: 'none',
        color: 'var(--color-brand-dark)',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        flexShrink: 0,
        borderRadius: 'var(--radius-button)',
      }}
      onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
      onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
    >
      {children}
    </button>
  )
}

// ── Queue placement ────────────────────────────────────────────────────────────

/** One placement option. Icon tile, text block, and check share one centre
 *  line; the two text lines share a left edge. */
function PlacementOption({
  option, selected, onSelect,
}: {
  option: (typeof PLACEMENT_OPTIONS)[number]
  selected: boolean
  onSelect: () => void
}) {
  const Icon = option.icon
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="tahi-focus-ring"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        columnGap: '0.75rem',
        width: '100%',
        minHeight: '2.75rem',
        padding: '0.75rem 0.875rem',
        textAlign: 'left',
        borderRadius: 'var(--radius-card)',
        border: `1px solid ${selected ? 'var(--color-brand)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-brand-50)' : 'var(--color-bg)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        if (!selected) {
          e.currentTarget.style.borderColor = 'var(--color-brand-light)'
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.background = 'var(--color-bg)'
        }
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '2rem',
          height: '2rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: selected ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
          color: selected ? 'var(--color-bg)' : 'var(--color-text-muted)',
        }}
      >
        <Icon size={17} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontSize: '0.8125rem',
          fontWeight: 600,
          lineHeight: 1.3,
          color: selected ? 'var(--color-brand-dark)' : 'var(--color-text)',
        }}>
          {option.label}
        </span>
        <span style={{
          display: 'block',
          fontSize: '0.6875rem',
          lineHeight: 1.35,
          marginTop: '0.125rem',
          color: 'var(--color-text-subtle)',
        }}>
          {option.sub}
        </span>
      </span>
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.25rem',
          height: '1.25rem',
          borderRadius: 'var(--radius-full)',
          border: `1px solid ${selected ? 'var(--color-brand)' : 'var(--color-border)'}`,
          background: selected ? 'var(--color-brand)' : 'transparent',
          color: 'var(--color-bg)',
        }}
      >
        {selected && <Check size={13} strokeWidth={3} />}
      </span>
    </button>
  )
}

// ── Confirmation ───────────────────────────────────────────────────────────────

/** What a client sees the moment a request lands: the number, what happens
 *  next, and where it sits in their queue. */
function RequestConfirmation({ created, onDone }: { created: CreatedSummary; onDone: () => void }) {
  const nextLine =
    created.placement === 'replace'
      ? 'You have asked us to start this ahead of the current build, so we will confirm the swap with you shortly.'
      : created.placement === 'top'
        ? 'It has jumped to the top of your queue.'
        : 'You will see every step right here, and we will message you the moment there is something to look at.'
  const position = created.queuePosition
  const showQueue = created.retainer && created.placement !== 'replace' && position != null

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(2px)',
          zIndex: 60,
        }}
        onClick={onDone}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-request-confirm-title"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '100%',
          maxWidth: '32.5rem',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 70,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem 1.5rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '3.25rem',
            height: '3.25rem',
            borderRadius: 'var(--radius-leaf)',
            background: 'var(--color-brand-50)',
            color: 'var(--color-brand)',
          }}>
            <CheckCircle2 size={28} />
          </div>
          <h2
            id="new-request-confirm-title"
            style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text)', margin: '1rem 0 0' }}
          >
            Your request is in
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0', lineHeight: 1.55 }}>
            {created.requestNumber != null
              ? `We have it, request #${created.requestNumber}. ${nextLine}`
              : `We have it. ${nextLine}`}
          </p>

          {showQueue && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              alignItems: 'center',
              columnGap: '0.875rem',
              marginTop: '1.25rem',
              padding: '0.875rem 1rem',
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-secondary)',
            }}>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '2.25rem',
                height: '2.25rem',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-brand)',
                color: 'var(--color-bg)',
                fontSize: '0.875rem',
                fontWeight: 700,
              }}>
                {position}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                  {position === 1 ? 'Next up in your queue' : `Position ${position} in your queue`}
                </span>
                {created.planLabel && (
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                    {`Your ${created.planLabel} plan pulls the next one in as a track frees up.`}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '1rem 1.5rem',
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={onDone}
            className="tahi-focus-ring"
            style={{
              minHeight: '2.75rem',
              padding: '0.5625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--color-bg)',
              background: BRAND_HEX,
              border: 'none',
              borderRadius: 'var(--radius-button)',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-dark)' }}
            onMouseLeave={e => { e.currentTarget.style.background = BRAND_HEX }}
          >
            Done
          </button>
        </div>
      </div>
    </>
  )
}

// ── Field group ────────────────────────────────────────────────────────────────

function FieldGroup({
  label, required, htmlFor, children,
}: {
  label: string
  required?: boolean
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label htmlFor={htmlFor} style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
        {label}
        {required && <span style={{ color: 'var(--color-danger)', marginLeft: '0.125rem' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Styled input ───────────────────────────────────────────────────────────────

function StyledInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        height: '2.625rem',
        padding: '0 0.75rem',
        fontSize: '0.875rem',
        color: 'var(--color-text)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-input)',
        outline: 'none',
        boxSizing: 'border-box',
        ...props.style,
      }}
      onFocus={e => {
        e.currentTarget.style.borderColor = BRAND_HEX
        e.currentTarget.style.boxShadow = `0 0 0 3px rgba(90,130,78,0.12)`
      }}
      onBlur={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    />
  )
}

// ── Styled textarea ────────────────────────────────────────────────────────────

function StyledTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: '100%',
        padding: '0.625rem 0.75rem',
        fontSize: '0.875rem',
        color: 'var(--color-text)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-input)',
        outline: 'none',
        resize: 'none',
        boxSizing: 'border-box',
        lineHeight: 1.5,
        ...props.style,
      }}
      onFocus={e => {
        e.currentTarget.style.borderColor = BRAND_HEX
        e.currentTarget.style.boxShadow = `0 0 0 3px rgba(90,130,78,0.12)`
      }}
      onBlur={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    />
  )
}

// ── Styled select ──────────────────────────────────────────────────────────────

function StyledSelect({
  id, value, onChange, required, children,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        id={id}
        value={value}
        required={required}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          height: '2.625rem',
          padding: '0 2.25rem 0 0.75rem',
          fontSize: '0.875rem',
          color: 'var(--color-text)',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-input)',
          outline: 'none',
          appearance: 'none',
          cursor: 'pointer',
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = BRAND_HEX
          e.currentTarget.style.boxShadow = `0 0 0 3px rgba(90,130,78,0.12)`
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {children}
      </select>
      <div style={{
        position: 'absolute', right: '0.625rem', top: '50%',
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
        color: 'var(--color-text-subtle)',
        fontSize: '0.625rem',
      }}>▼</div>
    </div>
  )
}
