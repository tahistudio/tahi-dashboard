'use client'

/**
 * <NewRequestDialog>. Two dialogs behind one export.
 *
 * <AlignedRequestDialog> is the rebuild against the approved Claude Design
 * prototype: a centred modal, an audience that runs off `isAdmin` alone, and
 * the body in the order a person fills it in (AI card, client, category tiles,
 * title, brief, size, priority or placement, ideal due date). Planning fields
 * that are not intake fields sit behind a "More details" disclosure.
 *
 * <LegacyRequestDialog> is the right-hand slide-over the team and clients have
 * today, kept verbatim so nothing changes for them until the lead flips
 * NEW_DIALOG_FOR_EVERYONE below. That flag plus `isSuperAdmin` is the whole
 * rollout gate; the audience split inside the new dialog has nothing to do
 * with it. "Verbatim" is meant literally, down to the intake block
 * (<LegacyIntakeQuestions>) and its copy: the AI card, the size suggestion,
 * the queue placement and the confirmation the shipped dialog carried were
 * already `isSuperAdmin`-only, and a super admin now gets the rebuild, so no
 * pixel a client sees moves before the flip.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import {
  X, Loader2, Zap, CheckCircle2, Lock, Layers, AlignLeft, Clock,
  Sparkles, ChevronRight, ChevronDown, Check, Inbox, ArrowUp, ArrowLeftRight,
  Info, Palette, Code2, FileText, Compass, Briefcase, Bug,
} from 'lucide-react'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { SegmentedControl, nextSegmentIndex } from '@/components/tahi/segmented-control'
import { SlideOver } from '@/components/tahi/slide-over'
import { Tooltip } from '@/components/tahi/tooltip'
import {
  RichBrief,
  richBriefIsEmpty,
  plainTextToBriefHtml,
  looksLikeBriefHtml,
} from '@/components/tahi/rich-brief'
import { useToast } from '@/components/tahi/toast'
import { usePermissions } from '@/components/tahi/permissions-context'
import { AiRequestWizardPanel } from '@/components/tahi/ai-request-wizard'
import {
  suggestRequestSize,
  sizeToRequestType,
  type SizeSuggestion,
} from '@/lib/request-size-suggestion'

// ── Rollout gate ───────────────────────────────────────────────────────────────

/**
 * The rebuilt dialog is Liam and Staci only while it beds in. Flip this to
 * true in one commit and every admin and every client gets it; the legacy
 * component below can then be deleted in the commit after.
 */
const NEW_DIALOG_FOR_EVERYONE = false

// ── Constants ──────────────────────────────────────────────────────────────────

const BRAND = 'var(--color-brand)'

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
   *  skip the confirmation and the navigation to /requests/[id]: the caller
   *  typically wants to stay on the parent page and refresh. */
  onCreated?: (newRequestId: string) => void
  /** Pre-fills the form from an AI-authored draft. Marks the size suggestion
   *  as AI-attributed ("Suggested by AI assist: ..."). */
  aiDraft?: { title?: string; description?: string; category?: string } | null
}

/** The two sizes a request can be filed at, in the vocabulary the API takes. */
type RequestSize = 'small_task' | 'large_task'

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

/** What a POST hands back once the request landed. */
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
    desc: '1 day or less',
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

/** The tile grid. Colours come from the --cat-* tokens in app/globals.css. */
const CATEGORY_TILES: Array<{
  value: string
  label: string
  icon: typeof Palette
  bg: string
  fg: string
}> = [
  { value: 'development', label: 'Development', icon: Code2,     bg: 'var(--cat-development-bg)', fg: 'var(--cat-development-text)' },
  { value: 'design',      label: 'Design',      icon: Palette,   bg: 'var(--cat-design-bg)',      fg: 'var(--cat-design-text)' },
  { value: 'content',     label: 'Content',     icon: FileText,  bg: 'var(--cat-content-bg)',     fg: 'var(--cat-content-text)' },
  { value: 'strategy',    label: 'Strategy',    icon: Compass,   bg: 'var(--cat-strategy-bg)',    fg: 'var(--cat-strategy-text)' },
  { value: 'admin',       label: 'Admin',       icon: Briefcase, bg: 'var(--cat-admin-bg)',       fg: 'var(--cat-admin-text)' },
  { value: 'bug',         label: 'Bug fix',     icon: Bug,       bg: 'var(--cat-bug-bg)',         fg: 'var(--cat-bug-text)' },
]

const DUE_DATE_TIP =
  'Your target date. We will always aim for it, but more involved work can take a little longer, and we will confirm the real delivery date with you.'

// ── Pure rules ─────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * An ISO date `days` from `from`, in the person's own calendar rather than
 * UTC, so "tomorrow" is tomorrow wherever they are. The dialog defaults the
 * ideal due date to seven days out and floors the picker at one.
 */
export function isoDatePlusDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Days the ideal due date defaults to, and the floor under the picker. */
export const DUE_DATE_DEFAULT_DAYS = 7
export const DUE_DATE_MIN_DAYS = 1

/**
 * A brief handed in from outside the editor, in the shape RichBrief stores.
 * The AI wizard routes document their `description` as plain text, so it is
 * escaped and split into paragraphs; anything that already carries markup is
 * passed straight through.
 */
export function toBriefHtml(value?: string | null): string {
  if (!value) return ''
  return looksLikeBriefHtml(value) ? value : plainTextToBriefHtml(value)
}

export interface SubmitGateInput {
  title: string
  /** The brief as HTML. Only its readable text counts. */
  brief: string
  audience: 'team' | 'client'
  /** True once a client org is chosen, or when the parent request supplies one. */
  clientChosen: boolean
}

/**
 * Whether the submit button is live. A title is always required. The team also
 * needs a client to file against; a client also needs to have written
 * something, because "make the thing better" costs a round trip that the brief
 * would have saved.
 */
export function canSubmitRequest({ title, brief, audience, clientChosen }: SubmitGateInput): boolean {
  if (!title.trim()) return false
  if (audience === 'team') return clientChosen
  return !richBriefIsEmpty(brief)
}

