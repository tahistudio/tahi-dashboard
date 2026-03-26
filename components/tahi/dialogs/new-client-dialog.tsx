'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Building2, Globe, User, Mail, Briefcase } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'

interface NewClientDialogProps {
  open: boolean
  onClose: () => void
}

const PLAN_OPTIONS = [
  { value: '', label: 'No plan yet' },
  { value: 'maintain', label: 'Maintain — $1,500/mo' },
  { value: 'scale',    label: 'Scale — $4,000/mo' },
  { value: 'tune',     label: 'Tune — $750 one-off' },
  { value: 'launch',   label: 'Launch — $2,500 one-off' },
  { value: 'hourly',   label: 'Hourly' },
  { value: 'custom',   label: 'Custom project' },
]

const INDUSTRY_OPTIONS = [
  '', 'Technology', 'E-commerce', 'Healthcare', 'Finance', 'Education',
  'Hospitality', 'Real estate', 'Professional services', 'Non-profit', 'Other',
]

export function NewClientDialog({ open, onClose }: NewClientDialogProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    website: '',
    industry: '',
    planType: '',
    primaryContactName: '',
    primaryContactEmail: '',
  })

  function set(field: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Client name is required'); return }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to create client')
      }
      router.refresh()
      onClose()
      setForm({ name: '', website: '', industry: '', planType: '', primaryContactName: '', primaryContactEmail: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="relative w-full max-w-lg bg-[var(--color-bg)] shadow-2xl overflow-hidden"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 brand-gradient flex items-center justify-center flex-shrink-0"
              style={{ borderRadius: 'var(--radius-leaf-sm)' }}
            >
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">Add new client</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Creates their portal and sends an invite email</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              Client / company name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)]" />
              <input
                type="text"
                placeholder="Acme Corp"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors placeholder:text-[var(--color-text-subtle)]"
                required
              />
            </div>
          </div>

          {/* Website + Industry side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Website</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)]" />
                <input
                  type="url"
                  placeholder="https://..."
                  value={form.website}
                  onChange={e => set('website', e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors placeholder:text-[var(--color-text-subtle)]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Industry</label>
              <select
                value={form.industry}
                onChange={e => set('industry', e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors text-[var(--color-text)]"
              >
                {INDUSTRY_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt || '— Select —'}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Plan */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Plan</label>
            <div className="relative">
              <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)]" />
              <select
                value={form.planType}
                onChange={e => set('planType', e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors text-[var(--color-text)]"
              >
                {PLAN_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--color-border)] pt-4">
            <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-3">
              Primary contact (optional — invite sent on save)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)]" />
                  <input
                    type="text"
                    placeholder="Full name"
                    value={form.primaryContactName}
                    onChange={e => set('primaryContactName', e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors placeholder:text-[var(--color-text-subtle)]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)]" />
                  <input
                    type="email"
                    placeholder="email@company.com"
                    value={form.primaryContactEmail}
                    onChange={e => set('primaryContactEmail', e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-brand)] transition-colors placeholder:text-[var(--color-text-subtle)]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose} disabled={loading}>
              Cancel
            </TahiButton>
            <TahiButton variant="primary" type="submit" loading={loading}>
              Add client
            </TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}
