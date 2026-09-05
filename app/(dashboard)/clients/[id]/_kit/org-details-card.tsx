'use client'

/**
 * <OrgDetailsCard>. Organisation facts, editable in place: identity, status,
 * health, the IC.2 invoicing channel and payment terms, billing model, MRR,
 * retainer period, and the project manager. <AutoPill> marks whether a
 * billing number is auto-derived or manually pinned.
 */

import { useState } from 'react'
import useSWR from 'swr'
import { Check, Edit2, Globe, RefreshCw, X } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { Card } from '@/components/tahi/card'
import { HealthDot, StatusBadge } from '@/components/tahi/status-badge'
import { INVOICE_CHANNELS, invoiceChannelLabel } from '@/lib/invoice-channel'
import { PAYMENT_TERMS, paymentTermsLabel } from '@/lib/invoice-billing'
import { cn, formatDate } from '@/lib/utils'
import type { Organisation } from './types'

// ── Org details card (editable) ────────────────────────────────────────────────

export interface TeamMemberPm {
  id: string
  name: string
}

/**
 * AutoPill - tiny inline indicator next to a billing field that shows
 * whether the value is auto-derived from signals (green "Auto") or
 * manually set by the user (amber "Manual" + "use auto" link).
 *
 * Hidden entirely when `isManual` is undefined, which happens when the
 * GET response predates migration 0016 and the flag columns don't exist.
 */
export function AutoPill({
  isManual,
  onReenableAuto,
  reenabling,
}: {
  isManual: boolean | undefined
  onReenableAuto: () => void
  reenabling: boolean
}) {
  if (isManual === undefined) return null
  if (isManual) {
    return (
      <span className="inline-flex items-center gap-1.5 ml-2 align-middle">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}
        >
          Manual
        </span>
        <button
          type="button"
          onClick={onReenableAuto}
          disabled={reenabling}
          className="tahi-focus-ring inline-flex items-center min-h-[2.75rem] md:min-h-[1rem] text-[10px] underline hover:no-underline disabled:opacity-50"
          style={{ color: 'var(--color-text-muted)' }}
          title="Clear manual override and let the system auto-derive this field from current signals"
        >
          {reenabling ? 'Resetting...' : 'use auto'}
        </button>
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide align-middle"
      style={{ background: 'var(--color-brand-50)', color: 'var(--color-brand)' }}
      title="This field is auto-derived from current signals (Stripe subscription, MRR, billable hours, paid invoices, won deals)."
    >
      Auto
    </span>
  )
}

