'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, FileText, RefreshCw, Download } from 'lucide-react'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { FilterBar, type DateRange } from '@/components/tahi/date-range-picker'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { formatCurrency } from '@/lib/currency'

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
  { label: 'All',     value: 'all'     },
  { label: 'Draft',   value: 'draft'   },
  { label: 'Sent',    value: 'sent'    },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Paid',    value: 'paid'    },
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
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitAmount, setUnitAmount] = useState('')
  const [currency, setCurrency] = useState('NZD')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId.trim() || !description.trim() || !unitAmount) {
      setError('Client ID, description, and amount are required.')
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
          lineItems: [{ description: description.trim(), quantity: parseFloat(quantity) || 1, unitAmount: parseFloat(unitAmount) }],
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
      showToast('Invoice created successfully')
      onCreated(json.id)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [orgId, description, quantity, unitAmount, currency, dueDate, notes, onCreated, showToast])

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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="ci-org-id" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
              Client ID
            </label>
            <input
              id="ci-org-id"
              type="text"
              placeholder="Client organisation ID"
              value={orgId}
              onChange={e => setOrgId(e.target.value)}
              required
              style={{
                padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                border: '1px solid var(--color-border)', outline: 'none',
                color: 'var(--color-text)', background: 'var(--color-bg)',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="ci-description" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
              Description
            </label>
            <input
              id="ci-description"
              type="text"
              placeholder="e.g. Monthly retainer - March 2026"
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              style={{
                padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                border: '1px solid var(--color-border)', outline: 'none',
                color: 'var(--color-text)', background: 'var(--color-bg)',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: '1 1 5rem', minWidth: '5rem' }}>
              <label htmlFor="ci-quantity" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
                Quantity
              </label>
              <input
                id="ci-quantity"
                type="number"
                min="0"
                step="0.01"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                  border: '1px solid var(--color-border)', outline: 'none',
                  color: 'var(--color-text)', background: 'var(--color-bg)',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: '2 1 8rem', minWidth: '8rem' }}>
              <label htmlFor="ci-amount" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
                Unit Amount
              </label>
              <input
                id="ci-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={unitAmount}
                onChange={e => setUnitAmount(e.target.value)}
                required
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                  border: '1px solid var(--color-border)', outline: 'none',
                  color: 'var(--color-text)', background: 'var(--color-bg)',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: '1 1 5rem', minWidth: '5rem' }}>
              <label htmlFor="ci-currency" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
                Currency
              </label>
              <select
                id="ci-currency"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem',
                  border: '1px solid var(--color-border)', outline: 'none',
                  color: 'var(--color-text)', background: 'var(--color-bg)',
                  minHeight: '2.375rem',
                }}
              >
                {SUPPORTED_CURRENCIES.map(cur => (
                  <option key={cur} value={cur}>{cur}</option>
                ))}
              </select>
            </div>
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
              {saving ? 'Creating...' : 'Create Invoice'}
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
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeTab, setActiveTab] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })

  // Client-side date filter
  const filteredInvoices = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return invoices
    return invoices.filter(inv => {
      const d = new Date(inv.dueDate ?? inv.createdAt).getTime()
      return d >= dateRange.from!.getTime() && d <= dateRange.to!.getTime()
    })
  }, [invoices, dateRange])

  const fetchInvoices = useCallback(async (status: string) => {
    setLoading(true)
    setError(false)
    try {
      const url = isAdmin
        ? apiPath(`/api/admin/invoices?status=${status}`)
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

  useEffect(() => {
    fetchInvoices(activeTab).catch(() => {})
  }, [activeTab, fetchInvoices])

  const handleCreated = useCallback((invoiceId?: string) => {
    setShowCreateModal(false)
    if (invoiceId) {
      router.push(`/invoices/${invoiceId}`)
    } else {
      fetchInvoices(activeTab).catch(() => {})
    }
  }, [activeTab, fetchInvoices, router])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)', margin: 0 }}>Invoices</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            {isAdmin ? 'All invoices across every client.' : 'Your invoice history and outstanding payments.'}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(apiPath('/api/admin/integrations/xero/import-invoices'), { method: 'POST' })
                  if (res.ok) {
                    const d = await res.json() as { imported: number; skipped: number }
                    alert(`Imported ${d.imported} invoices (${d.skipped} already existed)`)
                    fetchInvoices(activeTab)
                  } else {
                    alert('Xero import failed. Check Xero connection in Settings.')
                  }
                } catch { alert('Xero import failed') }
              }}
              className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80"
              style={{
                padding: '0.625rem 1.125rem',
                background: '#13b5ea15',
                border: '1px solid #13b5ea40',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                color: '#13b5ea',
                minHeight: 44,
              }}
            >
              Import Xero
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(apiPath('/api/admin/integrations/xero/sync-payments'), { method: 'POST' })
                  if (res.ok) {
                    const d = await res.json() as { updated: number }
                    alert(`Synced payment status for ${d.updated} invoices`)
                    fetchInvoices(activeTab)
                  }
                } catch { alert('Sync failed') }
              }}
              className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-80"
              style={{
                padding: '0.625rem 1.125rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                minHeight: 44,
              }}
            >
              Sync Payments
            </button>
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
          </div>
        )}
      </div>

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

      {/* Date filter */}
      <FilterBar
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        dateLabel="Due date"
      />

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
              onClick={() => fetchInvoices(activeTab).catch(() => {})}
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
                      <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)' }}>
                        {inv.orgName ?? 'Unknown'}
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