/** Why the submit button is off, for the title attribute on the disabled button. */
export function submitBlockedReason(input: SubmitGateInput): string | undefined {
  if (canSubmitRequest(input)) return undefined
  if (!input.title.trim()) return 'Add a title first'
  if (input.audience === 'team' && !input.clientChosen) return 'Pick a client first'
  return 'Tell us a little about what you need'
}

/**
 * The tile an arrow key moves to in the category grid. Delegates to the
 * segmented control's rule so both single-choice strips cycle the same way,
 * and maps the vertical arrows onto it as a radiogroup should.
 */
export function nextCategoryIndex(count: number, from: number, key: string): number | null {
  const mapped = key === 'ArrowUp' ? 'ArrowLeft' : key === 'ArrowDown' ? 'ArrowRight' : key
  const options = Array.from({ length: count }, (_, i) => ({ value: String(i), label: String(i) }))
  return nextSegmentIndex(options, from, mapped)
}

// ── Local styles ───────────────────────────────────────────────────────────────

const DIALOG_CSS = `
.tahi-reqd-catgrid{
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
@media (min-width: 30rem){
  .tahi-reqd-catgrid{ grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.tahi-reqd-cat{
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-height: 4.25rem;
  padding: 0.75rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out);
}
.tahi-reqd-cat:hover{ border-color: var(--color-brand); }
.tahi-reqd-cat[data-active="true"]{
  border-color: var(--color-brand);
  background: var(--color-brand-50);
}
.tahi-reqd-cat-ic{
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-leaf-sm);
}
.tahi-reqd-more{
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2.75rem;
  padding: 0 0.25rem;
  border: none;
  background: none;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  border-radius: var(--radius-button);
}
.tahi-reqd-more:hover{ color: var(--color-text); }
.tahi-reqd-more-chev{ transition: transform 180ms var(--ease-out); }
.tahi-reqd-more[aria-expanded="true"] .tahi-reqd-more-chev{ transform: rotate(180deg); }
.tahi-reqd-info{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: none;
  color: var(--color-text-subtle);
  cursor: help;
}
.tahi-reqd-info:hover{ color: var(--color-text-muted); }
@media (max-width: 47.9375rem){
  /* Full touch target without a bigger row: the reach grows, the ink does not. */
  .tahi-reqd-info{ width: 2.75rem; height: 2.75rem; margin: -0.625rem 0; }
}
@media (prefers-reduced-motion: reduce){
  .tahi-reqd-cat,
  .tahi-reqd-more-chev{ transition: none; }
}
`

// ── Entry point ────────────────────────────────────────────────────────────────

export function NewRequestDialog(props: NewRequestDialogProps) {
  const { isSuperAdmin } = usePermissions()
  const rebuilt = NEW_DIALOG_FOR_EVERYONE || isSuperAdmin
  return rebuilt ? <AlignedRequestDialog {...props} /> : <LegacyRequestDialog {...props} />
}

// ── The rebuilt dialog ─────────────────────────────────────────────────────────

type DialogView = 'form' | 'ai' | 'done'