export function OrgDetailsCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const { displayCurrency, formatNativeWithDisplay } = useDisplayCurrency()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pmLoading, setPmLoading] = useState(false)
  const [autoDeriving, setAutoDeriving] = useState(false)
  const [reenablingField, setReenablingField] = useState<'billingModel' | 'retainerDates' | 'customMrr' | null>(null)

  /** Re-derive billing model + retainer dates from current signals. */
  const runAutoDerive = async () => {
    setAutoDeriving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}/auto-derive`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      onUpdated()
    } catch {
      // silent
    } finally {
      setAutoDeriving(false)
    }
  }

  /** Reset one field's manual override and immediately re-derive it. */
  const reenableAuto = async (field: 'billingModel' | 'retainerDates' | 'customMrr') => {
    setReenablingField(field)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}/auto-derive`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearOverrides: { [field]: true } }),
      })
      onUpdated()
    } catch {
      // silent
    } finally {
      setReenablingField(null)
    }
  }

  // Team members for the PM selector + the current PM assignment, both cached
  // via SWR. Errors stay silent (data falls back to empty/null), matching the
  // old .catch(() => {}) handlers.
  const { data: teamMembersData } = useSWR<{ items: TeamMemberPm[] }>('/api/admin/team-members')
  const teamMembers = teamMembersData?.items ?? []
  const { data: pmData, mutate: mutatePm } = useSWR<{ pmId: string | null; pmName: string | null }>(
    `/api/admin/clients/${org.id}/pm`,
  )
  const assignedPm = pmData?.pmId ?? null

  const handlePmChange = async (pmId: string | null) => {
    setPmLoading(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}/pm`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pmId }),
      })
      // Optimistically reflect the new PM in the SWR cache.
      await mutatePm({ pmId, pmName: pmData?.pmName ?? null }, { revalidate: false })
    } catch {
      // silent
    } finally {
      setPmLoading(false)
    }
  }

  const [form, setForm] = useState({
    name: org.name,
    website: org.website ?? '',
    industry: org.industry ?? '',
    status: org.status,
    healthStatus: org.healthStatus ?? 'green',
    healthNote: org.healthNote ?? '',
    billingModel: org.billingModel ?? 'none',
    customMrr: org.customMrr ? String(org.customMrr) : '',
    customMrrCurrency: org.customMrrCurrency ?? org.preferredCurrency ?? 'NZD',
    defaultHourlyRate: org.defaultHourlyRate ? String(org.defaultHourlyRate) : '',
    preferredCurrency: org.preferredCurrency ?? 'NZD',
    retainerStartDate: org.retainerStartDate ?? '',
    retainerEndDate: org.retainerEndDate ?? '',
    // '' is the "Studio default" / "Not set" option, which saves as NULL. Never
    // seed a real value over a NULL: an untouched field must not decide the
    // client's billing facts as a side effect of an unrelated edit.
    invoiceChannel: org.invoiceChannel ?? '',
    paymentTerms: org.paymentTerms ?? '',
  })

  const save = async () => {
    setSaving(true)
    try {
      // Build the patch with proper type coercion for numeric fields
      const patch: Record<string, unknown> = {
        ...form,
        customMrr: form.customMrr ? parseFloat(form.customMrr) : null,
        customMrrCurrency: form.customMrrCurrency || null,
        defaultHourlyRate: form.defaultHourlyRate ? parseFloat(form.defaultHourlyRate) : null,
        retainerStartDate: form.retainerStartDate || null,
        retainerEndDate: form.retainerEndDate || null,
        invoiceChannel: form.invoiceChannel || null,
        paymentTerms: form.paymentTerms || null,
      }
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const HEALTH_OPTIONS = [
    { value: 'green', label: 'Green (healthy)' },
    { value: 'amber', label: 'Amber (watch)' },
    { value: 'red',   label: 'Red (at risk)' },
  ]

  const STATUS_OPTIONS = ['prospect', 'active', 'paused', 'churned', 'archived']

  return (
    <Card>
      <Card.Header>
        <Card.Title>Organisation details</Card.Title>
        <Card.Action>
        {!editing ? (
          <div className="flex items-center gap-3">
            <button
              onClick={runAutoDerive}
              disabled={autoDeriving}
              title="Re-derive billing model + retainer dates from current signals (Stripe subscription, MRR, paid invoices, billable hours, won deals). Manual overrides are preserved."
              className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', autoDeriving && 'animate-spin')} />
              {autoDeriving ? 'Detecting...' : 'Auto-detect'}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Edit
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing(false); setForm({ name: org.name, website: org.website ?? '', industry: org.industry ?? '', status: org.status, healthStatus: org.healthStatus ?? 'green', healthNote: org.healthNote ?? '', billingModel: org.billingModel ?? 'none', customMrr: org.customMrr ? String(org.customMrr) : '', customMrrCurrency: org.customMrrCurrency ?? org.preferredCurrency ?? 'NZD', defaultHourlyRate: org.defaultHourlyRate ? String(org.defaultHourlyRate) : '', preferredCurrency: org.preferredCurrency ?? 'NZD', retainerStartDate: org.retainerStartDate ?? '', retainerEndDate: org.retainerEndDate ?? '', invoiceChannel: org.invoiceChannel ?? '', paymentTerms: org.paymentTerms ?? '' }) }}
              className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] flex items-center gap-1 text-sm text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] font-medium disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        </Card.Action>
      </Card.Header>

      {editing ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Website</label>
            <input
              value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
              placeholder="https://example.com"
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Industry</label>
            <input
              value={form.industry}
              onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
              placeholder="e.g. SaaS, eCommerce"
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Status</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Health</label>
            <select
              value={form.healthStatus}
              onChange={e => setForm(f => ({ ...f, healthStatus: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              {HEALTH_OPTIONS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Health note (internal)</label>
            <textarea
              value={form.healthNote}
              onChange={e => setForm(f => ({ ...f, healthNote: e.target.value }))}
              rows={2}
              placeholder="Brief note about client health..."
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] resize-none"
            />
          </div>

          {/* Billing section */}
          <div className="col-span-2 border-t border-[var(--color-border-subtle)] pt-3 mt-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Billing</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Billing model</label>
            <select
              value={form.billingModel}
              onChange={e => setForm(f => ({ ...f, billingModel: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              <option value="none">None</option>
              <option value="retainer">Retainer</option>
              <option value="hourly">Hourly</option>
              <option value="project">Project</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Currency</label>
            <select
              value={form.preferredCurrency}
              onChange={e => setForm(f => ({ ...f, preferredCurrency: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              {['NZD', 'USD', 'GBP', 'EUR', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Invoicing channel</label>
            <select
              value={form.invoiceChannel}
              onChange={e => setForm(f => ({ ...f, invoiceChannel: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              <option value="">Studio default</option>
              {INVOICE_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Payment terms</label>
            <select
              value={form.paymentTerms}
              onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              <option value="">Not set</option>
              {PAYMENT_TERMS.map(t => <option key={t} value={t}>{paymentTermsLabel(t)}</option>)}
            </select>
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Net terms also let an invoiced client finish onboarding without a card.
            </p>
          </div>
          {(form.billingModel === 'retainer' || form.billingModel === 'none') && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">MRR (what we actually bill them)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={form.customMrr}
                  onChange={e => setForm(f => ({ ...f, customMrr: e.target.value }))}
                  placeholder="e.g. 3125"
                  className="flex-1 min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                />
                <select
                  value={form.customMrrCurrency}
                  onChange={e => setForm(f => ({ ...f, customMrrCurrency: e.target.value }))}
                  className="w-20 min-h-[2.75rem] md:min-h-[2.25rem] px-2 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  title="Currency this client pays you in"
                >
                  {['NZD', 'USD', 'GBP', 'EUR', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <p className="text-[10px] text-[var(--color-text-subtle)] mt-1">Native currency. Converted to NZD in finance reports.</p>
            </div>
          )}
          {form.billingModel === 'hourly' && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Hourly rate ({form.preferredCurrency})</label>
              <input
                type="number"
                step="0.01"
                value={form.defaultHourlyRate}
                onChange={e => setForm(f => ({ ...f, defaultHourlyRate: e.target.value }))}
                placeholder="e.g. 50"
                className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Retainer start</label>
            <input
              type="date"
              value={form.retainerStartDate}
              onChange={e => setForm(f => ({ ...f, retainerStartDate: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Retainer end <span className="text-xs text-[var(--color-text-subtle)]">(churn date)</span>
            </label>
            <input
              type="date"
              value={form.retainerEndDate}
              onChange={e => setForm(f => ({ ...f, retainerEndDate: e.target.value }))}
              className="w-full min-h-[2.75rem] md:min-h-[2.25rem] px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
            {form.retainerEndDate && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-warning)' }}>
                Cash flow forecast will stop counting this MRR after this date.
              </p>
            )}
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Website</dt>
            <dd>
              {org.website ? (
                <a
                  href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[var(--color-brand)] hover:underline"
                  data-private
                >
                  <Globe className="w-3.5 h-3.5" />
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                <span className="text-[var(--color-text-muted)]">--</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Industry</dt>
            <dd className="text-[var(--color-text)]">{org.industry ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Status</dt>
            <dd><StatusBadge status={org.status} type="org" /></dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Health</dt>
            <dd className="flex items-center gap-1.5">
              <HealthDot health={org.healthStatus} />
              <span className="capitalize text-[var(--color-text)]">
                {org.healthStatus ?? 'Unknown'}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Client since</dt>
            <dd className="text-[var(--color-text)]">
              {new Date(org.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Last updated</dt>
            <dd className="text-[var(--color-text)]">
              {new Date(org.updatedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Billing model</dt>
            <dd className="text-[var(--color-text)] capitalize">
              {org.billingModel ?? 'none'}
              <AutoPill
                isManual={org.billingModelIsManual}
                onReenableAuto={() => reenableAuto('billingModel')}
                reenabling={reenablingField === 'billingModel'}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Invoicing</dt>
            <dd className="text-[var(--color-text)]">
              {invoiceChannelLabel(org.effectiveInvoiceChannel ?? org.invoiceChannel)}
              {!org.invoiceChannel && (
                <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">(studio default)</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Payment terms</dt>
            <dd className="text-[var(--color-text)]">
              {paymentTermsLabel(org.paymentTerms)}
              {!org.paymentTerms && (
                <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">(not set)</span>
              )}
            </dd>
          </div>
          {org.billingModel === 'retainer' || org.customMrr ? (
            <div>
              <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">MRR</dt>
              <dd className="text-[var(--color-text)] font-medium">
                {org.customMrr ? (
                  <>
                    <span data-private>{new Intl.NumberFormat('en-NZ', { style: 'currency', currency: org.customMrrCurrency ?? org.preferredCurrency ?? 'NZD', maximumFractionDigits: 0 }).format(org.customMrr)}</span>
                    {(org.customMrrCurrency ?? org.preferredCurrency ?? 'NZD') !== displayCurrency && (
                      <span data-private style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginLeft: '0.5rem', fontWeight: 400 }}>
                        {formatNativeWithDisplay(org.customMrr, org.customMrrCurrency ?? org.preferredCurrency ?? 'NZD').split('\u2248 ')[1] ?? ''}
                      </span>
                    )}
                  </>
                ) : '--'}
                <AutoPill
                  isManual={org.customMrrIsManual}
                  onReenableAuto={() => reenableAuto('customMrr')}
                  reenabling={reenablingField === 'customMrr'}
                />
              </dd>
            </div>
          ) : org.billingModel === 'hourly' ? (
            <div>
              <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Hourly rate</dt>
              <dd className="text-[var(--color-text)] font-medium">
                {org.defaultHourlyRate ? (
                  <>
                    <span>{`${org.preferredCurrency ?? 'NZD'} ${org.defaultHourlyRate}/hr`}</span>
                    {(org.preferredCurrency ?? 'NZD') !== displayCurrency && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginLeft: '0.5rem', fontWeight: 400 }}>
                        {`\u2248 ${formatNativeWithDisplay(org.defaultHourlyRate, org.preferredCurrency ?? 'NZD').split('\u2248 ')[1] ?? ''}/hr`}
                      </span>
                    )}
                  </>
                ) : '--'}
              </dd>
            </div>
          ) : null}
          {(org.retainerStartDate || org.retainerEndDate) && (
            <div>
              <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Retainer period</dt>
              <dd className="text-[var(--color-text)]">
                {org.retainerStartDate && <span>{formatDate(org.retainerStartDate)}</span>}
                {org.retainerStartDate && org.retainerEndDate && ' \u2192 '}
                {org.retainerEndDate && (
                  <span style={{ color: 'var(--color-warning)', fontWeight: 500 }}>{formatDate(org.retainerEndDate)}</span>
                )}
                <AutoPill
                  isManual={org.retainerDatesIsManual}
                  onReenableAuto={() => reenableAuto('retainerDates')}
                  reenabling={reenablingField === 'retainerDates'}
                />
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Project Manager</dt>
            <dd>
              <select
                value={assignedPm ?? ''}
                onChange={e => handlePmChange(e.target.value || null)}
                disabled={pmLoading}
                className="min-h-[2.75rem] md:min-h-[2rem] px-2 py-1 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="">No PM assigned</option>
                {teamMembers.map(tm => (
                  <option key={tm.id} value={tm.id}>{tm.name}</option>
                ))}
              </select>
            </dd>
          </div>
        </dl>
      )}
    </Card>
  )
}
