'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, FileText } from 'lucide-react'
import { apiPath } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  orgId: string
  orgName: string | null
  projectId: string | null
  subscriptionId: string | null
  stripeInvoiceId: string | null
  xeroInvoiceId: string | null
  status: string
  amountUsd: number
  taxAmountUsd: number | null
  discountAmountUsd: number | null
  totalUsd: number
  currency: string | null
  notes: string | null
  dueDate: string | null
  sentAt: string | null
  viewedAt: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

interface LineItem {
  id: string
  invoiceId: string
  description: string
  quantity: number | null
  unitPriceUsd: number
  totalUsd: number
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; text: string }> = {
  draft:        { label: 'Draft',       bg: '#f3f4f6', text: '#4b5563' },
  sent:         { label: 'Sent',        bg: '#eff6ff', text: '#1d4ed8' },
  viewed:       { label: 'Viewed',      bg: '#eff6ff', text: '#1d4ed8' },
  overdue:      { label: 'Overdue',     bg: '#fef2f2', text: '#dc2626' },
  paid:         { label: 'Paid',        bg: '#f0fdf4', text: '#16a34a' },
  written_off:  { label: 'Written Off', bg: '#f3f4f6', text: '#6b7280' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string | null): string {
  const cur = currency ?? 'NZD'
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 2,
  }).format(amount)
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