function AlignedRequestDialog({
  open, onClose, isAdmin, canUseLargeTrack = true, defaultOrgId,
  parentRequestId, forceOrgId, onCreated, aiDraft,
}: NewRequestDialogProps) {
  const isSubRequest = !!parentRequestId
  const isClient = !isAdmin
  const router = useRouter()
  const { showToast } = useToast()

  const [view, setView] = useState<DialogView>('form')
  const [aiSession, setAiSession] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [savingAnother, setSavingAnother] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedSummary | null>(null)

  // Client picker (team audience)
  const [clients, setClients] = useState<OrgOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientOrgId, setClientOrgId] = useState('')

  // Brand picker, only when the chosen client actually has brands
  const [brandOptions, setBrandOptions] = useState<{ id: string; name: string }[]>([])
  const [brandId, setBrandId] = useState('')

  // Form fields
  const [title, setTitle] = useState('')
  const [type, setType] = useState<RequestSize>('small_task')
  const [category, setCategory] = useState('development')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('standard')
  const [placement, setPlacement] = useState<Placement>('queue')
  const [dueDate, setDueDate] = useState(() => isoDatePlusDays(DUE_DATE_DEFAULT_DAYS))
  const [startDate, setStartDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [sizeChangeOpen, setSizeChangeOpen] = useState(false)
  const [aiDrafted, setAiDrafted] = useState(false)

  // Intake form questions, client audience only
  const [intakeQuestions, setIntakeQuestions] = useState<FormQuestion[]>([])
  const [formResponses, setFormResponses] = useState<Record<string, string>>({})

  const selectedClient = clients.find(c => c.id === clientOrgId)
  const clientUsesTracks = isAdmin
    ? selectedClient?.planType === 'maintain' || selectedClient?.planType === 'scale'
    : canUseLargeTrack
  const showSize = isAdmin ? clientUsesTracks : true
  const largeAllowed = isAdmin ? selectedClient?.planType !== 'maintain' : canUseLargeTrack

  // ── Data loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAdmin || !open) return
    let cancelled = false
    fetch(apiPath(`/api/portal/request-forms?category=${category}`))
      .then(r => r.json() as Promise<{ form?: { questions: string } }>)
      .then(data => {
        if (cancelled) return
        setIntakeQuestions(parseIntakeQuestions(data.form?.questions))
      })
      .catch(() => { if (!cancelled) setIntakeQuestions([]) })
    return () => { cancelled = true }
  }, [category, open, isAdmin])

  // Sub-requests load the list too even though the picker stays hidden: the
  // parent's org is the only way `selectedClient` resolves, and without it the
  // plan is unknown, so the Size control would vanish and every sub-request
  // would be filed as a small task whatever the parent's track.
  useEffect(() => {
    if (!open || !isAdmin) return
    setClientsLoading(true)
    fetch(apiPath('/api/admin/clients?status=active'))
      .then(r => r.json() as Promise<{ organisations: Array<{ id: string; name: string; planType?: string | null }> }>)
      .then(data => setClients((data.organisations ?? []).map(o => ({ id: o.id, name: o.name, planType: o.planType }))))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false))
  }, [open, isAdmin])

  useEffect(() => {
    if (!isAdmin || !clientOrgId) {
      setBrandOptions([])
      setBrandId('')
      return
    }
    // A brand belongs to one client: switching client A to client B must
    // drop A's brand id before the new options load, or B's request would be
    // posted with a brand the API now rejects as foreign.
    setBrandId('')
    let cancelled = false
    fetch(apiPath(`/api/admin/brands?orgId=${clientOrgId}`))
      .then(r => r.json() as Promise<{ items: Array<{ id: string; name: string }> }>)
      .then(data => { if (!cancelled) setBrandOptions((data.items ?? []).map(b => ({ id: b.id, name: b.name }))) })
      .catch(() => { if (!cancelled) setBrandOptions([]) })
    return () => { cancelled = true }
  }, [isAdmin, clientOrgId])

  // Reset on open
  useEffect(() => {
    if (!open) return
    setView('form')
    setTitle('')
    setType('small_task')
    setCategory('development')
    setDescription('')
    setPriority('standard')
    setPlacement('queue')
    setFormResponses({})
    setIntakeQuestions([])
    setStartDate('')
    setDueDate(isoDatePlusDays(DUE_DATE_DEFAULT_DAYS))
    setEstimatedHours('')
    setMoreOpen(false)
    setClientOrgId(forceOrgId ?? defaultOrgId ?? '')
    setBrandId('')
    setBrandOptions([])
    setError(null)
    setSuccessMessage(null)
    setSizeChangeOpen(false)
    setAiDrafted(false)
    setCreated(null)
  }, [open, forceOrgId, defaultOrgId])

  // A maintain plan has no multi-day track, so nothing can sit on one.
  useEffect(() => {
    if (!largeAllowed && type === 'large_task') setType('small_task')
  }, [largeAllowed, type])

  // ── Size suggestion ──────────────────────────────────────────────────────
  const suggestion: SizeSuggestion = useMemo(
    () => suggestRequestSize({
      brief: description,
      category,
      canUseLargeTrack: largeAllowed,
      fromAi: aiDrafted,
    }),
    [description, category, largeAllowed, aiDrafted],
  )
  // Clients see the suggestion instead of the control until they open Change,
  // and while it is showing it drives what gets posted, so the chip and the
  // body can never drift apart.
  const suggestionShowing = isClient && !sizeChangeOpen
  useEffect(() => {
    if (!suggestionShowing) return
    const next = sizeToRequestType(suggestion.size)
    setType(prev => (prev === next ? prev : next))
  }, [suggestionShowing, suggestion.size])

  // An AI-authored draft handed in by the caller pre-fills the form.
  useEffect(() => {
    if (!open || !aiDraft) return
    if (aiDraft.title) setTitle(aiDraft.title)
    if (aiDraft.description) setDescription(toBriefHtml(aiDraft.description))
    if (aiDraft.category) setCategory(aiDraft.category)
    setAiDrafted(true)
  }, [open, aiDraft])

  const gateInput: SubmitGateInput = {
    title,
    brief: description,
    audience: isAdmin ? 'team' : 'client',
    clientChosen: isSubRequest || !!clientOrgId,
  }
  const canSubmit = canSubmitRequest(gateInput)
  const blockedReason = submitBlockedReason(gateInput)

  const handleDraftToForm = useCallback((draft: { title: string; description: string; category: string; type: string }) => {
    setTitle(draft.title)
    // The wizard route hands back plain prose and leaves the conversion to the
    // caller. RichBrief parses whatever it is given as HTML, so without this a
    // multi-paragraph draft arrives as one run-on line.
    setDescription(toBriefHtml(draft.description))
    setCategory(draft.category)
    // The wizard's vocabulary is wider than the two sizes the dialog offers,
    // so anything bigger than a small task lands on large.
    setType(draft.type === 'large_task' || draft.type === 'new_feature' ? 'large_task' : 'small_task')
    setAiDrafted(true)
    setSizeChangeOpen(false)
    setView('form')
    showToast('Draft ready. Review it below.')
  }, [showToast])

  async function handleSubmit(e: React.FormEvent, saveAndCreateAnother = false) {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setError(null)
    setSuccessMessage(null)
    setSubmitting(true)
    setSavingAnother(saveAndCreateAnother)

    try {
      const url = isSubRequest
        ? apiPath(`/api/admin/requests/${parentRequestId}/sub-requests`)
        : (isAdmin ? apiPath('/api/admin/requests') : apiPath('/api/portal/requests'))

      const reqBody = isSubRequest
        ? {
            title: title.trim(),
            description,
            // The sub-requests endpoint takes `size`, not `type`.
            size: (type === 'large_task' ? 'large' : 'small') as 'large' | 'small',
            category,
            priority,
            dueDate: dueDate || null,
            estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          }
        : isAdmin
        ? {
            clientOrgId, title: title.trim(), type, category, description, priority,
            isInternal: 0,
            startDate: startDate || null,
            dueDate: dueDate || null,
            estimatedHours: estimatedHours ? Number(estimatedHours) : null,
            brandId: brandId || null,
          }
        : {
            title: title.trim(), type, category, description, dueDate: dueDate || null,
            formResponses: Object.keys(formResponses).length > 0 ? JSON.stringify(formResponses) : undefined,
            // Clients set placement, never priority. The route maps it onto a
            // priority plus a queue position and hands back where it landed.
            placement,
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

      if (saveAndCreateAnother) {
        setTitle('')
        setDescription('')
        setPriority('standard')
        setStartDate('')
        setDueDate(isoDatePlusDays(DUE_DATE_DEFAULT_DAYS))
        setEstimatedHours('')
        setAiDrafted(false)
        setSuccessMessage('Request created. Create another one below.')
        // onCreated is a refresh signal, not a close signal: the callers that
        // close do that themselves, and the sub-request panels do their
        // revalidation inside it. Skipping it here left an admin who saved two
        // sub-requests in a row looking at an empty panel and a stale count
        // until a hard reload.
        onCreated?.(data.id)
        return
      }

      // A caller that wants to stay where it is (the sub-request panels) takes
      // the id and closes; everyone else gets the confirmation.
      if (onCreated) {
        onCreated(data.id)
        onClose()
        return
      }

      setCreated({
        id: data.id,
        requestNumber: data.requestNumber ?? null,
        placement: data.placement ?? (isClient ? placement : null),
        queuePosition: data.queuePosition ?? null,
        planLabel: data.planLabel ?? null,
        retainer: data.retainer ?? false,
      })
      setView('done')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
      setSavingAnother(false)
    }
  }

  // ── Shell copy ───────────────────────────────────────────────────────────
  const headTitle = view === 'ai' ? 'Build with AI' : 'New request'
  const headSub = view === 'ai'
    ? (isClient ? 'A few quick questions and I will draft it' : 'Answer a few questions and I will draft the brief')
    : (isClient ? 'Tell us what you need, takes a minute' : 'Create work for a client')

  const sizeOptions = [
    { value: 'small_task' as RequestSize, label: '1 day or less', icon: <Clock size={14} aria-hidden="true" /> },
    {
      value: 'large_task' as RequestSize,
      label: 'Multi-day',
      icon: <Layers size={14} aria-hidden="true" />,
      disabled: !largeAllowed,
      title: largeAllowed ? undefined : `${selectedClient?.name ?? 'This client'} has no multi-day track on their plan`,
    },
  ]

  return (
    <SlideOverShell
      open={open}
      onClose={onClose}
      view={view}
      title={headTitle}
      subtitle={headSub}
    >
      <style>{DIALOG_CSS}</style>

      {view === 'done' && created && (
        <RequestConfirmation
          created={created}
          isClient={isClient}
          onDone={onClose}
          onGoToRequest={() => { onClose(); router.push(`/requests/${created.id}`) }}
        />
      )}

      {view === 'ai' && (
        <AiRequestWizardPanel
          key={aiSession}
          category={category}
          onWriteItMyself={() => setView('form')}
          onRequestsCreated={() => { onClose() }}
          context={isAdmin
            ? { orgId: clientOrgId || undefined, speaker: 'admin', planType: selectedClient?.planType ?? undefined }
            : { speaker: 'client' }}
          wizardEndpoint={isAdmin ? '/api/admin/ai/request-wizard' : '/api/portal/ai/request-wizard'}
          submitEndpoint={isAdmin ? '/api/admin/requests' : '/api/portal/requests'}
          onDraftToForm={handleDraftToForm}
        />
      )}

      {view === 'form' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <form
              id="new-request-form"
              onSubmit={handleSubmit}
              style={{ padding: '1.125rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              {/* AI assist entry. Sub-requests skip it: the parent already
                  carries the context an interview would ask for. */}
              {!isSubRequest && (
                <AiAssistCard
                  rebuild={aiDrafted}
                  isAdmin={isAdmin}
                  onOpen={() => { setAiSession(s => s + 1); setView('ai') }}
                />
              )}

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
                  <span>This lands as a <strong>sub-request</strong> of the request you came from, on the same client.</span>
                </div>
              )}

              {/* Client, then brand when that client has any. */}
              {isAdmin && !isSubRequest && (
                <FieldGroup label="Client" required htmlFor="req-client">
                  {clientsLoading ? (
                    <LoadingField>Loading clients...</LoadingField>
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

              {/* Brand is not part of the sub-request body, so it is not
                  offered there rather than offered and ignored. */}
              {isAdmin && !isSubRequest && clientOrgId && brandOptions.length > 0 && (
                <FieldGroup label="Brand" htmlFor="req-brand">
                  <StyledSelect id="req-brand" value={brandId} onChange={setBrandId}>
                    <option value="">No specific brand</option>
                    {brandOptions.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </StyledSelect>
                </FieldGroup>
              )}

              {/* Category tiles */}
              <FieldGroup label="What kind of work?">
                <CategoryGrid value={category} onChange={setCategory} />
              </FieldGroup>

              {/* Title */}
              <FieldGroup label={isClient ? 'Give it a short title' : 'Title'} required htmlFor="req-title">
                <StyledInput
                  id="req-title"
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  required
                  maxLength={200}
                  placeholder={isClient ? 'e.g. Refresh our homepage hero' : 'e.g. Homepage refresh'}
                />
              </FieldGroup>

              {/* Brief */}
              <FieldGroup
                label={isClient ? 'Tell us more' : 'Brief'}
                required={isClient}
                after={aiDrafted ? <AiDraftChip /> : null}
              >
                <RichBrief
                  value={description}
                  onChange={setDescription}
                  ariaLabel={isClient ? 'Tell us more' : 'Brief'}
                  placeholder={isClient
                    ? 'What you need, who it is for, and anything we should know...'
                    : 'What needs doing, and any context...'}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: '0.375rem 0 0' }}>
                  You can add files, images, and voice notes after submitting.
                </p>
              </FieldGroup>

              {/* Intake questions, only once a form has actually resolved. */}
              {isClient && intakeQuestions.length > 0 && (
                <IntakeQuestions
                  questions={intakeQuestions}
                  responses={formResponses}
                  onChange={(id, value) => setFormResponses(prev => ({ ...prev, [id]: value }))}
                />
              )}

              {/* Size */}
              {showSize && (
                <FieldGroup label="Size">
                  {suggestionShowing ? (
                    <SizeSuggestionChip
                      suggestion={suggestion}
                      canChange={largeAllowed}
                      onChange={() => setSizeChangeOpen(true)}
                    />
                  ) : (
                    <>
                      <SegmentedControl
                        role="radiogroup"
                        ariaLabel="Request size"
                        value={type}
                        onChange={setType}
                        options={sizeOptions}
                        fill
                      />
                      {isClient && (
                        <QuietLink onClick={() => setSizeChangeOpen(false)}>Use suggestion</QuietLink>
                      )}
                      {/* Only while there are two sizes to choose between:
                          on a single-track plan the hint and the Info note
                          below would say the same sentence twice. */}
                      {isAdmin && largeAllowed && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: '0.375rem 0 0', lineHeight: 1.45 }}>
                          {suggestion.hint}
                        </p>
                      )}
                      {isAdmin && !largeAllowed && (
                        <p style={{
                          display: 'flex', alignItems: 'flex-start', gap: '0.375rem',
                          fontSize: '0.75rem', color: 'var(--color-text-muted)',
                          margin: '0.375rem 0 0', lineHeight: 1.45,
                        }}>
                          <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.125rem' }} />
                          {`${selectedClient?.name ?? 'This client'} runs a single-day track, so requests are scoped to a day or less.`}
                        </p>
                      )}
                    </>
                  )}
                </FieldGroup>
              )}

              {/* Team: priority beside the date. Client: placement, then date. */}
              {isAdmin ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
                  <FieldGroup label="Priority" htmlFor="req-priority">
                    <StyledSelect id="req-priority" value={priority} onChange={setPriority}>
                      <option value="standard">Standard</option>
                      <option value="high">High</option>
                    </StyledSelect>
                  </FieldGroup>
                  <FieldGroup label="Ideal due date" htmlFor="req-due-date" after={<DueDateInfo />}>
                    <StyledInput
                      id="req-due-date"
                      type="date"
                      value={dueDate}
                      min={isoDatePlusDays(DUE_DATE_MIN_DAYS)}
                      onChange={e => setDueDate(e.target.value)}
                    />
                  </FieldGroup>
                </div>
              ) : (
                <>
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
                  <FieldGroup label="Ideal due date" htmlFor="req-due-date" after={<DueDateInfo />}>
                    <StyledInput
                      id="req-due-date"
                      type="date"
                      value={dueDate}
                      min={isoDatePlusDays(DUE_DATE_MIN_DAYS)}
                      onChange={e => setDueDate(e.target.value)}
                    />
                  </FieldGroup>
                </>
              )}

              {/* Planning fields, out of the way until the team wants them. */}
              {isAdmin && (
                <div>
                  <button
                    type="button"
                    className="tahi-reqd-more tahi-focus-ring"
                    aria-expanded={moreOpen}
                    aria-controls="req-more-details"
                    onClick={() => setMoreOpen(v => !v)}
                  >
                    <ChevronDown size={14} aria-hidden="true" className="tahi-reqd-more-chev" />
                    More details
                  </button>
                  {moreOpen && (
                    <div
                      id="req-more-details"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
                        gap: '0.75rem',
                        marginTop: '0.5rem',
                      }}
                    >
                      <FieldGroup label="Start date" htmlFor="req-start-date">
                        <StyledInput
                          id="req-start-date"
                          type="date"
                          value={startDate}
                          onChange={e => setStartDate(e.target.value)}
                        />
                      </FieldGroup>
                      <FieldGroup label="Est. hours" htmlFor="req-est-hours">
                        <StyledInput
                          id="req-est-hours"
                          type="number" min="0.5" max="999" step="0.5"
                          value={estimatedHours}
                          onChange={e => setEstimatedHours(e.target.value)}
                          placeholder="e.g. 4"
                        />
                      </FieldGroup>
                    </div>
                  )}
                </div>
              )}

              <div aria-live="polite">
                {successMessage && (
                  <div style={{
                    fontSize: '0.8125rem',
                    color: 'var(--color-brand-dark)',
                    background: 'var(--color-brand-50)',
                    border: '1px solid var(--color-brand-100)',
                    borderRadius: 'var(--radius-button)',
                    padding: '0.625rem 0.875rem',
                  }}>
                    {successMessage}
                  </div>
                )}
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
            </form>
          </div>

          {/* Footer: the note first, then the actions. */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            padding: '0.875rem 1.25rem',
            paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))',
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
            flexShrink: 0,
          }}>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
            }}>
              {isClient ? <Sparkles size={14} aria-hidden="true" /> : <Inbox size={14} aria-hidden="true" />}
              {isClient ? 'We will confirm where it sits in your queue' : 'Lands in Triage'}
            </span>
            {/* Why the button is off, in the open rather than in a title a
                disabled control never fires and a thumb can never reach. */}
            {blockedReason && (
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
              }}>
                <Info size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
                {blockedReason}
              </span>
            )}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '0.5rem',
              // The three actions break among themselves rather than squashing
              // the primary label into two lines under the panel's overflow.
              flexWrap: 'wrap',
              marginLeft: 'auto',
            }}>
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
              {isAdmin && (
                <SecondaryButton
                  onClick={e => handleSubmit(e, true)}
                  disabled={!canSubmit || submitting}
                  title={blockedReason}
                >
                  {submitting && savingAnother && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                  Save + another
                </SecondaryButton>
              )}
              <button
                type="submit"
                form="new-request-form"
                disabled={!canSubmit || submitting}
                title={blockedReason}
                className="tahi-focus-ring"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  minHeight: '2.75rem',
                  padding: '0.5625rem 1.25rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  // White, not --color-bg: --color-brand has no .dark override
                  // but --color-bg does, so the token would go near-black on
                  // green under .dark. Matches every other brand fill in the repo.
                  color: 'white',
                  background: !canSubmit || submitting ? 'var(--color-brand-200)' : BRAND,
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  cursor: !canSubmit || submitting ? 'not-allowed' : 'pointer',
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={e => {
                  if (canSubmit && !submitting) e.currentTarget.style.background = 'var(--color-brand-dark)'
                }}
                onMouseLeave={e => {
                  if (canSubmit && !submitting) e.currentTarget.style.background = BRAND
                }}
              >
                {submitting && !savingAnother && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {isClient ? 'Submit request' : 'Create request'}
              </button>
            </div>
          </div>
        </>
      )}
    </SlideOverShell>
  )
}

