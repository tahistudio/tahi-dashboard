'use client'

/**
 * The shared pieces behind the two client money surfaces (Invoices and
 * Services). Small on purpose: everything here is either a house primitive
 * with the portal's copy rules applied, or a control the design pack asked
 * for that the repo did not already have (the copy row, the ask sheet).
 *
 * House rules that every control in this file keeps:
 *   hover + .tahi-focus-ring on anything interactive
 *   2.75rem touch target below md
 *   nothing revealed on hover alone
 *   CSS var tokens only, so dark mode falls out of the tokens
 *   borders on all sides or none
 */

import * as React from 'react'
import { Check, Copy, Leaf, Send, Loader2, MessageSquare, Plus, Mail } from 'lucide-react'
import Link from 'next/link'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { apiPath } from '@/lib/api'
import { TAHI_CONTACT_EMAIL } from '@/lib/blog-schema-shared'

// ── Money ─────────────────────────────────────────────────────────────────────

/**
 * A figure on a client money surface. Always `data-private` (Private mode
 * blurs it) and always tabular, so a column of amounts lines up.
 */
export function PortalMoney({
  children,
  size = 'md',
}: {
  children: React.ReactNode
  size?: 'md' | 'lg' | 'hero'
}) {
  const fontSize = size === 'hero' ? '2rem' : size === 'lg' ? '1.125rem' : '0.875rem'
  return (
    <span
      data-private=""
      style={{
        fontVariantNumeric: 'tabular-nums',
        fontWeight: size === 'md' ? 600 : 700,
        fontSize,
        letterSpacing: size === 'hero' ? '-0.02em' : undefined,
        color: 'var(--color-text)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

// ── Status ────────────────────────────────────────────────────────────────────

/** The three-word client status, as a soft badge with a leading dot. */
export function PortalStatusPill({ label, tone }: { label: string; tone: BadgeTone }) {
  return <Badge tone={tone} variant="soft" size="sm">{label}</Badge>
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

/**
 * One loading idiom across both surfaces. The live product uses four for the
 * same moment; everything here is the house shimmer.
 */
export function PortalSkeleton({
  width,
  height = '0.6875rem',
  radius = 'var(--radius-sm)',
}: {
  width: string
  height?: string
  radius?: string
}) {
  return (
    <span
      aria-hidden="true"
      className="tahi-shimmer"
      style={{ display: 'block', width, height, borderRadius: radius }}
    />
  )
}

// ── Copy row ──────────────────────────────────────────────────────────────────

/**
 * One line of a payment instruction, with its own Copy.
 *
 * Per field rather than one blob, because a person paying by internet banking
 * fills four separate inputs and copying the lot into each of them is how a
 * reference gets typed wrong.
 */
export function PortalCopyRow({
  label,
  value,
  mono,
  onCopied,
}: {
  label: string
  value: string
  mono?: boolean
  onCopied?: (label: string) => void
}) {
  const [done, setDone] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = React.useCallback(() => {
    void copyText(value)
    setDone(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(false), 1600)
    onCopied?.(label)
  }, [value, label, onCopied])

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{ padding: 'var(--space-2) 0' }}
    >
      <span
        style={{
          flex: '0 0 8.5rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
      <span
        data-private=""
        style={{
          flex: '1 1 10rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--color-text)',
          fontFamily: mono ? 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)' : undefined,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        className="tahi-focus-ring min-h-11 md:min-h-8 inline-flex items-center gap-1.5 shrink-0"
        aria-label={`Copy ${label.toLowerCase()}`}
        style={{
          padding: '0.25rem 0.625rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: done ? 'var(--color-brand-50)' : 'var(--color-bg)',
          color: done ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
          fontSize: '0.75rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
        }}
      >
        {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** Clipboard writes are best effort: an insecure context has no clipboard. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Nothing to recover: the caller falls back to telling the reader.
  }
  return false
}

// ── Leaf empty tile ───────────────────────────────────────────────────────────

/** The leaf icon the house empty state expects. */
export function PortalLeafIcon() {
  return <Leaf className="w-8 h-8" aria-hidden="true" />
}

// ── Ask sheet ─────────────────────────────────────────────────────────────────

/** Where an ask goes. */
export type AskMode = 'request' | 'email'

export interface PortalAskSheetProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  /** Prefills the message body. The reader can edit or clear it. */
  seed?: string
  /** The title the new request is filed under when the reader starts one. */
  requestTitle: string
  /** The subject line of the mailto fallback. */
  emailSubject: string
  /** Offer "Start a request" at all. False for a question about a bill. */
  allowRequest?: boolean
  placeholder?: string
  /** Studio preview: every write is refused, so both destinations say so. */
  readOnly?: boolean
  /** Reason shown on a disabled control, so nothing is refused silently. */
  readOnlyReason?: string
}

/**
 * One panel for every soft ask on the client money surfaces.
 *
 * Two honest destinations, and the copy says out loud which one puts work in
 * the client's queue. "Start a request" posts to /api/portal/requests, which
 * is the same queue their Requests page reads. "Email us" opens their own mail
 * client addressed to the studio and adds nothing anywhere.
 */
export function PortalAskSheet({
  open,
  onClose,
  title,
  subtitle,
  seed,
  requestTitle,
  emailSubject,
  allowRequest = true,
  placeholder,
  readOnly,
  readOnlyReason = 'Read only while viewing as a client',
}: PortalAskSheetProps) {
  const [mode, setMode] = React.useState<AskMode>(allowRequest && !readOnly ? 'request' : 'email')
  const [body, setBody] = React.useState(seed ?? '')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sentId, setSentId] = React.useState<string | null>(null)
  const [sentMode, setSentMode] = React.useState<AskMode | null>(null)

  // Reopening for a different line item has to start clean, and the seed only
  // reaches the textarea on the open that carries it.
  React.useEffect(() => {
    if (!open) return
    setBody(seed ?? '')
    setError(null)
    setSentId(null)
    setSentMode(null)
    setSending(false)
    setMode(allowRequest && !readOnly ? 'request' : 'email')
  }, [open, seed, allowRequest, readOnly])

  const send = React.useCallback(async () => {
    const message = body.trim()
    if (!message) return

    if (mode === 'email') {
      const href = `mailto:${TAHI_CONTACT_EMAIL}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(message)}`
      if (typeof window !== 'undefined') window.location.href = href
      setSentMode('email')
      return
    }

    if (readOnly) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(apiPath('/api/portal/requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: requestTitle, description: message }),
      })
      if (!res.ok) {
        const info = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(info?.error ?? 'We could not send that just now.')
      }
      const created = await res.json() as { id?: string }
      setSentId(created.id ?? null)
      setSentMode('request')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not send that just now.')
    } finally {
      setSending(false)
    }
  }, [body, mode, emailSubject, requestTitle, readOnly])

  const sent = sentMode !== null

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      variant="center"
      maxWidth="34rem"
      title={sent ? (sentMode === 'request' ? 'Request sent' : 'Your email is ready') : title}
      subtitle={sent ? undefined : subtitle}
      contentKey={sent ? 'sent' : 'form'}
    >
      {sent ? (
        <div style={{ padding: 'var(--space-5)' }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: '2.75rem',
              height: '2.75rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-brand-50)',
              color: 'var(--color-brand-dark)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <Check size={22} aria-hidden="true" />
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text)', margin: 0 }}>
            {sentMode === 'request'
              ? 'It is in your queue. We will scope it and come back with a plan before anything starts.'
              : `Your mail app should be open with a message to ${TAHI_CONTACT_EMAIL}. Nothing has been added to your queue.`}
          </p>
          <div className="flex flex-wrap gap-2" style={{ marginTop: 'var(--space-4)' }}>
            {sentId && (
              <Link href={`/requests/${sentId}`} className="tahi-focus-ring" style={{ textDecoration: 'none' }}>
                <TahiButton variant="secondary" size="md">View it in Requests</TahiButton>
              </Link>
            )}
            <TahiButton variant="primary" size="md" onClick={onClose}>Done</TahiButton>
          </div>
        </div>
      ) : (
        <div style={{ padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
          {allowRequest && (
            <div role="radiogroup" aria-label="What would you like to happen" style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <AskModeOption
                selected={mode === 'request'}
                onSelect={() => setMode('request')}
                disabled={readOnly}
                disabledReason={readOnlyReason}
                icon={<Plus size={16} aria-hidden="true" />}
                title="Start a request"
                body="It joins your queue. We scope it, then confirm before any work starts."
              />
              <AskModeOption
                selected={mode === 'email'}
                onSelect={() => setMode('email')}
                icon={<Mail size={16} aria-hidden="true" />}
                title="Just a question"
                body={`Opens an email to ${TAHI_CONTACT_EMAIL}. Nothing enters your queue.`}
              />
            </div>
          )}

          <div>
            <label
              htmlFor="portal-ask-body"
              style={{
                display: 'block',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                marginBottom: 'var(--space-2)',
              }}
            >
              What would you like to know?
            </label>
            <textarea
              id="portal-ask-body"
              className="tahi-focus-ring"
              rows={5}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={placeholder ?? 'Tell us what you need. A sentence is plenty.'}
              style={{
                width: '100%',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                lineHeight: 1.55,
                resize: 'vertical',
              }}
            />
          </div>

          {error && (
            <p role="alert" style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', margin: 0 }}>
              {error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span style={{ flex: 1, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              {mode === 'request'
                ? 'This adds one request to your queue.'
                : 'This adds nothing to your queue.'}
            </span>
            <div className="flex gap-2">
              <TahiButton variant="secondary" size="md" onClick={onClose}>Cancel</TahiButton>
              <TahiButton
                variant="primary"
                size="md"
                onClick={() => { void send() }}
                disabled={!body.trim() || sending || (mode === 'request' && !!readOnly)}
                title={mode === 'request' && readOnly ? readOnlyReason : undefined}
                iconLeft={sending
                  ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  : mode === 'request'
                    ? <MessageSquare size={15} aria-hidden="true" />
                    : <Send size={15} aria-hidden="true" />}
              >
                {sending ? 'Sending' : mode === 'request' ? 'Send request' : 'Open email'}
              </TahiButton>
            </div>
          </div>
        </div>
      )}
    </SlideOver>
  )
}

function AskModeOption({
  selected,
  onSelect,
  disabled,
  disabledReason,
  icon,
  title,
  body,
}: {
  selected: boolean
  onSelect: () => void
  disabled?: boolean
  disabledReason?: string
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onSelect}
      className="tahi-focus-ring min-h-11 flex items-start gap-3 text-left w-full"
      style={{
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${selected ? 'var(--color-brand)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-brand-50)' : 'var(--color-bg)',
        color: 'var(--color-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background-color var(--motion-quick) var(--ease-out), border-color var(--motion-quick) var(--ease-out)',
      }}
    >
      <span
        className="flex items-center justify-center shrink-0"
        style={{
          width: '1.75rem',
          height: '1.75rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: selected ? 'var(--color-brand-100)' : 'var(--color-bg-secondary)',
          color: selected ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
        }}
      >
        {icon}
      </span>
      <span style={{ display: 'grid', gap: '0.125rem' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.45 }}>{body}</span>
      </span>
    </button>
  )
}
