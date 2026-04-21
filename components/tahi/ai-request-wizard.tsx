/**
 * <AiRequestWizard> \u2014 conversational UI for drafting requests with AI.
 *
 * Mirrors AiTaskWizard's shape (chat \u2192 draft preview \u2192 create) but emits
 * request drafts and submits to /api/admin/requests. Clients never see
 * tasks; requests are the client-facing unit, so this wizard is safe to
 * surface in both admin and portal contexts once a portal endpoint
 * lands (Phase 2).
 */

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Sparkles, Send, Loader2 } from 'lucide-react'
import { apiPath } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RequestDraft {
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

interface AiRequestWizardProps {
  open: boolean
  onClose: () => void
  onRequestsCreated?: () => void
  context?: {
    orgId?: string
    speaker?: 'client' | 'admin'
    planType?: string
  }
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

const INITIAL_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'What would you like us to work on? Describe it in your own words and I\u2019ll draft a clear request.',
}

// ── Component ────────────────────────────────────────────────────────────────

export function AiRequestWizard({ open, onClose, onRequestsCreated, context = {} }: AiRequestWizardProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const resetWizard = useCallback(() => {
    setMessages([INITIAL_MESSAGE])
    setInput('')
  }, [])

  useEffect(() => {
    if (!open) resetWizard()
  }, [open, resetWizard])

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || sending) return
    const userMsg: ChatMessage = { role: 'user', content: trimmed }
    const newMessages: ChatMessage[] = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)
    try {
      const res = await fetch(apiPath('/api/admin/ai/request-wizard'), {
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
  }, [input, sending, messages, context])

  const handleCreate = useCallback(async () => {
    if (!latestDrafts || creating) return
    if (!context.orgId) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'I need a client to submit this against. Close the wizard and open the New Request dialog with a client selected.' },
      ])
      return
    }
    setCreating(true)
    try {
      const results: boolean[] = []
      for (const draft of latestDrafts) {
        const res = await fetch(apiPath('/api/admin/requests'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: context.orgId,
            title: draft.title,
            description: draft.description,
            category: draft.category,
            type: draft.type === 'large_task' || draft.type === 'new_feature' ? 'large_task' : 'small_task',
            priority: draft.priority,
            estimatedHours: draft.estimatedHours,
            isInternal: context.speaker === 'admin',
          }),
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
            : 'Some requests couldn\u2019t be created. Try again or fall back to the standard form.',
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
  }, [latestDrafts, creating, context.orgId, context.speaker, onRequestsCreated])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 60,
          background: 'rgba(0, 0, 0, 0.3)',
          transition: 'opacity 200ms ease',
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-request-wizard-title"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '100%',
          maxWidth: '34rem',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 70,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div
              style={{
                width: '2rem', height: '2rem',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Sparkles size={15} aria-hidden="true" />
            </div>
            <div>
              <h2 id="ai-request-wizard-title" style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                Draft a request with AI
              </h2>
              <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Describe what you need in plain English. I\u2019ll scope it.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close wizard"
            style={{
              width: '1.75rem', height: '1.75rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--color-bg-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
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
                  color: msg.role === 'user' ? 'white' : 'var(--color-text)',
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
            <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
              <Loader2 size={14} className="animate-spin" />
              Thinking\u2026
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Footer: input + create button */}
        <div style={{
          borderTop: '1px solid var(--color-border-subtle)',
          padding: '0.75rem 1.25rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.625rem',
          flexShrink: 0,
          background: 'var(--color-bg)',
        }}>
          {latestDrafts && latestDrafts.length > 0 && (
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                padding: '0.625rem 0.875rem',
                background: 'var(--color-brand)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-leaf-sm)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: creating ? 'not-allowed' : 'pointer',
                opacity: creating ? 0.7 : 1,
              }}
            >
              {creating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creating\u2026
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  {latestDrafts.length === 1 ? 'Create request' : `Create ${latestDrafts.length} requests`}
                </>
              )}
            </button>
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
              placeholder="Describe what you need\u2026"
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
              onClick={sendMessage}
              disabled={!input.trim() || sending || creating}
              aria-label="Send message"
              style={{
                width: '2rem',
                height: '2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: input.trim() && !sending ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                color: input.trim() && !sending ? 'white' : 'var(--color-text-subtle)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: input.trim() && !sending ? 'pointer' : 'not-allowed',
                flexShrink: 0,
                transition: 'background-color 150ms ease',
              }}
            >
              <Send size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </>
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
        borderRadius: 999,
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