// ── Shell ──────────────────────────────────────────────────────────────────────

/** The centred modal every view of the dialog lives inside. */
function SlideOverShell({
  open, onClose, view, title, subtitle, children,
}: {
  open: boolean
  onClose: () => void
  view: DialogView
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  const done = view === 'done'
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      variant="center"
      // The whole body swaps between these three, which unmounts whatever held
      // focus. Naming the view here is what pulls focus back into the panel.
      contentKey={view}
      maxWidth="38.75rem"
      icon={view === 'ai' ? <Sparkles size={15} /> : undefined}
      title={done ? undefined : title}
      subtitle={done ? undefined : subtitle}
      ariaLabel={done ? 'Request created' : undefined}
    >
      {children}
    </SlideOver>
  )
}

// ── AI assist entry ────────────────────────────────────────────────────────────

/** The card at the top of the form that hands over to the AI interview. */
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
          color: 'white',
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

/** Credits a brief the AI wrote, so it never reads as someone's own words. */
function AiDraftChip() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.125rem 0.4375rem',
      borderRadius: 'var(--radius-badge)',
      background: 'var(--color-brand-100)',
      color: 'var(--color-brand-dark)',
      fontSize: '0.625rem',
      fontWeight: 700,
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
    }}>
      <Sparkles size={10} aria-hidden="true" />
      AI draft
    </span>
  )
}

