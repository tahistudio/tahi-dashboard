'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, FileText } from 'lucide-react'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { apiPath } from '@/lib/api'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { formatCurrency } from '@/lib/currency'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  orgId: string
  orgName: string | null
  projectId: string | null
  subscriptionId: string | null
  stripeInvoiceId: string | null
  xeroInvoiceId: string | null
  source: string | null
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
  draft:        { label: 'Draft',       bg: 'var(--status-draft-bg)', text: 'var(--status-draft-text)' },
  sent:         { label: 'Sent',        bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
  viewed:       { label: 'Viewed',      bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
  overdue:      { label: 'Overdue',     bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
  paid:         { label: 'Paid',        bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
  written_off:  { label: 'Written Off', bg: 'var(--status-archived-bg)', text: 'var(--status-archived-text)' },
}

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

function effectiveStatus(invoice: InvoiceRow): string {
  if (isOverdue(invoice.dueDate, invoice.status) && invoice.status === 'sent') return 'overdue'
  return invoice.status
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface InvoiceDetailProps {
  invoiceId: string
  isAdmin: boolean
}

export function InvoiceDetail({ invoiceId, isAdmin: isAdminProp }: InvoiceDetailProps) {
  const { isImpersonatingClient } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ height: 32, width: 120, borderRadius: '0.5rem', background: 'var(--color-bg-tertiary)' }} className="animate-pulse" />
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.75rem' }}>
          <div style={{ height: 40, width: 200, borderRadius: '0.5rem', background: 'var(--color-bg-tertiary)', marginBottom: '1rem' }} className="animate-pulse" />
          <div style={{ height: 20, width: 120, borderRadius: '0.5rem', background: 'var(--color-bg-tertiary)' }} className="animate-pulse" />
        </div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        <Link href="/invoices" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          <ArrowLeft style={{ width: 14, height: 14 }} aria-hidden="true" />
          Back to Invoices
        </Link>
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '3rem 1.5rem', textAlign: 'center', width: '100%' }}>
          <FileText style={{ width: 32, height: 32, color: 'var(--color-text-subtle)', margin: '0 auto 0.75rem' }} aria-hidden="true" />
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>
            {error ? 'Failed to load invoice.' : 'Invoice not found.'}
          </p>
          {error && (
            <button
              onClick={() => fetchInvoice().catch(() => {})}
              className="flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity mx-auto"
              style={{ color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer' }}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Invoices', href: '/invoices' },
          { label: `INV-${invoiceId.slice(0, 6).toUpperCase()}` },
        ]}
      />

      {/* Invoice header card */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.75rem 1.75rem 1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
              {invoice.orgName ?? 'Unknown Client'}
            </p>
            <p
              style={{
                fontSize: '2.25rem',
                fontWeight: 700,
                color: 'var(--color-text)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
              }}
            >
              {formatInvoiceCurrency(invoice.totalUsd, invoice.currency)}
            </p>
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.25rem 0.75rem',
              borderRadius: 99,
              fontSize: '0.8125rem',
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
            gap: '1rem 1.5rem',
            borderTop: '1px solid var(--color-border-subtle)',
            paddingTop: '1.25rem',
          }}
        >
          <MetaField label="Invoice ID" value={invoice.id.slice(0, 8).toUpperCase()} />
          <MetaField label="Created" value={formatDate(invoice.createdAt)} />
          <MetaField label="Due Date" value={formatDate(invoice.dueDate)} highlight={isOverdue(invoice.dueDate, invoice.status)} />
          {invoice.sentAt && <MetaField label="Sent" value={formatDate(invoice.sentAt)} />}
          {invoice.paidAt && <MetaField label="Paid" value={formatDate(invoice.paidAt)} />}
          {invoice.stripeInvoiceId && <MetaField label="Stripe ID" value={invoice.stripeInvoiceId} />}
          {invoice.xeroInvoiceId && <MetaField label="Xero ID" value={invoice.xeroInvoiceId.slice(0, 8)} />}
          <MetaField
            label="Source"
            value={invoice.source === 'xero' ? 'Xero' : invoice.source === 'stripe' ? 'Stripe' : 'Manual'}
          />
        </div>

        {/* Admin actions */}
        {isAdmin && (
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
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
            {!invoice.xeroInvoiceId && invoice.status !== 'paid' && (
              <ActionButton
                label="Sync to Xero"
                disabled={patching !== null}
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath('/api/admin/invoices/xero-sync'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ invoiceIds: [invoice.id] }),
                    })
                    if (res.ok) {
                      fetchInvoice()
                    } else {
                      const err = await res.json() as { error?: string }
                      alert(err.error ?? 'Xero sync failed. Reconnect Xero in Settings.')
                    }
                  } catch { alert('Xero sync failed. Check connection in Settings.') }
                }}
                variant="ghost"
              />
            )}
            {invoice.status !== 'paid' && invoice.status !== 'draft' && (
              <ActionButton
                label="Get Stripe Payment Link"
                disabled={patching !== null}
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath(`/api/admin/integrations/stripe/provision?invoiceId=${invoice.id}`))
                    if (res.ok) {
                      const data = await res.json() as { payUrl?: string; error?: string }
                      if (data.payUrl) {
                        await navigator.clipboard.writeText(data.payUrl)
                        alert('Payment link copied to clipboard!')
                      } else {
                        alert(data.error ?? 'Could not generate payment link')
                      }
                    } else {
                      alert('Stripe not configured. Add STRIPE_SECRET_KEY in Settings.')
                    }
                  } catch { alert('Failed to get payment link') }
                }}
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
            borderRadius: '0.5rem',
            border: '1px solid var(--color-border-subtle)',
            padding: '0.875rem 1rem',
          }}
        >
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Notes
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {invoice.notes}
          </p>
        </div>
      )}

      {/* Line items */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>Line Items</h2>
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
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Description
                  </th>
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 100 }}>
                    Qty
                  </th>
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 120 }}>
                    Unit Price
                  </th>
                  <th style={{ padding: '0.625rem 1.25rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 120 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                    <td style={{ padding: '0.875rem 1.25rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {item.description}
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      {item.quantity ?? 1}
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      {formatInvoiceCurrency(item.unitPriceUsd, invoice.currency)}
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
                      {formatInvoiceCurrency(item.totalUsd, invoice.currency)}
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
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Subtotal</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{formatInvoiceCurrency(subtotal, invoice.currency)}</span>
          </div>
          {(invoice.taxAmountUsd ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Tax</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{formatInvoiceCurrency(invoice.taxAmountUsd ?? 0, invoice.currency)}</span>
            </div>
          )}
          {(invoice.discountAmountUsd ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Discount</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>-{formatInvoiceCurrency(invoice.discountAmountUsd ?? 0, invoice.currency)}</span>
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
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>Total</span>
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>{formatInvoiceCurrency(invoice.totalUsd, invoice.currency)}</span>
          </div>
        </div>
      </div>

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function MetaField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.125rem' }}>
        {label}
      </p>
      <p style={{ fontSize: '0.8125rem', fontWeight: 500, color: highlight ? 'var(--color-danger)' : 'var(--color-text)' }}>
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
    primary: { background: 'var(--color-brand)', color: 'white', border: 'none' },
    success: { background: '#16a34a', color: 'white', border: 'none' },
    ghost:   { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '0.5625rem 1.125rem',
        borderRadius: '0.5rem',
        fontSize: '0.875rem',
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
