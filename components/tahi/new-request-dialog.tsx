'use client'

/**
 * <NewRequestDialog>. One dialog, two audiences.
 *
 * The rebuild against the approved Claude Design prototype: a centred modal,
 * an audience that runs off `isAdmin` alone, and the body in the order a
 * person fills it in (AI card, client, category tiles, title, brief, size,
 * priority or placement, ideal due date). Planning fields that are not intake
 * fields sit behind a "More details" disclosure.
 *
 * There was a second dialog in this file, the right-hand slide-over the
 * rebuild replaced, kept verbatim behind a NEW_DIALOG_FOR_EVERYONE flag so
 * that nothing moved for a client before the lead flipped it. The flag went
 * true in 51ef34b and every admin and every client has had the rebuild since,
 * which left seven hundred unreachable lines duplicating every field, still
 * type-checked, still linted, and still the first hit for anyone searching
 * this file for where a control lives. It is gone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import {
  Loader2, CheckCircle2, Layers, Clock,
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
import { AiRequestWizardPanel } from '@/components/tahi/ai-request-wizard'
import {
  suggestRequestSize,
  sizeToRequestType,
  type SizeSuggestion,
} from '@/lib/request-size-suggestion'
import {
  SuggestedField,
  SuggestedLabel,
  SuggestionLink,
  suggestionReasonId,
} from '@/components/tahi/forms/suggested-field'
import { useFieldPredictions } from '@/components/tahi/forms/use-field-predictions'
import type { PredictableField } from '@/lib/predict/types'

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
 * UTC, so "tomorrow" is tomorrow wherever they are. The picker floors at one
 * day out.
 */
export function isoDatePlusDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * The floor under the picker.
 *
 * There is deliberately no default any more. The ideal due date used to open
 * at today plus seven, a blind constant rendered as an ordinary filled field,
 * so nobody could tell a date the studio had thought about from one nobody
 * had. It now opens empty, which is honest on its own and leaves somewhere for
 * a grounded suggestion to land.
 */
export const DUE_DATE_MIN_DAYS = 1

/** The fields the team's request dialog will accept a suggestion for. */
const PREDICTED_REQUEST_FIELDS: readonly PredictableField[] = [
  'dueDate', 'priority', 'estimatedHours', 'category', 'size',
]

/** The defaults a control opens on, which read as empty until someone chooses. */
const DEFAULT_CATEGORY = 'development'
const DEFAULT_PRIORITY = 'standard'
const DEFAULT_SIZE: RequestSize = 'small_task'

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

/** Kept as the export every caller already names, rather than renaming a
 *  dozen import sites on the day the second dialog went away. */
export function NewRequestDialog(props: NewRequestDialogProps) {
  return <AlignedRequestDialog {...props} />
}

