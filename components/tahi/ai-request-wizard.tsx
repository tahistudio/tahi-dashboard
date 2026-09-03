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
import { Sparkles, Send } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { SlideOver } from '@/components/tahi/slide-over'

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
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { reply?: string; requests?: RequestDraft[]; done?: boolean }
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply ?? 'Could you tell me a bit more?',
          ...(data.requests && data.requests.length > 0 ? { requests: data.requests } : {}),
        },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong drafting that. Could you try again?' },
      ])
    } finally {
      setSending(false)
    }
  }, [input, sending, messages, context, wizardEndpoint])

  const handleCreate = useCallback(async () => {
    if (!latestDrafts || creating) return
    // Admin flows need an explicit orgId passed in (they're drafting on
    // behalf of a client). Portal flows derive orgId server-side from
    // Clerk auth, so the front end doesn't need to send one.
    const isAdminFlow = context.speaker !== 'client'
    if (isAdminFlow && !context.orgId) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'I need a client to file this against. Go back to the form, pick a client, then come back.' },
      ])
      return
    }
    setCreating(true)
    try {
      const results: boolean[] = []
      for (const draft of latestDrafts) {
        const body: Record<string, unknown> = {
          title: draft.title,
          description: draft.description,
          category: draft.category,
          type: draft.type === 'large_task' || draft.type === 'new_feature' ? 'large_task' : 'small_task',
          priority: draft.priority,
          estimatedHours: draft.estimatedHours,
        }
        if (isAdminFlow) {
          body.orgId = context.orgId
          body.isInternal = true
        }
        const res = await fetch(apiPath(submitEndpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        results.push(res.ok)
      }
      const allOk = results.every(Boolean)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: allOk
            ? `Done. ${latestDrafts.length === 1 ? 'Request has' : `All ${latestDrafts.length} requests have`} been created.`
            : 'Some requests could not be created. Try again or fall back to the standard form.',
        },
      ])
      if (allOk) onRequestsCreated?.()
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Failed to create the request. Please try again.' },
      ])
    } finally {
      setCreating(false)
    }
  }, [latestDrafts, creating, context.orgId, context.speaker, submitEndpoint, onRequestsCreated])

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
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '0.625rem 0.875rem',
                borderRadius: 'var(--radius-lg)',
                background: msg.role === 'user' ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
                color: msg.role === 'user' ? 'var(--color-bg)' : 'var(--color-text)',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {msg.content}
            </div>
            {msg.requests && msg.requests.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                {msg.requests.map(draft => (
                  <DraftCard key={draft.id} draft={draft} />
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div
            aria-live="polite"
            aria-label="Drafting a reply"
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
                  color: 'var(--color-bg)',
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
              disabled={creating}
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
                  ? (creating ? 'var(--color-text-subtle)' : 'var(--color-brand-dark)')
                  : 'var(--color-bg)',
                border: onDraftToForm ? '1px solid var(--color-border)' : 'none',
                borderRadius: 'var(--radius-button)',
                fontSize: '0.875rem',
                fontWeight: onDraftToForm ? 500 : 600,
                cursor: creating ? 'not-allowed' : 'pointer',
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

function DraftCard({ draft }: { draft: RequestDraft }) {
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
