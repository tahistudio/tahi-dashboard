/**
 * <EmailShareModal> — reusable "send public link via email" dialog used by
 * proposals / schedules / contracts. The caller supplies:
 *   - the resource title (for the heading)
 *   - the suggested recipients (contacts pulled from the linked org, or the
 *     pending signers in the contract case)
 *   - the POST URL to fire
 *   - an optional callback after a successful send
 *
 * The modal lets the user toggle which suggested recipients to include, add
 * ad-hoc recipients on the fly, write an optional note, and submit. It then
 * shows a result summary (N sent, errors per failed) before closing.
 */
'use client'

import { useState } from 'react'
import { X, Plus, Trash2, Mail, CheckCircle2, AlertCircle } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { apiPath } from '@/lib/api'

export interface EmailRecipientSuggestion {
  /** Stable identifier — for contract signers this is the signerId; for
   *  contacts it's the contactId. The field is opaque to this component
   *  and round-tripped to the parent via onSend if `mode === 'signers'`. */
  id?: string
  name: string
  email: string
  /** Optional eyebrow shown next to the recipient (e.g. "Tahi", "Primary"). */
  badge?: string
}

interface Props {
  open: boolean
  onClose: () => void
  resourceLabel: string                   // "proposal" | "schedule" | "contract"
  resourceTitle: string                   // human-readable name for heading
  suggestions: EmailRecipientSuggestion[]
  /** API route to POST to. */
  postUrl: string
  /** When true, body shape is { signerIds, cc?, bcc?, subject?, message? }
   *  (contract mode). Otherwise body shape is
   *  { to, cc?, bcc?, subject?, message? }. */
  mode: 'recipients' | 'signers'
  /** Default subject — shown in the input so the user can edit before send.
   *  When the field is left blank, the backend falls back to its own default. */
  defaultSubject?: string
  onSent?: (result: { sent: number; failed: number }) => void
}

const inputCn = 'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]'