// ── Category tiles ─────────────────────────────────────────────────────────────

function CategoryGrid({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const activeIndex = Math.max(0, CATEGORY_TILES.findIndex(c => c.value === value))
  return (
    <div className="tahi-reqd-catgrid" role="radiogroup" aria-label="What kind of work?">
      {CATEGORY_TILES.map((tile, index) => {
        const Icon = tile.icon
        const active = tile.value === value
        return (
          <button
            key={tile.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === activeIndex ? 0 : -1}
            data-active={active ? 'true' : undefined}
            className="tahi-reqd-cat tahi-focus-ring"
            onClick={() => onChange(tile.value)}
            onKeyDown={e => {
              const next = nextCategoryIndex(CATEGORY_TILES.length, index, e.key)
              if (next === null) return
              e.preventDefault()
              onChange(CATEGORY_TILES[next].value)
              const group = e.currentTarget.parentElement
              const buttons = group?.querySelectorAll<HTMLButtonElement>('button')
              buttons?.[next]?.focus()
            }}
          >
            <span className="tahi-reqd-cat-ic" style={{ background: tile.bg, color: tile.fg }} aria-hidden="true">
              <Icon size={17} />
            </span>
            {tile.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Ideal due date tooltip ─────────────────────────────────────────────────────

function DueDateInfo() {
  return (
    // showOnTap: without it a tap is swallowed and a phone never sees the one
    // sentence that says the date is a target rather than a promise.
    <Tooltip label={DUE_DATE_TIP} showOnTap>
      {/* A real button, so the copy is reachable by keyboard rather than
          hover only, and so a screen reader reads it from the label. */}
      <button type="button" aria-label={DUE_DATE_TIP} className="tahi-reqd-info tahi-focus-ring">
        <Info size={13} aria-hidden="true" />
      </button>
    </Tooltip>
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
          color: selected ? 'white' : 'var(--color-text-muted)',
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
          color: 'white',
        }}
      >
        {selected && <Check size={13} strokeWidth={3} />}
      </span>
    </button>
  )
}

// ── Confirmation ───────────────────────────────────────────────────────────────

/** What both audiences see the moment a request lands: the number, what
 *  happens next, and for a client on a retainer, where it sits in the queue. */
function RequestConfirmation({
  created, isClient, onDone, onGoToRequest,
}: {
  created: CreatedSummary
  isClient: boolean
  onDone: () => void
  onGoToRequest: () => void
}) {
  const nextLine =
    created.placement === 'replace'
      ? 'You have asked us to start this ahead of the current build, so we will confirm the swap with you shortly.'
      : created.placement === 'top'
        ? 'It has jumped to the top of your queue.'
        : 'You will see every step right here, and we will message you the moment there is something to look at.'
  const number = created.requestNumber
  const position = created.queuePosition
  const showQueue = isClient && created.retainer && created.placement !== 'replace' && position != null

  const heading = isClient ? 'Your request is in' : 'Request created'
  const body = isClient
    ? (number != null ? `We have it, request #${number}. ${nextLine}` : `We have it. ${nextLine}`)
    : (number != null
        ? `Request #${number} landed in Triage. Assign it and it starts moving.`
        : 'It landed in Triage. Assign it and it starts moving.')

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.75rem 1.5rem 0.5rem', textAlign: 'center' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '3.75rem',
          height: '3.75rem',
          margin: '0 auto 1rem',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-brand-50)',
          color: 'var(--color-brand)',
        }}>
          <CheckCircle2 size={30} aria-hidden="true" />
        </div>
        <h2 style={{ fontSize: '1.1875rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          {heading}
        </h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0', lineHeight: 1.55 }}>
          {body}
        </p>

        {showQueue && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            alignItems: 'center',
            columnGap: '0.875rem',
            maxWidth: '21.25rem',
            margin: '1.125rem auto 0',
            padding: '0.875rem 1rem',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
            textAlign: 'left',
          }}>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2.5rem',
              height: '2.5rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-brand)',
              color: 'white',
              fontSize: '1.0625rem',
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
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.875rem 1.25rem',
        paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))',
        borderTop: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-secondary)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginLeft: 'auto',
        }}>
          <SecondaryButton onClick={onDone}>Done</SecondaryButton>
          {!isClient && (
            <button
              type="button"
              onClick={onGoToRequest}
              className="tahi-focus-ring"
              style={{
                minHeight: '2.75rem',
                padding: '0.5625rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'white',
                background: BRAND,
                border: 'none',
                borderRadius: 'var(--radius-button)',
                cursor: 'pointer',
                transition: 'background 150ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-dark)' }}
              onMouseLeave={e => { e.currentTarget.style.background = BRAND }}
            >
              Go to request
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Intake questions ───────────────────────────────────────────────────────────

interface FormQuestion {
  id: string
  type: 'text' | 'textarea' | 'url' | 'select' | 'multiselect' | 'checkbox' | 'file'
  label: string
  required: boolean
  options?: string[]
}

/**
 * The API returns the questions either already parsed or as a JSON string, and
 * a broken form must not take the dialog down with it.
 */
export function parseIntakeQuestions(raw: unknown): FormQuestion[] {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
    return Array.isArray(parsed) ? parsed as FormQuestion[] : []
  } catch {
    return []
  }
}

function IntakeQuestions({
  questions, responses, onChange,
}: {
  questions: FormQuestion[]
  responses: Record<string, string>
  onChange: (id: string, value: string) => void
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.875rem',
      padding: '0.875rem 1rem',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-card)',
      background: 'var(--color-bg-secondary)',
    }}>
      <p style={{
        fontSize: '0.6875rem',
        fontWeight: 700,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        margin: 0,
      }}>
        A few more questions
      </p>
      {questions.map(q => (
        <FieldGroup
          key={q.id}
          label={q.label}
          required={q.required}
          htmlFor={q.type === 'checkbox' ? undefined : `intake-${q.id}`}
        >
          {q.type === 'textarea' ? (
            <StyledTextarea
              id={`intake-${q.id}`}
              value={responses[q.id] ?? ''}
              onChange={e => onChange(q.id, e.target.value)}
              rows={3}
              required={q.required}
            />
          ) : q.type === 'select' ? (
            <StyledSelect
              id={`intake-${q.id}`}
              value={responses[q.id] ?? ''}
              onChange={v => onChange(q.id, v)}
              required={q.required}
            >
              <option value="">Select...</option>
              {(q.options ?? []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </StyledSelect>
          ) : q.type === 'checkbox' ? (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              minHeight: '2.75rem', fontSize: '0.875rem', color: 'var(--color-text)',
            }}>
              <input
                type="checkbox"
                className="tahi-focus-ring"
                aria-label={q.label}
                checked={responses[q.id] === 'true'}
                onChange={e => onChange(q.id, e.target.checked ? 'true' : 'false')}
              />
              Yes
            </label>
          ) : (
            <StyledInput
              id={`intake-${q.id}`}
              type={q.type === 'url' ? 'url' : 'text'}
              value={responses[q.id] ?? ''}
              onChange={e => onChange(q.id, e.target.value)}
              required={q.required}
            />
          )}
        </FieldGroup>
      ))}
    </div>
  )
}