// ── The dialog ─────────────────────────────────────────────────────────

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
  const [type, setType] = useState<RequestSize>(DEFAULT_SIZE)
  const [category, setCategory] = useState(DEFAULT_CATEGORY)
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(DEFAULT_PRIORITY)
  const [placement, setPlacement] = useState<Placement>('queue')
  // Empty on purpose. See DUE_DATE_MIN_DAYS.
  const [dueDate, setDueDate] = useState('')
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
    setType(DEFAULT_SIZE)
    setCategory(DEFAULT_CATEGORY)
    setDescription('')
    setPriority(DEFAULT_PRIORITY)
    setPlacement('queue')
    setFormResponses({})
    setIntakeQuestions([])
    setStartDate('')
    setDueDate('')
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

  // ── Predictive autofill, team only ───────────────────────────────────────
  //
  // This dialog is one component serving both audiences, so the gate is the
  // hook itself rather than the fields it fills: with isAdmin false there is
  // no timer, no fetch and no state. A due date derived from the studio's own
  // medians and shown to a client reads as an SLA nobody agreed to, and a
  // client never sees priority or hours at all.
  //
  // A sub-request is out too: it inherits its parent's category and dates
  // locally, which is a better answer than a model's and costs nothing.
  const applyPrediction = useCallback((field: PredictableField, value: string | number) => {
    switch (field) {
      case 'dueDate':
        setDueDate(String(value))
        break
      case 'priority':
        setPriority(String(value))
        break
      case 'estimatedHours':
        setEstimatedHours(String(value))
        // A suggestion inside a collapsed disclosure is a suggestion nobody
        // sees, and one that lands on submit unread is worse than none.
        setMoreOpen(true)
        break
      case 'category':
        setCategory(String(value))
        break
      case 'size':
        setType(sizeToRequestType(value === 'large' ? 'large' : 'small'))
        break
      default:
        break
    }
  }, [])

  const clearPrediction = useCallback((field: PredictableField) => {
    switch (field) {
      case 'dueDate': setDueDate(''); break
      case 'priority': setPriority(DEFAULT_PRIORITY); break
      case 'estimatedHours': setEstimatedHours(''); break
      case 'category': setCategory(DEFAULT_CATEGORY); break
      case 'size': setType(DEFAULT_SIZE); break
      default: break
    }
  }, [])

  const predictions = useFieldPredictions({
    open: open && !isSubRequest,
    isAdmin,
    paused: view !== 'form',
    subject: 'request',
    title,
    description,
    orgId: clientOrgId || null,
    category: category === DEFAULT_CATEGORY ? null : category,
    fields: PREDICTED_REQUEST_FIELDS,
    // A control sitting on the value it opened with has not been answered, so
    // it reads as empty here. Anything the operator actually chose is in the
    // touched set already and never reaches this map.
    values: {
      dueDate: dueDate || null,
      priority: priority === DEFAULT_PRIORITY ? null : priority,
      estimatedHours: estimatedHours || null,
      category: category === DEFAULT_CATEGORY ? null : category,
      size: type === DEFAULT_SIZE ? null : type,
    },
    apply: applyPrediction,
    clear: clearPrediction,
  })
  const { markTouched, markWritten } = predictions

  // An AI-authored draft handed in by the caller pre-fills the form. It writes
  // the category, so the predictor is told: a draft outranks a guess, and the
  // two must not both land on the same field.
  useEffect(() => {
    if (!open || !aiDraft) return
    if (aiDraft.title) setTitle(aiDraft.title)
    if (aiDraft.description) setDescription(toBriefHtml(aiDraft.description))
    if (aiDraft.category) {
      setCategory(aiDraft.category)
      markWritten(['category'])
    }
    setAiDrafted(true)
  }, [open, aiDraft, markWritten])

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
    // A draft beats a prediction. Both fields it wrote are now spoken for, and
    // the predictor stands off for a moment rather than answering a title that
    // changed under it.
    markWritten(['category', 'size'])
    setView('form')
    showToast('Draft ready. Review it below.')
  }, [showToast, markWritten])

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
        setPriority(DEFAULT_PRIORITY)
        setStartDate('')
        setDueDate('')
        setEstimatedHours('')
        setAiDrafted(false)
        // A second item is a second item's worth of decisions.
        predictions.reset()
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
              <FieldGroup
                label="What kind of work?"
                after={predictions.isSuggested('category')
                  ? <SuggestedLabel label="category" onClear={() => predictions.clearField('category')} />
                  : null}
              >
                <SuggestedField
                  suggested={predictions.isSuggested('category')}
                  reason={predictions.reasonFor('category')}
                  fieldId="req-category"
                >
                  <CategoryGrid
                    value={category}
                    describedBy={predictions.isSuggested('category') ? suggestionReasonId('req-category') : undefined}
                    onChange={(v) => { markTouched('category'); setCategory(v) }}
                  />
                </SuggestedField>
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
                <FieldGroup
                  label="Size"
                  after={isAdmin && predictions.isSuggested('size')
                    ? <SuggestedLabel label="size" onClear={() => predictions.clearField('size')} />
                    : null}
                >
                  {suggestionShowing ? (
                    <SizeSuggestionChip
                      suggestion={suggestion}
                      canChange={largeAllowed}
                      onChange={() => setSizeChangeOpen(true)}
                    />
                  ) : (
                    <>
                      <SuggestedField
                        suggested={isAdmin && predictions.isSuggested('size')}
                        reason={predictions.reasonFor('size')}
                        fieldId="req-size"
                      >
                        <SegmentedControl
                          role="radiogroup"
                          ariaLabel="Request size"
                          value={type}
                          onChange={(next) => { markTouched('size'); setType(next) }}
                          options={sizeOptions}
                          fill
                        />
                      </SuggestedField>
                      {isClient && (
                        <QuietLink onClick={() => setSizeChangeOpen(false)}>Use suggestion</QuietLink>
                      )}
                      {/* Only while there are two sizes to choose between:
                          on a single-track plan the hint and the Info note
                          below would say the same sentence twice. */}
                      {/* The deterministic hint steps aside while a grounded
                          suggestion is on screen, or the field carries two
                          sentences about the same choice. */}
                      {isAdmin && largeAllowed && !predictions.isSuggested('size') && (
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
                  <FieldGroup
                    label="Priority"
                    htmlFor="req-priority"
                    after={predictions.isSuggested('priority')
                      ? <SuggestedLabel label="priority" onClear={() => predictions.clearField('priority')} />
                      : null}
                  >
                    <SuggestedField
                      suggested={predictions.isSuggested('priority')}
                      reason={predictions.reasonFor('priority')}
                      fieldId="req-priority"
                    >
                      <StyledSelect
                        id="req-priority"
                        value={priority}
                        describedBy={predictions.isSuggested('priority') ? suggestionReasonId('req-priority') : undefined}
                        onChange={(v) => { markTouched('priority'); setPriority(v) }}
                      >
                        <option value="standard">Standard</option>
                        <option value="high">High</option>
                      </StyledSelect>
                    </SuggestedField>
                  </FieldGroup>
                  <FieldGroup
                    label="Ideal due date"
                    htmlFor="req-due-date"
                    after={(
                      <>
                        <DueDateInfo />
                        {predictions.isSuggested('dueDate') && (
                          <SuggestedLabel label="due date" onClear={() => predictions.clearField('dueDate')} />
                        )}
                      </>
                    )}
                  >
                    <SuggestedField
                      suggested={predictions.isSuggested('dueDate')}
                      reason={predictions.reasonFor('dueDate')}
                      fieldId="req-due-date"
                    >
                      <StyledInput
                        id="req-due-date"
                        type="date"
                        value={dueDate}
                        min={isoDatePlusDays(DUE_DATE_MIN_DAYS)}
                        aria-describedby={predictions.isSuggested('dueDate') ? suggestionReasonId('req-due-date') : undefined}
                        onChange={e => { markTouched('dueDate'); setDueDate(e.target.value) }}
                      />
                    </SuggestedField>
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
                      <FieldGroup
                        label="Est. hours"
                        htmlFor="req-est-hours"
                        after={predictions.isSuggested('estimatedHours')
                          ? <SuggestedLabel label="estimated hours" onClear={() => predictions.clearField('estimatedHours')} />
                          : null}
                      >
                        <SuggestedField
                          suggested={predictions.isSuggested('estimatedHours')}
                          reason={predictions.reasonFor('estimatedHours')}
                          fieldId="req-est-hours"
                        >
                          <StyledInput
                            id="req-est-hours"
                            type="number" min="0.5" max="999" step="0.5"
                            value={estimatedHours}
                            aria-describedby={predictions.isSuggested('estimatedHours') ? suggestionReasonId('req-est-hours') : undefined}
                            onChange={e => { markTouched('estimatedHours'); setEstimatedHours(e.target.value) }}
                            placeholder="e.g. 4"
                          />
                        </SuggestedField>
                      </FieldGroup>
                    </div>
                  )}
                </div>
              )}

              {/* One link that empties every still-suggested field at once,
                  above the footer so it reads as "before you file this". */}
              {predictions.hasAny && (
                <div>
                  <SuggestionLink onClick={predictions.clearAll}>Clear suggestions</SuggestionLink>
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

function CategoryGrid({
  value, onChange, describedBy,
}: {
  value: string
  onChange: (v: string) => void
  /** The id of a caption under the grid, e.g. a suggestion's reason. */
  describedBy?: string
}) {
  const activeIndex = Math.max(0, CATEGORY_TILES.findIndex(c => c.value === value))
  return (
    <div
      className="tahi-reqd-catgrid"
      role="radiogroup"
      aria-label="What kind of work?"
      aria-describedby={describedBy}
    >
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
  id, value, onChange, required, describedBy, children,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  /** The id of a caption under the field, e.g. a suggestion's reason. */
  describedBy?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        id={id}
        value={value}
        required={required}
        aria-describedby={describedBy}
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