export function EmailShareModal({
  open, onClose, resourceLabel, resourceTitle, suggestions, postUrl, mode, defaultSubject, onSent,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(suggestions.map(s => s.id ?? s.email))
  )
  const [adhoc, setAdhoc] = useState<Array<{ name: string; email: string }>>([])
  const [cc, setCc] = useState<Array<{ name: string; email: string }>>([])
  const [bcc, setBcc] = useState<Array<{ name: string; email: string }>>([])
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState(defaultSubject ?? '')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<null | { sent: number; failed: number; errors: string[] }>(null)

  if (!open) return null

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totalSelected =
    suggestions.filter(s => selected.has(s.id ?? s.email)).length +
    adhoc.filter(a => a.email.trim()).length

  async function submit() {
    if (totalSelected === 0) return
    setSending(true)
    try {
      const ccClean = cc.filter(a => a.email.trim())
      const bccClean = bcc.filter(a => a.email.trim())
      const trimmedSubject = subject.trim()
      let body: Record<string, unknown>
      if (mode === 'signers') {
        const signerIds = suggestions
          .filter(s => selected.has(s.id ?? s.email) && s.id)
          .map(s => s.id!)
        body = {
          signerIds,
          cc: ccClean.length ? ccClean : undefined,
          bcc: bccClean.length ? bccClean : undefined,
          subject: trimmedSubject || undefined,
          message: message.trim() || undefined,
        }
      } else {
        const to = [
          ...suggestions
            .filter(s => selected.has(s.id ?? s.email))
            .map(s => ({ name: s.name, email: s.email })),
          ...adhoc.filter(a => a.email.trim()),
        ]
        body = {
          to,
          cc: ccClean.length ? ccClean : undefined,
          bcc: bccClean.length ? bccClean : undefined,
          subject: trimmedSubject || undefined,
          message: message.trim() || undefined,
        }
      }
      const res = await fetch(apiPath(postUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as {
        sent?: unknown[] | string[]
        failed?: Array<{ error: string; email?: string; signerId?: string }>
        error?: string
      }
      if (!res.ok) {
        setResult({
          sent: 0,
          failed: 1,
          errors: [data.error ?? 'Failed to send'],
        })
        return
      }
      const sentCount = Array.isArray(data.sent) ? data.sent.length : 0
      const failedList = Array.isArray(data.failed) ? data.failed : []
      setResult({
        sent: sentCount,
        failed: failedList.length,
        errors: failedList.map(f => `${f.email ?? f.signerId ?? '(unknown)'}: ${f.error}`),
      })
      onSent?.({ sent: sentCount, failed: failedList.length })
    } catch (err) {
      setResult({
        sent: 0,
        failed: 1,
        errors: [err instanceof Error ? err.message : 'Network error'],
      })
    } finally {
      setSending(false)
    }
  }

  function reset() {
    setResult(null)
    setMessage('')
    setAdhoc([])
    setCc([])
    setBcc([])
    setShowCc(false)
    setShowBcc(false)
    setSubject(defaultSubject ?? '')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">Send {resourceLabel} via email</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{resourceTitle}</p>
          </div>
          <button onClick={reset} className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          // ── Result state ──────────────────────────────────────────
          <div className="px-6 pb-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: result.sent > 0 ? '#15803d' : '#dc2626' }}>
              {result.sent > 0
                ? <><CheckCircle2 className="w-4 h-4" />Sent {result.sent} email{result.sent === 1 ? '' : 's'}</>
                : <><AlertCircle className="w-4 h-4" />Could not send</>}
            </div>
            {result.failed > 0 && (
              <div className="rounded-lg p-3 bg-[var(--color-danger-bg)] border border-[var(--color-danger)]">
                <p className="text-xs font-semibold text-[var(--color-danger)] uppercase tracking-wide mb-1">{result.failed} failure{result.failed === 1 ? '' : 's'}</p>
                <ul className="text-sm text-[var(--color-text)] space-y-0.5">
                  {result.errors.map((e, i) => <li key={i} className="font-mono text-xs">{e}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <TahiButton onClick={reset}>Done</TahiButton>
            </div>
          </div>
        ) : (
          // ── Compose state ─────────────────────────────────────────
          <div className="px-6 pb-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide mb-2">
                Recipients{totalSelected > 0 ? ` · ${totalSelected} selected` : ''}
              </label>
              <div className="space-y-1.5">
                {suggestions.length === 0 && adhoc.length === 0 && (
                  <p className="text-sm text-[var(--color-text-muted)]">No recipients suggested. Add one below.</p>
                )}
                {suggestions.map((s) => {
                  const key = s.id ?? s.email
                  const isOn = selected.has(key)
                  return (
                    <label key={key} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors" style={{
                      background: isOn ? 'var(--color-brand-50)' : 'var(--color-bg)',
                      borderColor: isOn ? 'var(--color-brand)' : 'var(--color-border)',
                    }}>
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggle(key)}
                        className="w-4 h-4 flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--color-text)] truncate">
                          {s.name}
                          {s.badge && <span className="ml-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">{s.badge}</span>}
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)] truncate">{s.email}</div>
                      </div>
                    </label>
                  )
                })}
                {adhoc.map((a, i) => (
                  <div key={`adhoc-${i}`} className="grid grid-cols-[1fr_1fr_2rem] gap-1.5">
                    <input
                      placeholder="Name"
                      value={a.name}
                      onChange={e => setAdhoc(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      className={inputCn}
                    />
                    <input
                      type="email"
                      placeholder="email@example.com"
                      value={a.email}
                      onChange={e => setAdhoc(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))}
                      className={inputCn}
                    />
                    <button
                      onClick={() => setAdhoc(prev => prev.filter((_, j) => j !== i))}
                      className="rounded-lg border border-[var(--color-border)] hover:bg-red-50 hover:text-red-500 text-[var(--color-text-muted)] flex items-center justify-center"
                      aria-label="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {mode === 'recipients' && (
                  <div className="flex flex-wrap items-center gap-3 mt-1">
                    <button
                      onClick={() => setAdhoc(prev => [...prev, { name: '', email: '' }])}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-brand-dark)]"
                    >
                      <Plus className="w-3.5 h-3.5" />Add recipient
                    </button>
                    {!showCc && (
                      <button
                        onClick={() => { setShowCc(true); setCc(prev => prev.length ? prev : [{ name: '', email: '' }]) }}
                        className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      >
                        + Cc
                      </button>
                    )}
                    {!showBcc && (
                      <button
                        onClick={() => { setShowBcc(true); setBcc(prev => prev.length ? prev : [{ name: '', email: '' }]) }}
                        className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      >
                        + Bcc
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {showCc && (
              <AdhocList
                label="Cc"
                items={cc}
                onChange={setCc}
                onHide={() => { setShowCc(false); setCc([]) }}
              />
            )}
            {showBcc && (
              <AdhocList
                label="Bcc"
                items={bcc}
                onChange={setBcc}
                onHide={() => { setShowBcc(false); setBcc([]) }}
              />
            )}

            <div>
              <label htmlFor="email-subject" className="block text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide mb-2">
                Subject
              </label>
              <input
                id="email-subject"
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className={inputCn}
                placeholder={defaultSubject ?? `${resourceLabel.charAt(0).toUpperCase() + resourceLabel.slice(1)} from Tahi Studio`}
              />
            </div>

            <div>
              <label htmlFor="email-message" className="block text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide mb-2">
                Optional note
              </label>
              <textarea
                id="email-message"
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                className={inputCn}
                placeholder={`Hi — here's the ${resourceLabel} we discussed. Let me know if anything needs tweaking.`}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <TahiButton variant="secondary" onClick={reset}>Cancel</TahiButton>
              <TahiButton onClick={submit} loading={sending} disabled={totalSelected === 0} iconLeft={<Mail className="w-3.5 h-3.5" />}>
                Send {totalSelected > 0 ? totalSelected : ''} email{totalSelected === 1 ? '' : 's'}
              </TahiButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AdhocList({
  label, items, onChange, onHide,
}: {
  label: string
  items: Array<{ name: string; email: string }>
  onChange: (next: Array<{ name: string; email: string }>) => void
  onHide: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide">
          {label}
        </label>
        <button
          onClick={onHide}
          className="text-[0.6875rem] font-medium text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
        >
          Remove
        </button>
      </div>
      <div className="space-y-1.5">
        {items.map((a, i) => (
          <div key={`${label}-${i}`} className="grid grid-cols-[1fr_1fr_2rem] gap-1.5">
            <input
              placeholder="Name"
              value={a.name}
              onChange={e => onChange(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
              className={inputCn}
            />
            <input
              type="email"
              placeholder="email@example.com"
              value={a.email}
              onChange={e => onChange(items.map((x, j) => j === i ? { ...x, email: e.target.value } : x))}
              className={inputCn}
            />
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="rounded-lg border border-[var(--color-border)] hover:bg-red-50 hover:text-red-500 text-[var(--color-text-muted)] flex items-center justify-center"
              aria-label="Remove"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange([...items, { name: '', email: '' }])}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-brand-dark)] mt-1"
        >
          <Plus className="w-3.5 h-3.5" />Add {label}
        </button>
      </div>
    </div>
  )
}
