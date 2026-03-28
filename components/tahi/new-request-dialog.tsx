'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { X, Loader2, Zap, CheckCircle2, Lock, Layers, AlignLeft } from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────────────────────

const BRAND     = 'var(--color-brand)'
const BRAND_HEX = '#5A824E'   // keep one hex only for box-shadow alpha

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
  open, onClose, isAdmin, canUseLargeTrack = true,
}: NewRequestDialogProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createAnother, setCreateAnother] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Admin: client picker
  const [clients, setClients] = useState<OrgOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientOrgId, setClientOrgId] = useState('')

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
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')

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

  // Reset on open
  useEffect(() => {
    if (open) {
      setTitle('')
      setType('small_task')
      setCategory('development')
      setDescription('')
      setPriority('standard')
      setStartDate('')
      setDueDate('')
      setEstimatedHours('')
      setClientOrgId('')
      setError(null)
      setSuccessMessage(null)
      setCreateAnother(false)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent, saveAndCreateAnother = false) {
    e.preventDefault()
    if (!title.trim()) return
    if (isAdmin && !clientOrgId) {
      setError('Please select a client.')
      return
    }
    setError(null)
    setSuccessMessage(null)
    setSubmitting(true)

    try {
      const url = isAdmin ? apiPath('/api/admin/requests') : apiPath('/api/portal/requests')
      const reqBody = isAdmin
        ? {
            clientOrgId, title: title.trim(), type, category, description, priority,
            startDate: startDate || null,
            dueDate: dueDate || null,
            estimatedHours: estimatedHours ? Number(estimatedHours) : null,
          }
        : { title: title.trim(), type, category, description }

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
          zIndex: 40,
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
          zIndex: 50,
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

            {/* Client selector (admin only) */}
            {isAdmin && (
              <FieldGroup label="Client" required htmlFor="req-client">
                {clientsLoading ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    height: '2.625rem', padding: '0 0.75rem',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-input)',
                    fontSize: '0.8125rem', color: 'var(--color-text-subtle)',
                  }}>
                    <Loader2 size={13} className="animate-spin" />
                    Loading clients…
                  </div>
                ) : (
                  <StyledSelect id="req-client" value={clientOrgId} onChange={setClientOrgId} required>
                    <option value="" disabled>Select a client…</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </StyledSelect>
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

            {/* Type tiles: only visible for retainer plans (maintain/scale) */}
            {showTrackSelector && (
            <FieldGroup label="Task size">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                {REQUEST_TYPES.map(t => {
                  const locked = !isAdmin && t.requiresScale && !canUseLargeTrack
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

            {/* Success message */}
            <div aria-live="polite">
              {successMessage && (
                <div style={{
                  fontSize: '0.8125rem',
                  color: 'var(--color-success, #16a34a)',
                  background: 'var(--color-success-bg, #f0fdf4)',
                  border: '1px solid var(--color-success, #4ade80)',
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
