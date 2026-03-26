'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  { value: 'small_task',     label: 'Small task' },
  { value: 'large_task',     label: 'Large task' },
  { value: 'bug_fix',        label: 'Bug fix' },
  { value: 'content_update', label: 'Content update' },
  { value: 'new_feature',    label: 'New feature' },
  { value: 'consultation',   label: 'Consultation' },
  { value: 'custom',         label: 'Custom' },
]

const CATEGORIES = [
  { value: 'development', label: 'Development' },
  { value: 'design',      label: 'Design' },
  { value: 'content',     label: 'Content' },
  { value: 'strategy',    label: 'Strategy' },
  { value: 'admin',       label: 'Admin' },
  { value: 'bug',         label: 'Bug' },
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
    fetch('/api/admin/clients?status=active')
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
      const url = isAdmin ? '/api/admin/requests' : '/api/portal/requests'
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
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isAdmin ? 'Create a request' : 'Submit a request'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isAdmin
                ? 'Create a request on behalf of a client.'
                : 'Tell us what you need and we\'ll get started.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-6">

            {/* Client selector (admin only) */}
            {isAdmin && (
              <Field label="Client" required>
                {clientsLoading ? (
                  <div className="flex items-center gap-2 h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" />
                    Loading clients…
                  </div>
                ) : (
                  <SelectInput
                    value={clientOrgId}
                    onChange={setClientOrgId}
                    required
                  >
                    <option value="" disabled>Select a client</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </SelectInput>
                )}
              </Field>
            )}

            {/* Title */}
            <Field label="Request title" required>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                maxLength={200}
                placeholder="e.g. Update homepage hero section"
                className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent transition"
              />
            </Field>

            {/* Type + Category row */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <SelectInput value={type} onChange={setType}>
                  {REQUEST_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Category">
                <SelectInput value={category} onChange={setCategory}>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </SelectInput>
              </Field>
            </div>

            {/* Priority (admin only) */}
            {isAdmin && (
              <Field label="Priority">
                <div className="flex gap-2">
                  {(['standard', 'high'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={cn(
                        'flex-1 h-9 rounded-lg border text-sm font-medium transition-colors',
                        priority === p
                          ? p === 'high'
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-[var(--color-brand)] bg-green-50 text-[var(--color-brand)]'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300',
                      )}
                    >
                      {p === 'high' ? '🔥 High' : 'Standard'}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {/* Description */}
            <Field label="Description">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe what you need in as much detail as possible…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent transition resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                You can add files and further details after submitting.
              </p>
            </Field>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                {error}
              </p>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-request-form"
            disabled={submitting || !title.trim()}
            onClick={handleSubmit}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors',
              'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {isAdmin ? 'Create request' : 'Submit request'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function Field({
  label, required, children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function SelectInput({
  value, onChange, required, children,
}: {
  value: string
  onChange: (v: string) => void
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="w-full h-10 pl-3 pr-8 border border-gray-200 rounded-lg text-sm appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent transition"
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  )
}