function effectiveStatus(invoice: InvoiceRow): string {
  if (isOverdue(invoice.dueDate, invoice.status) && invoice.status === 'sent') return 'overdue'
  return invoice.status
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface InvoiceDetailProps {
  invoiceId: string
  isAdmin: boolean
}

export function InvoiceDetail({ invoiceId, isAdmin }: InvoiceDetailProps) {
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null)
  const [items, setItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [patching, setPatching] = useState<string | null>(null)

  const fetchInvoice = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(apiPath(`/api/admin/invoices/${invoiceId}`))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as { invoice?: InvoiceRow; items?: LineItem[] }
      setInvoice(json.invoice ?? null)
      setItems(json.items ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    fetchInvoice().catch(() => {})
  }, [fetchInvoice])

  const patchStatus = useCallback(async (newStatus: string) => {
    if (!invoice) return
    setPatching(newStatus)
    try {
      const paidAt = newStatus === 'paid' ? new Date().toISOString() : undefined
      const sentAt = newStatus === 'sent' ? new Date().toISOString() : undefined
      const body: Record<string, unknown> = { status: newStatus }
      if (paidAt) body.paidAt = paidAt
      if (sentAt) body.sentAt = sentAt
      const res = await fetch(apiPath(`/api/admin/invoices/${invoiceId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed')
      await fetchInvoice()
    } catch {
      // silently revert
    } finally {
      setPatching(null)
    }
  }, [invoice, invoiceId, fetchInvoice])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ height: 32, width: 120, borderRadius: 8, background: '#f3f4f6' }} className="animate-pulse" />
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--color-border)', padding: 28 }}>
          <div style={{ height: 40, width: 200, borderRadius: 8, background: '#f3f4f6', marginBottom: 16 }} className="animate-pulse" />
          <div style={{ height: 20, width: 120, borderRadius: 8, background: '#f3f4f6' }} className="animate-pulse" />
        </div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
        <Link href="/invoices" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          <ArrowLeft style={{ width: 14, height: 14 }} aria-hidden="true" />
          Back to Invoices
        </Link>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--color-border)', padding: '48px 24px', textAlign: 'center', width: '100%' }}>
          <FileText style={{ width: 32, height: 32, color: '#9ca3af', margin: '0 auto 12px' }} aria-hidden="true" />
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            {error ? 'Failed to load invoice.' : 'Invoice not found.'}
          </p>
          {error && (
            <button
              onClick={() => fetchInvoice().catch(() => {})}
              className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity mx-auto"
              style={{ color: '#5A824E', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  const status = effectiveStatus(invoice)
  const statusCfg = STATUS_CFG[status] ?? STATUS_CFG['draft']

  const subtotal = items.reduce((s, it) => s + it.totalUsd, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Back link */}
      <Link
        href="/invoices"
        className="flex items-center gap-2 text-sm hover:opacity-70 transition-opacity"
        style={{ color: 'var(--color-text-muted)', textDecoration: 'none', width: 'fit-content' }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} aria-hidden="true" />
        Back to Invoices
      </Link>

      {/* Invoice header card */}
      <div
        style={{
          background: 'white',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
          padding: '28px 28px 24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              {invoice.orgName ?? 'Unknown Client'}
            </p>
            <p
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: 'var(--color-text)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
              }}
            >
              {formatCurrency(invoice.totalUsd, invoice.currency)}
            </p>
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 12px',
              borderRadius: 99,
              fontSize: 13,
              fontWeight: 600,
              background: statusCfg.bg,
              color: statusCfg.text,
            }}
          >
            {statusCfg.label}
          </span>
        </div>

        {/* Metadata grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '16px 24px',
            borderTop: '1px solid var(--color-border-subtle)',
            paddingTop: 20,
          }}
        >
          <MetaField label="Invoice ID" value={invoice.id.slice(0, 8).toUpperCase()} />
          <MetaField label="Created" value={formatDate(invoice.createdAt)} />
          <MetaField label="Due Date" value={formatDate(invoice.dueDate)} highlight={isOverdue(invoice.dueDate, invoice.status)} />
          {invoice.sentAt && <MetaField label="Sent" value={formatDate(invoice.sentAt)} />}
          {invoice.paidAt && <MetaField label="Paid" value={formatDate(invoice.paidAt)} />}
          {invoice.stripeInvoiceId && <MetaField label="Stripe ID" value={invoice.stripeInvoiceId} />}
        </div>

        {/* Admin actions */}
        {isAdmin && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              marginTop: 24,
              paddingTop: 20,
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            {invoice.status === 'draft' && (
              <ActionButton
                label={patching === 'sent' ? 'Sending...' : 'Send to Client'}
                disabled={patching !== null}
                onClick={() => patchStatus('sent')}
                variant="primary"
              />
            )}
            {(invoice.status === 'sent' || invoice.status === 'overdue') && (
              <ActionButton
                label={patching === 'paid' ? 'Marking...' : 'Mark as Paid'}
                disabled={patching !== null}
                onClick={() => patchStatus('paid')}
                variant="success"
              />
            )}
            {invoice.status !== 'draft' && invoice.status !== 'written_off' && invoice.status !== 'paid' && (
              <ActionButton
                label="Revert to Draft"
                disabled={patching !== null}
                onClick={() => patchStatus('draft')}
                variant="ghost"
              />
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            borderRadius: 8,
            border: '1px solid var(--color-border-subtle)',
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Notes
          </p>
          <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {invoice.notes}
          </p>
        </div>
      )}

      {/* Line items */}
      <div
        style={{
          background: 'white',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>Line Items</h2>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
            No line items on this invoice.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Description
                  </th>
                  <th style={{ padding: '10px 20px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 100 }}>
                    Qty
                  </th>
                  <th style={{ padding: '10px 20px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 120 }}>
                    Unit Price
                  </th>
                  <th style={{ padding: '10px 20px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 120 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                    <td style={{ padding: '14px 20px', fontSize: 14, color: 'var(--color-text)' }}>
                      {item.description}
                    </td>
                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: 14, color: 'var(--color-text-muted)' }}>
                      {item.quantity ?? 1}
                    </td>
                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: 14, color: 'var(--color-text-muted)' }}>
                      {formatCurrency(item.unitPriceUsd, invoice.currency)}
                    </td>
                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                      {formatCurrency(item.totalUsd, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals */}
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Subtotal</span>
            <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{formatCurrency(subtotal, invoice.currency)}</span>
          </div>
          {(invoice.taxAmountUsd ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Tax</span>
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{formatCurrency(invoice.taxAmountUsd ?? 0, invoice.currency)}</span>
            </div>
          )}
          {(invoice.discountAmountUsd ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Discount</span>
              <span style={{ fontSize: 13, color: '#dc2626' }}>-{formatCurrency(invoice.discountAmountUsd ?? 0, invoice.currency)}</span>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              width: 240,
              paddingTop: 8,
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Total</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{formatCurrency(invoice.totalUsd, invoice.currency)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function MetaField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </p>
      <p style={{ fontSize: 13, fontWeight: 500, color: highlight ? '#dc2626' : 'var(--color-text)' }}>
        {value}
      </p>
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  variant: 'primary' | 'success' | 'ghost'
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: '#5A824E', color: 'white', border: 'none' },
    success: { background: '#16a34a', color: 'white', border: 'none' },
    ghost:   { background: 'white', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 18px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'opacity 0.15s',
        minHeight: 44,
        ...styles[variant],
      }}
    >
      {label}
    </button>
  )
}