// ── The legacy dialog, unchanged for everyone outside the gate ─────────────────

/**
 * The intake block exactly as the shipped dialog draws it: a top-divider
 * section, "Additional questions", the required marker inside the label text
 * and the question repeated as the checkbox's own words. Kept legacy-local
 * rather than pointed at the shared <IntakeQuestions> above so that the
 * rollout gate really does mean nothing changes for a client until it flips.
 * Delete it with LegacyRequestDialog.
 */
function LegacyIntakeQuestions({
  questions, responses, onChange,
}: {
  questions: FormQuestion[]
  responses: Record<string, string>
  onChange: (id: string, value: string) => void
}) {
  return (
    <div style={{
      borderTop: '1px solid var(--color-border-subtle)',
      paddingTop: '1rem',
      marginTop: '0.5rem',
    }}>
      <p style={{
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '0.75rem',
      }}>
        Additional questions
      </p>
      {questions.map(q => (
        <FieldGroup key={q.id} label={`${q.label}${q.required ? ' *' : ''}`} htmlFor={`intake-${q.id}`}>
          {q.type === 'textarea' ? (
            <StyledTextarea
              id={`intake-${q.id}`}
              value={responses[q.id] ?? ''}
              onChange={e => onChange(q.id, e.target.value)}
              rows={3}
              required={q.required}
            />
          ) : q.type === 'select' ? (
            <StyledSelect
              id={`intake-${q.id}`}
              value={responses[q.id] ?? ''}
              onChange={v => onChange(q.id, v)}
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
                checked={responses[q.id] === 'true'}
                onChange={e => onChange(q.id, e.target.checked ? 'true' : 'false')}
              />
              {q.label}
            </label>
          ) : (
            <StyledInput
              id={`intake-${q.id}`}
              type={q.type === 'url' ? 'url' : 'text'}
              value={responses[q.id] ?? ''}
              onChange={e => onChange(q.id, e.target.value)}
              required={q.required}
            />
          )}
        </FieldGroup>
      ))}
    </div>
  )
}

