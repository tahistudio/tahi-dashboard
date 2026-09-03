/**
 * <AiRequestWizard> and <AiRequestWizardPanel>. Conversational UI for drafting
 * requests with AI.
 *
 * Mirrors AiTaskWizard's shape (chat, draft preview, create) but emits request
 * drafts. Clients never see tasks; requests are the client-facing unit, so this
 * wizard is safe in both admin and portal contexts.
 *
 * Two entry points:
 *   - <AiRequestWizardPanel> is the body plus the footer with no shell of its
 *     own. The new request dialog renders it inside its own centred modal so
 *     the AI view and the form are the same surface, exactly as the prototype
 *     has it, rather than a second container sliding over the first.
 *   - <AiRequestWizard> keeps the standalone right-hand drawer for the callers
 *     that open the wizard on its own (the Requests page toolbar).
 *
 * The model call is live in both. What the prototype adds on top and this now
 * carries: a progress line, a typing indicator instead of a spinner, an opener
 * seeded from the category already chosen in the form, a way back to the form
 * at any point, and hand-back to the form as the primary action so a person
 * always reviews a draft before it is filed.
 */

'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Sparkles, Send, AlertTriangle } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { SlideOver } from '@/components/tahi/slide-over'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { looksLikeBriefHtml, plainTextToBriefHtml } from '@/lib/brief-html'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RequestDraft {
  id: string
  title: string
  description: string
  category: 'design' | 'development' | 'content' | 'strategy'
  type: 'small_task' | 'large_task' | 'bug_fix' | 'new_feature'
  priority: 'standard' | 'high'
  estimatedHours: number
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  requests?: RequestDraft[]
  /**
   * Renders as a warning strip rather than an assistant bubble. Used when the
   * model was never reached, so nobody mistakes a keyword draft or an error
   * for something Claude said.
   */
  notice?: boolean
}

interface ClientOption {
  id: string
  name: string
}

interface AiRequestWizardPanelProps {
  onRequestsCreated?: () => void
  context?: {
    orgId?: string
    speaker?: 'client' | 'admin'
    planType?: string
  }
  /** Which wizard endpoint to call. Clients pass the portal one. */
  wizardEndpoint?: string
  /** Where to POST the final request(s). Clients pass the portal one. */
  submitEndpoint?: string
  /**
   * When set, hand-back becomes the primary action: the draft goes to the
   * caller's form and nothing is posted, so the person edits and submits it
   * themselves. Posting straight from the wizard stays available as the
   * secondary action.
   */
  onDraftToForm?: (draft: RequestDraft) => void
  /**
   * The category already chosen in the form. Seeds the opening question so the
   * first answer is about the work rather than about what kind of work it is.
   */
  category?: string
  /** Renders the escape back to the form. Omit it and no escape is offered. */
  onWriteItMyself?: () => void
}

interface AiRequestWizardProps extends AiRequestWizardPanelProps {
  open: boolean
  onClose: () => void
}

// ── Styling maps (match AiTaskWizard palette) ────────────────────────────────

const CATEGORY_STYLES: Record<RequestDraft['category'], { bg: string; text: string; label: string }> = {
  design:      { bg: 'var(--status-client-review-bg)', text: 'var(--status-client-review-text)', label: 'Design' },
  development: { bg: 'var(--status-submitted-bg)',     text: 'var(--status-submitted-text)',     label: 'Development' },
  content:     { bg: 'var(--status-in-progress-bg)',   text: 'var(--status-in-progress-text)',   label: 'Content' },
  strategy:    { bg: 'var(--color-bg-tertiary)',       text: 'var(--color-text-muted)',          label: 'Strategy' },
}

const TYPE_LABELS: Record<RequestDraft['type'], string> = {
  small_task:  'Small',
  large_task:  'Large',
  bug_fix:     'Bug fix',
  new_feature: 'New feature',
}

const PRIORITY_STYLES: Record<RequestDraft['priority'], { bg: string; text: string; label: string }> = {
  standard: { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)', label: 'Standard' },
  high:     { bg: 'var(--priority-high-bg)',  text: 'var(--priority-high-text)', label: 'High' },
}

// ── Opening question, seeded from the category ───────────────────────────────

