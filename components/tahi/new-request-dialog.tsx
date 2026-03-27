'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { X, Loader2, ChevronDown, Zap, CheckCircle2 } from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────────────────────

const BRAND     = '#5A824E'
const BRAND_DRK = '#425F39'

// ── Types ──────────────────────────────────────────────────────────────────────

interface OrgOption {
  id: string
  name: string
}

interface NewRequestDialogProps {
  open: boolean
  onClose: () => void
  isAdmin: boolean
}

const REQUEST_TYPES = [
  { value: 'small_task',     label: 'Small task',     desc: '≤ 1 day'       },
  { value: 'large_task',     label: 'Large task',     desc: 'Multi-day'     },
  { value: 'bug_fix',        label: 'Bug fix',        desc: 'Fix only'      },
  { value: 'content_update', label: 'Content update', desc: 'Copy / images' },
  { value: 'new_feature',    label: 'New feature',    desc: 'New section'   },
  { value: 'consultation',   label: 'Consultation',   desc: 'Strategy'      },
  { value: 'custom',         label: 'Custom',         desc: 'Free-form'     },
]

const CATEGORIES = [
  { value: 'development', label: 'Development' },
  { value: 'design',      label: 'Design'      },
  { value: 'content',     label: 'Content'     },
  { value: 'strategy',    label: 'Strategy'    },
  { value: 'admin',       label: 'Admin'       },
  { value: 'bug',         label: 'Bug'         },
]

// ── Component ──────────────────────────────────────────────────────────────────

