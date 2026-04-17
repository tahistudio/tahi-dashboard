'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, FileText, RefreshCw, Download } from 'lucide-react'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { type DateRange } from '@/components/tahi/date-range-picker'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { formatCurrency } from '@/lib/currency'
import { PageHeader } from '@/components/tahi/page-header'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  orgId: string
  orgName: string | null
  status: string
  source: string | null
  stripeInvoiceId: string | null
  xeroInvoiceId: string | null
  totalAmount: number
  currency: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; text: string }> = {
  draft:        { label: 'Draft',    bg: 'var(--status-draft-bg)', text: 'var(--status-draft-text)' },
  sent:         { label: 'Sent',     bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
  viewed:       { label: 'Viewed',   bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
  overdue:      { label: 'Overdue',  bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
  paid:         { label: 'Paid',     bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
  written_off:  { label: 'Written Off', bg: 'var(--status-archived-bg)', text: 'var(--status-archived-text)' },
}

const SUPPORTED_CURRENCIES = ['NZD', 'USD', 'AUD', 'GBP', 'EUR'] as const

const FILTER_TABS = [
  { label: 'All',         value: 'all'         },
  { label: 'Draft',       value: 'draft'       },
  { label: 'Sent',        value: 'sent'        },
  { label: 'Overdue',     value: 'overdue'     },
  { label: 'Paid',        value: 'paid'        },
  { label: 'Written Off', value: 'written_off' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatInvoiceCurrency(amount: number, currency: string | null): string {
  return formatCurrency(amount, currency ?? 'NZD')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '--' }
}

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'paid' || status === 'written_off') return false
  return new Date(dueDate + 'T23:59:59') < new Date()
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status, dueDate }: { status: string; dueDate: string | null }) {
  const effectiveStatus = isOverdue(dueDate, status) && status === 'sent' ? 'overdue' : status
  const cfg = STATUS_CFG[effectiveStatus] ?? STATUS_CFG['draft']
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.125rem 0.5rem',
        borderRadius: 99,
        fontSize: '0.75rem',
        fontWeight: 500,
        background: cfg.bg,
        color: cfg.text,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.label}
    </span>
  )
}

// ─── Create Invoice Modal ─────────────────────────────────────────────────────

function CreateInvoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (invoiceId?: string) => void
}) {
  const { showToast } = useToast()
  const [orgId, setOrgId] = useState('')
  const [orgSearch, setOrgSearch] = useState('')
  const [orgOptions, setOrgOptions] = useState<{ id: string; name: string }[]>([])
  const [showOrgDropdown, setShowOrgDropdown] = useState(false)
  const [selectedOrgName, setSelectedOrgName] = useState('')
  const [destination, setDestination] = useState<'manual' | 'xero' | 'stripe'>('manual')
  const [lineItems, setLineItems] = useState([{ description: '', quantity: '1', unitAmount: '' }])
  // Track whether the selected org has at least one contact with an email
  // (Stripe rejects the customer create call without one)
  const [orgHasEmailContact, setOrgHasEmailContact] = useState<boolean | null>(null)

  // Fetch clients on mount
  useEffect(() => {
    fetch(apiPath('/api/admin/clients'))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const data = d as { organisations?: { id: string; name: string }[] }
        setOrgOptions(data.organisations ?? [])
      })
      .catch(() => setOrgOptions([]))
  }, [])

  // When the org changes, check if it has any contact with email.
  // Used to pre-empt the "Stripe rejects customer without email" failure.
  useEffect(() => {
    if (!orgId.trim()) {
      setOrgHasEmailContact(null)
      return
    }
    let cancelled = false
    fetch(apiPath(`/api/admin/clients/${orgId}/contacts`))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (cancelled) return
        const contacts = (d as { contacts?: Array<{ email?: string | null }> }).contacts ?? []
        setOrgHasEmailContact(contacts.some(c => !!c.email))
      })
      .catch(() => { if (!cancelled) setOrgHasEmailContact(null) })
    return () => { cancelled = true }
  }, [orgId])
  // quantity and unitAmount are now per-line-item in lineItems array
  const [currency, setCurrency] = useState('NZD')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = lineItems.filter(li => li.description.trim() && li.unitAmount)
    if (!orgId.trim() || validItems.length === 0) {
      setError('Client and at least one line item (description + amount) are required.')
      return
    }
    // Stripe needs a customer email. Block before we create the local
    // invoice so we don't end up with a draft + manual source ghost row.
    if (destination === 'stripe' && orgHasEmailContact === false) {
      setError(`${selectedOrgName || 'This client'} has no contact with an email. Add one on the client's Contacts tab before creating a Stripe link.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(apiPath('/api/admin/invoices'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: orgId.trim(),
          currency,
          source: destination,
          lineItems: validItems.map(li => ({
            description: li.description.trim(),
            quantity: parseFloat(li.quantity) || 1,
            unitAmount: parseFloat(li.unitAmount),
          })),
          dueDate: dueDate || undefined,
          notes: notes || undefined,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(json.error ?? 'Failed to create invoice.')
        return
      }
      const json = await res.json() as { id?: string }

      // Push to destination after local creation
      if (destination === 'xero' && json.id) {
        try {
          await fetch(apiPath('/api/admin/invoices/xero-sync'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceIds: [json.id] }),
          })
          showToast('Invoice created as Xero draft')
        } catch {
          showToast('Invoice created (Xero sync failed)')
        }
      } else if (destination === 'stripe' && json.id) {
        try {
          const stripeRes = await fetch(apiPath('/api/admin/invoices/stripe-create'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: json.id }),
          })
          if (stripeRes.ok) {
            const stripeData = await stripeRes.json() as { payUrl?: string }
            if (stripeData.payUrl) {
              await navigator.clipboard.writeText(stripeData.payUrl)
              showToast('Stripe invoice created — payment link copied to clipboard')
            } else {
              showToast('Stripe invoice created')
            }
          } else {
            // Surface the actual Stripe error inline so the user can fix it
            // (e.g. "Missing email" -> add a contact). The local invoice is
            // already saved as draft + source=stripe so it can be retried.
            const stripeJson = await stripeRes.json().catch(() => ({})) as { error?: string; message?: string }
            const detail = stripeJson.message || stripeJson.error || `HTTP ${stripeRes.status}`
            setError(`Invoice saved as draft, but Stripe link failed: ${detail}`)
            return
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'unknown error'
          setError(`Invoice saved as draft, but Stripe call failed: ${detail}`)
          return
        }
      } else {
        showToast('Invoice created successfully')
      }
      onCreated(json.id)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [orgId, lineItems, currency, dueDate, notes, destination, orgHasEmailContact, selectedOrgName, onCreated, showToast])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-invoice-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--color-bg)', borderRadius: '0.75rem', padding: '1.75rem',
          width: '100%', maxWidth: '30rem', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <h2 id="create-invoice-title" className="text-lg font-bold" style={{ color: 'var(--color-text)', marginBottom: '1.25rem' }}>
          Create Invoice
        </h2>
        {error && (
          <div
            aria-live="polite"
            style={{ background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', marginBottom: '1rem', color: 'var(--color-danger)', fontSize: '0.8125rem' }}
          >
            {error}
          </div>
        )}
        {/* Pre-flight warning: Stripe rejects customer creation without an email */}
        {destination === 'stripe' && orgId && orgHasEmailContact === false && (
          <div
            aria-live="polite"
            style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', marginBottom: '1rem', color: 'var(--color-warning)', fontSize: '0.8125rem' }}
          >
            <strong>{selectedOrgName}</strong> has no contact with an email. Stripe needs one to invoice them. Add a contact on the client&apos;s Contacts tab first.
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Destination toggle */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[
              { value: 'manual' as const, label: 'Dashboard Only', color: 'var(--color-brand)' },
              { value: 'xero' as const, label: 'Xero Draft', color: '#13b5ea' },
              { value: 'stripe' as const, label: 'Stripe Link', color: '#635bff' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDestination(opt.value)}
                className="rounded-full font-medium transition-colors"
                style={{
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.75rem',
                  background: destination === opt.value ? `${opt.color}15` : 'var(--color-bg-tertiary)',
                  color: destination === opt.value ? opt.color : 'var(--color-text-muted)',
                  border: `1px solid ${destination === opt.value ? `${opt.color}40` : 'var(--color-border)'}`,
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', position: 'relative' }}>
            <label htmlFor="ci-org-search" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
              Client
            </label>
            {selectedOrgName ? (
              <div className="flex items-center justify-between" style={{
                padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                border: '1px solid var(--color-brand)', background: 'var(--color-brand-50)',
                color: 'var(--color-brand)',
              }}>
                <span className="font-medium">{selectedOrgName}</span>
                <button
                  type="button"
                  onClick={() => { setOrgId(''); setSelectedOrgName(''); setOrgSearch('') }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-brand)', fontSize: '1rem' }}
                >
                  x
                </button>
              </div>
            ) : (
              <>
                <input
                  id="ci-org-search"
                  type="text"
                  placeholder="Search clients..."
                  value={orgSearch}
                  onChange={e => { setOrgSearch(e.target.value); setShowOrgDropdown(true) }}
                  onFocus={() => setShowOrgDropdown(true)}
                  style={{
                    padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                    border: '1px solid var(--color-border)', outline: 'none',
                    color: 'var(--color-text)', background: 'var(--color-bg)',
                  }}
                />
                {showOrgDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                    borderRadius: '0.5rem', maxHeight: '10rem', overflowY: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: '0.25rem',
                  }}>
                    {orgOptions
                      .filter(o => !orgSearch || o.name.toLowerCase().includes(orgSearch.toLowerCase()))
                      .map(o => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => { setOrgId(o.id); setSelectedOrgName(o.name); setShowOrgDropdown(false); setOrgSearch('') }}
                          className="w-full text-left transition-colors"
                          style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text)', background: 'none', border: 'none', cursor: 'pointer', display: 'block' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                        >
                          {o.name}
                        </button>
                      ))}
                    {orgOptions.filter(o => !orgSearch || o.name.toLowerCase().includes(orgSearch.toLowerCase())).length === 0 && (
                      <p style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>No clients found</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {/* Line Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>Line Items</span>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ padding: '0.25rem 0.5rem', borderRadius: '0.375rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              >
                {SUPPORTED_CURRENCIES.map(cur => (
                  <option key={cur} value={cur}>{cur}</option>
                ))}
              </select>
            </div>
            {lineItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <input
                  type="text"
                  placeholder="Description"
                  value={item.description}
                  onChange={e => {
                    const updated = [...lineItems]
                    updated[i] = { ...updated[i], description: e.target.value }
                    setLineItems(updated)
                  }}
                  style={{ flex: 3, padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                />
                <input
                  type="number"
                  placeholder="Qty"
                  min="0"
                  step="0.01"
                  value={item.quantity}
                  onChange={e => {
                    const updated = [...lineItems]
                    updated[i] = { ...updated[i], quantity: e.target.value }
                    setLineItems(updated)
                  }}
                  style={{ flex: 0.7, padding: '0.5rem', borderRadius: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)', minWidth: '3rem' }}
                />
                <input
                  type="number"
                  placeholder="Amount"
                  min="0"
                  step="0.01"
                  value={item.unitAmount}
                  onChange={e => {
                    const updated = [...lineItems]
                    updated[i] = { ...updated[i], unitAmount: e.target.value }
                    setLineItems(updated)
                  }}
                  style={{ flex: 1, padding: '0.5rem', borderRadius: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)', minWidth: '4rem' }}
                />
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLineItems(lineItems.filter((_, j) => j !== i))}
                    style={{ padding: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-subtle)', fontSize: '1rem' }}
                  >
                    x
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLineItems([...lineItems, { description: '', quantity: '1', unitAmount: '' }])}
              style={{ fontSize: '0.75rem', color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontWeight: 500 }}
            >
              + Add Line Item
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="ci-due-date" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
              Due Date
            </label>
            <input
              id="ci-due-date"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                border: '1px solid var(--color-border)', outline: 'none',
                color: 'var(--color-text)', background: 'var(--color-bg)',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="ci-notes" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
              Notes
            </label>
            <textarea
              id="ci-notes"
              rows={3}
              placeholder="Optional notes for the client..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                border: '1px solid var(--color-border)', outline: 'none',
                color: 'var(--color-text)', background: 'var(--color-bg)',
                resize: 'vertical',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 500,
                border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                color: 'var(--color-text)', cursor: 'pointer', minHeight: '2.75rem',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 600,
                border: 'none', background: saving ? 'var(--color-text-subtle)' : 'var(--color-brand)',
                color: 'white', cursor: saving ? 'not-allowed' : 'pointer', minHeight: '2.75rem',
              }}
            >
              {saving ? 'Creating...' : destination === 'xero' ? 'Create Xero Draft' : destination === 'stripe' ? 'Create + Get Payment Link' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface InvoiceListProps {
  isAdmin: boolean
}

export function InvoiceList({ isAdmin: isAdminProp }: InvoiceListProps) {
  const { isImpersonatingClient } = useImpersonation()
  const { showToast } = useToast()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeTab, setActiveTab] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })

  // Fetch all invoices once, filter client-side for accurate overdue detection
  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const url = isAdmin
        ? apiPath('/api/admin/invoices?status=all')
        : apiPath('/api/portal/invoices')
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as { items?: Invoice[] }
      setInvoices(json.items ?? [])
    } catch {
      setError(true)
      setInvoices([])
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  // Client-side filtering: status tab + source filter + date range
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // Compute effective status (overdue = sent + past due date)
      const effective = isOverdue(inv.dueDate, inv.status) && inv.status === 'sent' ? 'overdue' : inv.status

      // Status tab filter
      if (activeTab !== 'all' && effective !== activeTab) return false

      // Source filter
      if (sourceFilter !== 'all') {
        const invSource = inv.source ?? 'manual'
        if (invSource !== sourceFilter) return false
      }

      // Date range filter
      if (dateRange.from && dateRange.to) {
        const d = new Date(inv.dueDate ?? inv.createdAt).getTime()
        if (d < dateRange.from.getTime() || d > dateRange.to.getTime()) return false
      }

      return true
    })
  }, [invoices, activeTab, sourceFilter, dateRange])

  useEffect(() => {
    fetchInvoices().catch(() => {})
  }, [fetchInvoices])

  const handleCreated = useCallback((invoiceId?: string) => {
    setShowCreateModal(false)
    if (invoiceId) {
      router.push(`/invoices/${invoiceId}`)
    } else {
      fetchInvoices().catch(() => {})
    }
  }, [fetchInvoices, router])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Invoices"
        subtitle={isAdmin ? 'All invoices across every client.' : 'Your invoice history and outstanding payments.'}
      >
        {isAdmin && (
          <>
            <button
              onClick={() => {
                const link = document.createElement('a')
                link.href = apiPath('/api/admin/export/invoices')
                link.download = 'invoices.csv'
                link.click()
              }}
              className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                padding: '0.625rem 1.125rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                color: 'var(--color-text)',
                minHeight: 44,
              }}
            >
              <Download style={{ width: 16, height: 16 }} aria-hidden="true" />
              Export CSV
            </button>
            <button
              onClick={async () => {
                if (importing) return
                setImporting(true)
                try {
                  const res = await fetch(apiPath('/api/admin/integrations/stripe/import-invoices'), { method: 'POST' })
                  const json = await res.json() as { imported?: number; updated?: number; skipped?: number; error?: string; message?: string }
                  if (res.ok) {
                    showToast(`Stripe: ${json.imported ?? 0} imported, ${json.updated ?? 0} updated, ${json.skipped ?? 0} skipped`)
                    handleCreated()
                  } else {
                    showToast(json.message ?? json.error ?? 'Import failed')
                  }
                } catch {
                  showToast('Import failed — check connection')
                } finally {
                  setImporting(false)
                }
              }}
              disabled={importing}
              className="flex items-center gap-2 text-sm font-medium transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              style={{
                padding: '0.625rem 1.125rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0 10px 0 10px',
                cursor: importing ? 'wait' : 'pointer',
                color: 'var(--color-text)',
                minHeight: 44,
              }}
              title="Pull new invoices from Stripe into the dashboard"
            >
              <RefreshCw style={{ width: 16, height: 16, opacity: 0.7 }} aria-hidden="true" />
              {importing ? 'Importing...' : 'Import from Stripe'}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                padding: '0.625rem 1.125rem',
                background: 'var(--color-brand)',
                border: 'none',
                borderRadius: '0 10px 0 10px',
                cursor: 'pointer',
                color: 'white',
                minHeight: 44,
              }}
            >
              <Plus style={{ width: 16, height: 16 }} aria-hidden="true" />
              Create Invoice
            </button>
          </>
        )}
      </PageHeader>

      {/* Filter Tabs */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--color-border)', paddingBottom: 0 }}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.8125rem',
                fontWeight: activeTab === tab.value ? 600 : 400,
                color: activeTab === tab.value ? 'var(--color-brand)' : 'var(--color-text-muted)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.value ? '2px solid var(--color-brand)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
                minHeight: 44,
                transition: 'color 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Source filter chips */}
      {isAdmin && (
        <div className="flex items-center gap-2" style={{ marginTop: '0.5rem' }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Source:</span>
          {[
            { value: 'all', label: 'All', color: 'var(--color-text-muted)' },
            { value: 'manual', label: 'Manual', color: 'var(--color-text-muted)' },
            { value: 'xero', label: 'Xero', color: '#13b5ea' },
            { value: 'stripe', label: 'Stripe', color: '#635bff' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setSourceFilter(opt.value)}
              className="rounded-full font-medium transition-colors"
              style={{
                padding: '0.1875rem 0.5rem',
                fontSize: '0.6875rem',
                background: sourceFilter === opt.value ? `${opt.color}15` : 'transparent',
                color: sourceFilter === opt.value ? opt.color : 'var(--color-text-subtle)',
                border: `1px solid ${sourceFilter === opt.value ? `${opt.color}40` : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Date filter */}
      <div className="flex items-center gap-2" style={{ marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Due date:</span>
        <input
          type="date"
          value={dateRange.from ? dateRange.from.toISOString().split('T')[0] : ''}
          onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value ? new Date(e.target.value) : null }))}
          className="rounded-md"
          style={{ padding: '0.375rem 0.5rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
        />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>to</span>
        <input
          type="date"
          value={dateRange.to ? dateRange.to.toISOString().split('T')[0] : ''}
          onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value ? new Date(e.target.value) : null }))}
          className="rounded-md"
          style={{ padding: '0.375rem 0.5rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
        />
        {(dateRange.from || dateRange.to) && (
          <button
            onClick={() => setDateRange({ from: null, to: null })}
            style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <LoadingSkeleton rows={5} height={56} />
        ) : error ? (
          <div
            style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}
          >
            <p className="text-sm">Failed to load invoices.</p>
            <button
              onClick={() => fetchInvoices().catch(() => {})}
              className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <EmptyState
            icon={<FileText style={{ width: 28, height: 28, color: 'white' }} aria-hidden="true" />}
            title={isAdmin ? 'No invoices yet' : 'No invoices'}
            description={isAdmin ? 'Create your first invoice to get started.' : 'Invoices from Tahi Studio will appear here.'}
            ctaLabel={isAdmin ? 'Create Invoice' : undefined}
            onCtaClick={isAdmin ? () => setShowCreateModal(true) : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  {isAdmin && (
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Client
                    </th>
                  )}
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Amount
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Status
                  </th>
                  {isAdmin && (
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Source
                    </th>
                  )}
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Due Date
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Created
                  </th>
                  <th style={{ padding: '0.75rem 1rem', width: '5rem' }} />
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv, i) => (
                  <tr
                    key={inv.id}
                    style={{
                      borderBottom: i < invoices.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--color-bg-secondary)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                  >
                    {isAdmin && (
                      <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', fontWeight: 500 }}>
                        {inv.orgId ? (
                          <Link
                            href={`/clients/${inv.orgId}`}
                            style={{ color: 'var(--color-brand)', textDecoration: 'none' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none' }}
                          >
                            {inv.orgName ?? 'Unknown'}
                          </Link>
                        ) : (
                          <span style={{ color: 'var(--color-text)' }}>{inv.orgName ?? 'Unknown'}</span>
                        )}
                      </td>
                    )}
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
                      {formatInvoiceCurrency(inv.totalAmount, inv.currency)}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <StatusBadge status={inv.status} dueDate={inv.dueDate} />
                    </td>
                    {isAdmin && (
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <span
                          className="inline-flex items-center rounded-full font-medium"
                          style={{
                            padding: '0.125rem 0.5rem',
                            fontSize: '0.6875rem',
                            background: inv.source === 'xero' ? '#13b5ea15' : inv.source === 'stripe' ? '#635bff15' : 'var(--color-bg-tertiary)',
                            color: inv.source === 'xero' ? '#13b5ea' : inv.source === 'stripe' ? '#635bff' : 'var(--color-text-subtle)',
                          }}
                        >
                          {inv.source === 'xero' ? 'Xero' : inv.source === 'stripe' ? 'Stripe' : 'Manual'}
                        </span>
                      </td>
                    )}
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: isOverdue(inv.dueDate, inv.status) ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                      {formatDate(inv.dueDate)}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      {formatDate(inv.createdAt)}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                      <Link
                        href={`/invoices/${inv.id}`}
                        style={{
                          fontSize: '0.8125rem',
                          fontWeight: 500,
                          color: 'var(--color-brand)',
                          textDecoration: 'none',
                        }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <CreateInvoiceModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