const DEFAULT_OPENER =
  'What would you like us to work on? Describe it in your own words and I will draft a clear request.'

/** The first thing the assistant says, per category. */
const CATEGORY_OPENERS: Record<string, string> = {
  design:      'Let us shape this together. In a line or two, what are we designing?',
  development: 'Happy to scope this build. What needs building, and where does it live?',
  content:     'Let us brief this piece. What are we writing, and who is it for?',
  strategy:    'Let us frame the thinking. What is the challenge or the goal?',
  admin:       'Tell me what you need and I will write it up.',
  bug:         'Let us capture this clearly. What is going wrong, and where?',
}

/**
 * The opener for a category, falling back to the generic one. Pure so the
 * dialog and the tests agree on what a fresh conversation starts with.
 */
export function openerForCategory(category?: string | null): string {
  if (!category) return DEFAULT_OPENER
  return CATEGORY_OPENERS[category] ?? DEFAULT_OPENER
}

// ── Progress ──────────────────────────────────────────────────────────────────

/** The shortest a useful interview runs, so the bar does not start near full. */
export const AI_MIN_STEPS = 3

/**
 * Where the interview is up to. The model decides how many questions it asks,
 * so the total grows with the conversation instead of pretending to know it:
 * the bar always leaves one step to go until a draft actually lands.
 */
export function aiWizardProgress(answered: number, hasDraft: boolean): { percent: number; label: string } {
  if (hasDraft) return { percent: 100, label: 'Draft ready' }
  const safe = Math.max(0, Math.floor(answered))
  const total = Math.max(AI_MIN_STEPS, safe + 1)
  return { percent: Math.round((safe / total) * 100), label: `${safe} / ${total}` }
}

/** Shown above a draft the model never touched, so nobody files it blind. */
export const DEGRADED_PREFIX =
  'AI is unavailable right now, so this is a rough draft built from your own words. Read it closely before you file it.'

// ── Outbound create body ──────────────────────────────────────────────────────

/**
 * The brief as the request routes want it. Both wizards document their
 * `description` as plain text and leave the conversion to the caller, and the
 * detail page renders `requests.description` as HTML, so posting raw prose
 * collapses every paragraph break into one block. The hand-back path into the
 * dialog already converts; this is the same rule for the direct-create path.
 */
export function draftBriefHtml(description?: string | null): string {
  if (!description) return ''
  return looksLikeBriefHtml(description) ? description : plainTextToBriefHtml(description)
}

export interface CreateRequestBodyInput {
  draft: RequestDraft
  /** 'admin' posts on behalf of a client; 'client' is the portal. */
  speaker?: 'client' | 'admin'
  /** The client the admin flow files against. Ignored on the portal flow,
   *  where the route derives the org from the caller's Clerk session. */
  clientOrgId?: string | null
  /** Only ever true when the person ticked it. An AI draft is normal client
   *  work by default; internal hides it from the portal entirely. */
  internalOnly?: boolean
}

/**
 * The body the wizard POSTs to the create route.
 *
 * The admin route destructures `clientOrgId` and 400s without it, so sending
 * `orgId` (as this used to) meant every AI create failed and nothing was ever
 * written. Kept pure so a test can assert the field names rather than the
 * dialog discovering them in production.
 */
export function buildCreateRequestBody(input: CreateRequestBodyInput): Record<string, unknown> {
  const { draft, speaker, clientOrgId, internalOnly } = input
  const body: Record<string, unknown> = {
    title: draft.title,
    description: draftBriefHtml(draft.description),
    category: draft.category,
    // The wizard's vocabulary is wider than the two sizes a request carries,
    // so anything bigger than a small task lands on large.
    type: draft.type === 'large_task' || draft.type === 'new_feature' ? 'large_task' : 'small_task',
    priority: draft.priority,
    estimatedHours: draft.estimatedHours,
  }
  if (speaker !== 'client') {
    body.clientOrgId = clientOrgId ?? ''
    if (internalOnly) body.isInternal = true
  }
  return body
}

// ── Which of the panel's own submit controls apply ───────────────────────────

export interface WizardSubmitControlsInput {
  /** False on the portal, where the route derives the org from the session. */
  isAdminFlow: boolean
  /** The caller already named the client, so the panel does not have to ask. */
  hasContextOrg: boolean
  /** `onDraftToForm` is wired: the caller's form is what actually gets filed. */
  handsBackToForm: boolean
}