export function NewRequestDialog({ open, onClose, isAdmin }: NewRequestDialogProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Admin: client picker
  const [clients, setClients] = useState<OrgOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientOrgId, setClientOrgId] = useState('')

  // Form fields
  const [title, setTitle] = useState('')
  const [type, setType] = useState('small_task')
  const [category, setCategory] = useState('development')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('standard')

  // Load client list for admin
  useEffect(() => {
    if (!open || !isAdmin) return
    setClientsLoading(true)
    fetch(apiPath('/api/admin/clients?status=active'))
      .then(r => r.json() as Promise<{ organisations: OrgOption[] }>)
      .then(data => setClients(data.organisations ?? []))
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
      setClientOrgId('')
      setError(null)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    if (isAdmin && !clientOrgId) {
      setError('Please select a client.')
      return
    }
    setError(null)
    setSubmitting(true)

    try {
      const url = isAdmin ? apiPath('/api/admin/requests') : apiPath('/api/portal/requests')
      const body = isAdmin
        ? { clientOrgId, title: title.trim(), type, category, description, priority }
        : { title: title.trim(), type, category, description }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      const data = await res.json() as { id: string }
      onClose()
      router.push(`/requests/${data.id}`)
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
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '100%',
          maxWidth: 520,
          background: 'white',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.15)',
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
            padding: '20px 24px',
            borderBottom: '1px solid #f3f4f6',
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: 0 }}>
              {isAdmin ? 'Create a request' : 'Submit a request'}
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              {isAdmin
                ? 'Create a request on behalf of a client.'
                : "Tell us what you need and we'll get started."}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: 6,
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginLeft: 12,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.color = '#374151' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable form body */}
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: '24px' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Client selector (admin only) */}
            {isAdmin && (
              <FieldGroup label="Client" required>
                {clientsLoading ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    height: 42, padding: '0 12px',
                    border: '1px solid #e5e7eb', borderRadius: 8,
                    fontSize: 13, color: '#9ca3af',
                  }}>
                    <Loader2 size={13} className="animate-spin" />
                    Loading clients…
                  </div>
                ) : (
                  <StyledSelect
                    value={clientOrgId}
                    onChange={setClientOrgId}
                    required
                  >
                    <option value="" disabled>Select a client…</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </StyledSelect>
                )}
              </FieldGroup>
            )}

            {/* Title */}
            <FieldGroup label="Request title" required>
              <StyledInput
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                maxLength={200}
                placeholder="e.g. Update homepage hero section"
              />
            </FieldGroup>

            {/* Type tiles */}
            <FieldGroup label="Type">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {REQUEST_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    style={{
                      padding: '10px 8px',
                      borderRadius: 8,
                      border: type === t.value ? `2px solid ${BRAND}` : '1px solid #e5e7eb',
                      background: type === t.value ? '#f0f7ee' : 'white',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.1s',
                      position: 'relative',
                    }}
                    onMouseEnter={e => {
                      if (type !== t.value) {
                        e.currentTarget.style.borderColor = '#c6dbc0'
                        e.currentTarget.style.background = '#fafafa'
                      }
                    }}
                    onMouseLeave={e => {
                      if (type !== t.value) {
                        e.currentTarget.style.borderColor = '#e5e7eb'
                        e.currentTarget.style.background = 'white'
                      }
                    }}
                  >
                    {type === t.value && (
                      <CheckCircle2
                        size={13}
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          color: BRAND,
                        }}
                      />
                    )}
                    <p style={{ fontSize: 12, fontWeight: 600, color: type === t.value ? BRAND_DRK : '#374151', marginBottom: 1 }}>
                      {t.label}
                    </p>
                    <p style={{ fontSize: 11, color: '#9ca3af' }}>{t.desc}</p>
                  </button>
                ))}
              </div>
            </FieldGroup>

            {/* Category + Priority row */}
            <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: 16 }}>
              <FieldGroup label="Category">
                <StyledSelect value={category} onChange={setCategory}>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </StyledSelect>
              </FieldGroup>

              {isAdmin && (
                <FieldGroup label="Priority">
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['standard', 'high'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        style={{
                          flex: 1,
                          height: 42,
                          borderRadius: 8,
                          border: priority === p
                            ? p === 'high' ? '2px solid #f59e0b' : `2px solid ${BRAND}`
                            : '1px solid #e5e7eb',
                          background: priority === p
                            ? p === 'high' ? '#fffbeb' : '#f0f7ee'
                            : 'white',
                          color: priority === p
                            ? p === 'high' ? '#b45309' : BRAND_DRK
                            : '#6b7280',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
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

            {/* Description */}
            <FieldGroup label="Description">
              <StyledTextarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe what you need in as much detail as possible…"
              />
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                You can add files and further detail after submitting.
              </p>
            </FieldGroup>

            {/* Error */}
            {error && (
              <div style={{
                fontSize: 13,
                color: '#dc2626',
                background: '#fef2f2',
                border: '1px solid #fee2e2',
                borderRadius: 8,
                padding: '10px 14px',
              }}>
                {error}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderTop: '1px solid #f3f4f6',
            background: '#fafafa',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              color: '#6b7280',
              background: 'transparent',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#374151' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#6b7280' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-request-form"
            disabled={submitting || !title.trim()}
            onClick={handleSubmit}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: 'white',
              background: submitting || !title.trim() ? '#9cb89a' : BRAND,
              border: 'none',
              borderRadius: 8,
              cursor: submitting || !title.trim() ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => {
              if (!submitting && title.trim()) e.currentTarget.style.background = BRAND_DRK
            }}
            onMouseLeave={e => {
              if (!submitting && title.trim()) e.currentTarget.style.background = BRAND
            }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {isAdmin ? 'Create request' : 'Submit request'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Field group ────────────────────────────────────────────────────────────────

function FieldGroup({
  label, required, children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
        {label}
        {required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
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
        height: 42,
        padding: '0 12px',
        fontSize: 14,
        color: '#111827',
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        outline: 'none',
        boxSizing: 'border-box',
        ...props.style,
      }}
      onFocus={e => { e.currentTarget.style.borderColor = BRAND; e.currentTarget.style.boxShadow = `0 0 0 3px rgba(90,130,78,0.12)` }}
      onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none' }}
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
        padding: '10px 12px',
        fontSize: 14,
        color: '#111827',
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        outline: 'none',
        resize: 'none',
        boxSizing: 'border-box',
        lineHeight: 1.5,
        ...props.style,
      }}
      onFocus={e => { e.currentTarget.style.borderColor = BRAND; e.currentTarget.style.boxShadow = `0 0 0 3px rgba(90,130,78,0.12)` }}
      onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none' }}
    />
  )
}

// ── Styled select ──────────────────────────────────────────────────────────────

function StyledSelect({
  value, onChange, required, children,
}: {
  value: string
  onChange: (v: string) => void
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        style={{
          width: '100%',
          height: 42,
          paddingLeft: 12,
          paddingRight: 32,
          fontSize: 14,
          color: '#111827',
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          appearance: 'none',
          outline: 'none',
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = BRAND; e.currentTarget.style.boxShadow = `0 0 0 3px rgba(90,130,78,0.12)` }}
        onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none' }}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#9ca3af',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