function LegacyRequestDialog({
  open, onClose, isAdmin, canUseLargeTrack = true, defaultOrgId,
  parentRequestId, forceOrgId, onCreated, aiDraft,
}: NewRequestDialogProps) {
  const isSubRequest = !!parentRequestId
  const router = useRouter()
  const { showToast } = useToast()
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

  const selectedClient = clients.find(c => c.id === clientOrgId)
  const clientUsesTracks = isAdmin
    ? selectedClient?.planType === 'maintain' || selectedClient?.planType === 'scale'
    : canUseLargeTrack
  const showTrackSelector = isAdmin ? clientUsesTracks : true

  const [title, setTitle] = useState('')
  const [type, setType] = useState<RequestSize>('small_task')
  const [category, setCategory] = useState('development')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('standard')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')

  const [intakeQuestions, setIntakeQuestions] = useState<FormQuestion[]>([])
  const [formResponses, setFormResponses] = useState<Record<string, string>>({})
  const [intakeLoading, setIntakeLoading] = useState(false)

  useEffect(() => {
    if (isAdmin || !open) return
    setIntakeLoading(true)
    fetch(apiPath(`/api/portal/request-forms?category=${category}`))
      .then(r => r.json() as Promise<{ form?: { questions: string } }>)
      .then(data => setIntakeQuestions(parseIntakeQuestions(data.form?.questions)))
      .catch(() => setIntakeQuestions([]))
      .finally(() => setIntakeLoading(false))
  }, [category, open, isAdmin])

  useEffect(() => {
    if (!open || !isAdmin) return
    setClientsLoading(true)
    fetch(apiPath('/api/admin/clients?status=active'))
      .then(r => r.json() as Promise<{ organisations: Array<{ id: string; name: string; planType?: string | null }> }>)
      .then(data => setClients((data.organisations ?? []).map(o => ({ id: o.id, name: o.name, planType: o.planType }))))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false))
  }, [open, isAdmin])

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

  useEffect(() => {
    if (!open) return
    setTitle('')
    setType('small_task')
    setCategory('development')
    setDescription('')
    setPriority('standard')
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
  }, [open, forceOrgId, defaultOrgId])

  useEffect(() => {
    if (isAdmin && selectedClient?.planType === 'maintain' && type === 'large_task') {
      setType('small_task')
    }
  }, [isAdmin, selectedClient?.planType, type])

  const largeAllowed = isAdmin ? selectedClient?.planType !== 'maintain' : canUseLargeTrack
  const suggestion: SizeSuggestion = useMemo(
    () => suggestRequestSize({ brief: description, category, canUseLargeTrack: largeAllowed }),
    [description, category, largeAllowed],
  )

  useEffect(() => {
    if (!open || !aiDraft) return
    if (aiDraft.title) setTitle(aiDraft.title)
    if (aiDraft.description) setDescription(aiDraft.description)
    if (aiDraft.category) setCategory(aiDraft.category)
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
      const url = isSubRequest
        ? apiPath(`/api/admin/requests/${parentRequestId}/sub-requests`)
        : (isAdmin ? apiPath('/api/admin/requests') : apiPath('/api/portal/requests'))

      const reqBody = isSubRequest
        ? {
            title: title.trim(),
            description,
            size: (type === 'large_task' ? 'large' : 'small') as 'large' | 'small',
            category,
            priority,
            dueDate: dueDate || null,
            estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          }
        : isAdmin
        ? {
            clientOrgId, title: title.trim(), type, category, description, priority,
            isInternal: 0,
            startDate: startDate || null,
            dueDate: dueDate || null,
            estimatedHours: estimatedHours ? Number(estimatedHours) : null,
            brandId: brandId || null,
          }
        : {
            title: title.trim(), type, category, description, dueDate: dueDate || null,
            formResponses: Object.keys(formResponses).length > 0 ? JSON.stringify(formResponses) : undefined,
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

      const data = await res.json() as { id: string }
      showToast('Request created successfully')

      if (saveAndCreateAnother) {
        setTitle('')
        setDescription('')
        setPriority('standard')
        setStartDate('')
        setDueDate('')
        setEstimatedHours('')
        setSuccessMessage('Request created successfully. Create another one below.')
        setCreateAnother(true)
        // Same refresh signal as the aligned branch above: the callers that
        // close do that themselves, and the sub-request panels revalidate in
        // here. Until the gate flips this is the branch a normal admin sees.
        onCreated?.(data.id)
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
            className="tahi-focus-ring"
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

        <form
          id="legacy-new-request-form"
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

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

            {isAdmin && !isSubRequest && (
              <FieldGroup label="Client" required htmlFor="req-client">
                {clientsLoading ? (
                  <LoadingField>Loading clients...</LoadingField>
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

            {isAdmin && clientOrgId && (brandOptions.length > 0 || brandsLoading) && (
              <FieldGroup label="Brand" htmlFor="req-brand">
                {brandsLoading ? (
                  <LoadingField>Loading brands...</LoadingField>
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

            {showTrackSelector && (
            <FieldGroup label="Task size">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                {REQUEST_TYPES.map(t => {
                  const clientPlan = selectedClient?.planType
                  const locked = t.requiresScale && (
                    isAdmin ? clientPlan === 'maintain' : !canUseLargeTrack
                  )
                  const active = type === t.value
                  const Icon = t.icon
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={locked}
                      onClick={() => !locked && setType(t.value as RequestSize)}
                      className="tahi-focus-ring"
                      style={{
                        padding: '0.875rem 0.75rem',
                        borderRadius: 'var(--radius-card)',
                        border: active
                          ? '2px solid var(--color-brand)'
                          : locked
                            ? '2px solid var(--color-border-subtle)'
                            : '2px solid var(--color-border)',
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
                          style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', color: BRAND }}
                        />
                      )}
                      {locked && (
                        <Lock
                          size={12}
                          style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', color: 'var(--color-text-subtle)' }}
                        />
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.3125rem' }}>
                        <Icon size={14} style={{ color: active ? BRAND : 'var(--color-text-muted)', flexShrink: 0 }} />
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
                        className="tahi-focus-ring"
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

            {!isAdmin && intakeQuestions.length > 0 && (
              <LegacyIntakeQuestions
                questions={intakeQuestions}
                responses={formResponses}
                onChange={(id, value) => setFormResponses(prev => ({ ...prev, [id]: value }))}
              />
            )}
            {!isAdmin && intakeLoading && (
              <div style={{ textAlign: 'center', padding: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                Loading form...
              </div>
            )}

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
            className="tahi-focus-ring"
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
              className="tahi-focus-ring"
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
              form="legacy-new-request-form"
              disabled={submitting || !title.trim()}
              // Kept from the shipped dialog: the click handler preventDefaults,
              // so the form's own submit never runs and native validation stays
              // out of the way exactly as it does today.
              onClick={handleSubmit}
              className="tahi-focus-ring"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5625rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'white',
                background: submitting || !title.trim() ? 'var(--color-brand-200)' : BRAND,
                border: 'none',
                borderRadius: 'var(--radius-button)',
                cursor: submitting || !title.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (!submitting && title.trim()) e.currentTarget.style.background = 'var(--color-brand-dark)'
              }}
              onMouseLeave={e => {
                if (!submitting && title.trim()) e.currentTarget.style.background = BRAND
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

// ── Small shared pieces ────────────────────────────────────────────────────────

function FieldGroup({
  label, required, htmlFor, after, children,
}: {
  label: string
  required?: boolean
  htmlFor?: string
  /** Sits beside the label: the AI draft chip, the due-date info tooltip. */
  after?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {/* The chip and the info tooltip sit beside the label rather than inside
          it: a focusable element inside a <label> steals the click that should
          land on the field. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
        <label
          htmlFor={htmlFor}
          style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}
        >
          {label}
          {required && <span style={{ color: 'var(--color-danger)', marginLeft: '0.125rem' }}>*</span>}
        </label>
        {after}
      </div>
      {children}
    </div>
  )
}

function LoadingField({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      height: '2.625rem', padding: '0 0.75rem',
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-input)',
      fontSize: '0.8125rem', color: 'var(--color-text-subtle)',
    }}>
      <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      {children}
    </div>
  )
}

function SecondaryButton({
  onClick, disabled, title, children,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="tahi-focus-ring"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        minHeight: '2.75rem',
        padding: '0.5625rem 0.875rem',
        fontSize: '0.8125rem',
        fontWeight: 500,
        color: disabled ? 'var(--color-text-subtle)' : 'var(--color-text)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-button)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        if (disabled) return
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.background = 'var(--color-brand-50)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'var(--color-bg)'
      }}
    >
      {children}
    </button>
  )
}

function StyledInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={['tahi-focus-ring', props.className].filter(Boolean).join(' ')}
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
    />
  )
}

function StyledTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={['tahi-focus-ring', props.className].filter(Boolean).join(' ')}
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
    />
  )
}

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
        className="tahi-focus-ring"
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
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        style={{
          position: 'absolute', right: '0.625rem', top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--color-text-subtle)',
        }}
      />
    </div>
  )
}