/**
 * The client picker and the internal-only tick belong to whoever posts the
 * request, and that is not this panel whenever a form is waiting for the draft.
 *
 * Hand-back carries title, description, category and type and nothing else, and
 * the new request dialog submits its own body with its own client field and its
 * own visibility rule. A tick set here would be dropped on the way, and a
 * client picked here would be the second picker on screen while the dialog's
 * own field stayed empty and its Create stayed disabled. So the panel offers
 * both only on the standalone drawer, where its Create button is the only way
 * out.
 */
export function wizardSubmitControls(
  input: WizardSubmitControlsInput,
): { clientPicker: boolean; internalOnly: boolean } {
  const ownsSubmit = !input.handsBackToForm
  return {
    clientPicker: input.isAdminFlow && ownsSubmit && !input.hasContextOrg,
    internalOnly: input.isAdminFlow && ownsSubmit,
  }
}

// ── Local styles ──────────────────────────────────────────────────────────────

const AI_WIZARD_CSS = `
.tahi-ai-typing{ display: inline-flex; align-items: center; gap: 0.1875rem; padding: 0.1875rem 0; }
.tahi-ai-typing i{
  width: 0.375rem;
  height: 0.375rem;
  border-radius: var(--radius-full);
  background: var(--color-text-subtle);
  animation: tahi-ai-typing 1.1s infinite ease-in-out;
}
.tahi-ai-typing i:nth-child(2){ animation-delay: 0.18s; }
.tahi-ai-typing i:nth-child(3){ animation-delay: 0.36s; }
@keyframes tahi-ai-typing{
  0%, 60%, 100%{ transform: none; opacity: 0.4; }
  30%{ transform: translateY(-0.25rem); opacity: 1; }
}
.tahi-ai-progress-fill{ transition: width var(--motion-medium, 300ms) var(--ease-out, ease); }
@media (prefers-reduced-motion: reduce){
  .tahi-ai-typing i{ animation: none; opacity: 0.55; }
  .tahi-ai-progress-fill{ transition: none; }
}
`

// ── Panel ─────────────────────────────────────────────────────────────────────

export function AiRequestWizardPanel({
  onRequestsCreated,
  context = {},
  wizardEndpoint = '/api/admin/ai/request-wizard',
  submitEndpoint = '/api/admin/requests',
  onDraftToForm,
  category,
  onWriteItMyself,
}: AiRequestWizardPanelProps) {
  const opener = useMemo<ChatMessage>(
    () => ({ role: 'assistant', content: openerForCategory(category) }),
    [category],
  )
  const [messages, setMessages] = useState<ChatMessage[]>([opener])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Which client the admin flow files against. `context.orgId` wins when the
  // caller already knows it (the dialog's own picker, or the rail's client
  // filter); the standalone drawer opens with nothing, so the wizard asks.
  const isAdminFlow = context.speaker !== 'client'
  const [pickedClientId, setPickedClientId] = useState<string | null>(null)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [internalOnly, setInternalOnly] = useState(false)
  const controls = wizardSubmitControls({
    isAdminFlow,
    hasContextOrg: !!context.orgId,
    handsBackToForm: !!onDraftToForm,
  })
  const needsClientPicker = controls.clientPicker
  // `||`, not `??`: the dialog passes '' while its own picker is empty, and an
  // empty string must fall through to the one this panel offers.
  const targetOrgId = context.orgId || pickedClientId || ''

  useEffect(() => {
    if (!needsClientPicker) return
    let cancelled = false
    setClientsLoading(true)
    fetch(apiPath('/api/admin/clients?status=active'))
      .then(r => r.json() as Promise<{ organisations?: Array<{ id: string; name: string }> }>)
      .then(data => {
        if (cancelled) return
        setClients((data.organisations ?? []).map(o => ({ id: o.id, name: o.name })))
      })
      .catch(() => { if (!cancelled) setClients([]) })
      .finally(() => { if (!cancelled) setClientsLoading(false) })
    return () => { cancelled = true }
  }, [needsClientPicker])

  // Latest draft batch (the most recent assistant message with requests).
  const latestDrafts = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.requests && m.requests.length > 0) return m.requests
    }
    return null
  })()

  const answered = messages.filter(m => m.role === 'user').length
  const progress = aiWizardProgress(answered, !!latestDrafts)
  /** Nothing may be filed until the admin flow knows whose work this is. */
  const createBlocked = isAdminFlow && !targetOrgId

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 100)
    return () => window.clearTimeout(t)
  }, [])

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || sending) return
    const userMsg: ChatMessage = { role: 'user', content: trimmed }
    const newMessages: ChatMessage[] = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)
    try {
      const res = await fetch(apiPath(wizardEndpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          context,
        }),
      })
      const data = await res.json().catch(() => ({})) as {
        reply?: string
        requests?: RequestDraft[]
        done?: boolean
        degraded?: boolean
        error?: string
      }
      // The route now says out loud when the model was not reached, so the
      // panel repeats it instead of printing a generic apology (or, worse,
      // rendering a keyword draft as if Claude wrote it).
      if (!res.ok) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            notice: true,
            content: data.error ?? 'Something went wrong drafting that. Could you try again?',
          },
        ])
        return
      }
      const reply = data.reply ?? 'Could you tell me a bit more?'
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.degraded ? `${DEGRADED_PREFIX}\n\n${reply}` : reply,
          ...(data.degraded ? { notice: true } : {}),
          ...(data.requests && data.requests.length > 0 ? { requests: data.requests } : {}),
        },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: true, content: 'Something went wrong drafting that. Could you try again?' },
      ])
    } finally {
      setSending(false)
    }
  }, [input, sending, messages, context, wizardEndpoint])

  const handleCreate = useCallback(async () => {
    if (!latestDrafts || creating) return
    // Admin flows file against a named client. Portal flows derive the org
    // server-side from Clerk auth, so the front end sends nothing.
    if (isAdminFlow && !targetOrgId) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: true, content: 'Pick the client this is for and I will file it.' },
      ])
      return
    }
    setCreating(true)
    try {
      const results: boolean[] = []
      for (const draft of latestDrafts) {
        const res = await fetch(apiPath(submitEndpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildCreateRequestBody({
            draft,
            speaker: context.speaker,
            clientOrgId: targetOrgId,
            internalOnly,
          })),
        })
        results.push(res.ok)
      }
      const allOk = results.every(Boolean)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          ...(allOk ? {} : { notice: true }),
          content: allOk
            ? `Done. ${latestDrafts.length === 1 ? 'Request has' : `All ${latestDrafts.length} requests have`} been created.`
            : 'Some requests could not be created. Try again or fall back to the standard form.',
        },
      ])
      if (allOk) onRequestsCreated?.()
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: true, content: 'Failed to create the request. Please try again.' },
      ])
    } finally {
      setCreating(false)
    }
  }, [latestDrafts, creating, isAdminFlow, targetOrgId, internalOnly, context.speaker, submitEndpoint, onRequestsCreated])

  return (
    <>
      <style>{AI_WIZARD_CSS}</style>

      {/* Progress line */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.25rem 0',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          whiteSpace: 'nowrap',
        }}>
          AI assist
        </span>
        <span
          role="progressbar"
          aria-label="Interview progress"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            flex: 1,
            height: '0.25rem',
            minWidth: '2rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg-tertiary)',
            overflow: 'hidden',
          }}
        >
          <span
            className="tahi-ai-progress-fill"
            style={{
              display: 'block',
              height: '100%',
              width: `${progress.percent}%`,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-brand)',
            }}
          />
        </span>
        <span style={{
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          whiteSpace: 'nowrap',
        }}>
          {progress.label}
        </span>
        {onWriteItMyself && (
          <button
            type="button"
            onClick={onWriteItMyself}
            className="tahi-focus-ring"
            style={{
              minHeight: '2rem',
              padding: '0 0.625rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'border-color 150ms ease, color 150ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.color = 'var(--color-text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            Write it myself
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--space-4) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        minHeight: '12rem',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <div
              role={msg.notice ? 'status' : undefined}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                display: msg.notice ? 'flex' : 'block',
                gap: '0.5rem',
                maxWidth: '85%',
                padding: '0.625rem 0.875rem',
                borderRadius: 'var(--radius-lg)',
                border: msg.notice ? '1px solid var(--badge-warning-border)' : 'none',
                background: msg.notice
                  ? 'var(--badge-warning-bg)'
                  : msg.role === 'user' ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
                color: msg.notice
                  ? 'var(--badge-warning-text)'
                  : msg.role === 'user' ? 'var(--color-text-on-dark)' : 'var(--color-text)',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {msg.notice && (
                <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.1875rem' }} />
              )}
              <span>{msg.content}</span>
            </div>
            {msg.requests && msg.requests.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                {msg.requests.map(draft => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    // One draft per card, so the person hands back the one they
                    // are reading rather than whichever came first. Only the
                    // latest batch is offered; older cards are transcript.
                    onUse={
                      onDraftToForm && msg.requests!.length > 1 && latestDrafts === msg.requests
                        ? () => onDraftToForm(draft)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '0.625rem 0.875rem',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-bg-secondary)',
            }}
          >
            <span className="tahi-ai-typing" aria-hidden="true"><i /><i /><i /></span>
          </div>
        )}
        {/* Mounted in every state on purpose: a live region only announces a
            change to text inside a region that already existed, so creating
            one alongside its own content says nothing at all. */}
        <div aria-live="polite" className="sr-only">
          {sending ? 'Drafting a reply' : ''}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Footer: actions + input */}
      <div style={{
        borderTop: '1px solid var(--color-border-subtle)',
        padding: '0.75rem 1.25rem 1rem',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        flexShrink: 0,
        background: 'var(--color-bg)',
      }}>
        {/* The client this gets filed against, asked for only where this panel
            is the thing that files it. The dialog owns its own client field, so
            a picker here would be the second one on screen and would not reach
            the dialog's submit body. The standalone drawer opens with none, and
            creating without it used to 400 on every draft with nothing on
            screen to fix. */}
        {latestDrafts && latestDrafts.length > 0 && needsClientPicker && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {/* A span, not a label: SearchableSelect's trigger is a portal'd
                button with no id to point htmlFor at, and its own placeholder
                is what a screen reader reads as the control's name. */}
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--color-text-subtle)',
              }}
            >
              Client
            </span>
            {clientsLoading ? (
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>
                Loading clients...
              </span>
            ) : (
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name }))}
                value={pickedClientId}
                onChange={setPickedClientId}
                placeholder="Pick the client this is for..."
                searchPlaceholder="Search clients..."
                size="sm"
              />
            )}
          </div>
        )}

        {/* Internal is a choice, never a default: an AI draft is normal client
            work unless the person says otherwise. Hidden when a form is waiting
            for the draft, because hand-back carries no visibility flag and the
            tick would quietly do nothing. */}
        {latestDrafts && latestDrafts.length > 0 && controls.internalOnly && (
          <label
            className="min-h-11 md:min-h-8"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <input
              type="checkbox"
              checked={internalOnly}
              onChange={e => setInternalOnly(e.target.checked)}
              className="tahi-focus-ring"
              style={{ width: '1rem', height: '1rem', accentColor: 'var(--color-brand)', cursor: 'pointer' }}
            />
            Internal only, hidden from the client portal
          </label>
        )}

        {latestDrafts && latestDrafts.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Hand-back is the primary action wherever a form is waiting: the
                person reads the draft in the field they will submit from. */}
            {onDraftToForm && (
              <button
                type="button"
                onClick={() => onDraftToForm(latestDrafts[0])}
                disabled={creating}
                className="tahi-focus-ring"
                style={{
                  flex: 1,
                  minWidth: '10rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.375rem',
                  minHeight: '2.75rem',
                  padding: '0.625rem 0.875rem',
                  background: creating ? 'var(--color-brand-200)' : 'var(--color-brand)',
                  color: 'var(--color-text-on-dark)',
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: creating ? 'not-allowed' : 'pointer',
                }}
              >
                <Sparkles size={14} aria-hidden="true" />
                {latestDrafts.length > 1 ? 'Use the first draft' : 'Use this draft'}
              </button>
            )}
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || createBlocked}
              title={createBlocked ? 'Pick the client this is for first' : undefined}
              className="tahi-focus-ring"
              style={{
                flex: onDraftToForm ? '0 0 auto' : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                minHeight: '2.75rem',
                padding: '0.625rem 0.875rem',
                background: onDraftToForm ? 'var(--color-bg)' : 'var(--color-brand)',
                color: onDraftToForm
                  ? (creating || createBlocked ? 'var(--color-text-subtle)' : 'var(--color-brand-dark)')
                  : 'var(--color-bg)',
                border: onDraftToForm ? '1px solid var(--color-border)' : 'none',
                borderRadius: 'var(--radius-button)',
                fontSize: '0.875rem',
                fontWeight: onDraftToForm ? 500 : 600,
                cursor: creating || createBlocked ? 'not-allowed' : 'pointer',
                opacity: createBlocked ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {!onDraftToForm && <Sparkles size={14} aria-hidden="true" />}
              {creating
                ? 'Creating...'
                : latestDrafts.length === 1 ? 'Create request' : `Create ${latestDrafts.length} requests`}
            </button>
          </div>
        )}
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '0.5rem',
          padding: '0.5rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg)',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            aria-label="Your answer"
            placeholder="Type your answer..."
            rows={1}
            style={{
              flex: 1,
              minHeight: '1.5rem',
              maxHeight: '8rem',
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '0.875rem',
              color: 'var(--color-text)',
              fontFamily: 'inherit',
              padding: '0.25rem',
            }}
            disabled={sending || creating}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || sending || creating}
            aria-label="Send message"
            className="tahi-focus-ring"
            style={{
              width: '2.25rem',
              height: '2.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: input.trim() && !sending ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
              color: input.trim() && !sending ? 'var(--color-bg)' : 'var(--color-text-subtle)',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              cursor: input.trim() && !sending ? 'pointer' : 'not-allowed',
              flexShrink: 0,
              transition: 'background-color 150ms ease',
            }}
          >
            <Send size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  )
}

// ── Standalone drawer ─────────────────────────────────────────────────────────

export function AiRequestWizard({ open, onClose, ...panel }: AiRequestWizardProps) {
  // A fresh conversation each time the drawer opens. The key remounts the
  // panel, which is what the old reset-on-close effect did by hand, and it
  // leaves the transcript on screen while the drawer slides out.
  const [session, setSession] = useState(0)
  useEffect(() => {
    if (open) setSession(s => s + 1)
  }, [open])

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<Sparkles size={15} />}
      title="Draft a request with AI"
      subtitle="Describe what you need in plain English and I will scope it."
      maxWidth="34rem"
    >
      <AiRequestWizardPanel key={session} {...panel} />
    </SlideOver>
  )
}

// ── Draft preview card ───────────────────────────────────────────────────────

function DraftCard({ draft, onUse }: { draft: RequestDraft; onUse?: () => void }) {
  const cat = CATEGORY_STYLES[draft.category]
  const pri = PRIORITY_STYLES[draft.priority]
  return (
    <div
      style={{
        padding: '0.75rem 0.875rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
        {draft.title}
      </div>
      {draft.description && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {draft.description}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
        <Chip bg={cat.bg} text={cat.text}>{cat.label}</Chip>
        <Chip bg="var(--color-bg-tertiary)" text="var(--color-text-muted)">{TYPE_LABELS[draft.type]}</Chip>
        <Chip bg={pri.bg} text={pri.text}>{pri.label} priority</Chip>
        <Chip bg="var(--color-bg-tertiary)" text="var(--color-text-muted)">{draft.estimatedHours}h</Chip>
      </div>
      {onUse && (
        <button
          type="button"
          onClick={onUse}
          className="tahi-focus-ring min-h-11 md:min-h-8"
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0 0.75rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-button)',
            background: 'var(--color-bg)',
            color: 'var(--color-brand-dark)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'border-color 150ms ease, background-color 150ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--color-brand)'
            e.currentTarget.style.background = 'var(--color-brand-50)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.background = 'var(--color-bg)'
          }}
        >
          <Sparkles size={13} aria-hidden="true" />
          Use this draft
        </button>
      )}
    </div>
  )
}

function Chip({ children, bg, text }: { children: React.ReactNode; bg: string; text: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.125rem 0.5rem',
        borderRadius: 'var(--radius-full)',
        fontSize: '0.6875rem',
        fontWeight: 500,
        background: bg,
        color: text,
      }}
    >
      {children}
    </span>
  )
}
