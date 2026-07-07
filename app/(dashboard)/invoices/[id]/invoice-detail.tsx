'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, FileText, Sparkles, Send, X } from 'lucide-react'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { apiPath } from '@/lib/api'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { formatCurrency } from '@/lib/currency'
import { useDisplayCurrency } from '@/lib/display-currency-context'

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
  const router = useRouter()
  const { isImpersonatingClient } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  const { displayCurrency, formatNativeWithDisplay } = useDisplayCurrency()
  const [patching, setPatching] = useState<string | null>(null)

  const { data, isLoading: loading, error: fetchError, mutate } = useSWR<{ invoice?: InvoiceRow; items?: LineItem[] }>(
    `/api/admin/invoices/${invoiceId}`
  )
  const invoice = data?.invoice ?? null
  const items = data?.items ?? []
  const error = !!fetchError || (!loading && !data?.invoice)

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
      await mutate()
    } catch {
      // silently revert
    } finally {
      setPatching(null)
    }
  }, [invoice, invoiceId, mutate])

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
              onClick={() => void mutate()}
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
            <p data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
              {invoice.orgName ?? 'Unknown Client'}
            </p>
            <p
              data-private
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
            {invoice.currency && invoice.currency !== displayCurrency && invoice.totalUsd > 0 && (
              <p data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
                {formatNativeWithDisplay(invoice.totalUsd, invoice.currency).split('\u2248 ')[1] ?? ''}
              </p>
            )}
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
          <MetaField label="Invoice ID" value={invoice.id.slice(0, 8).toUpperCase()} isPrivate />
          <MetaField label="Created" value={formatDate(invoice.createdAt)} />
          <MetaField label="Due Date" value={formatDate(invoice.dueDate)} highlight={isOverdue(invoice.dueDate, invoice.status)} />
          {invoice.sentAt && <MetaField label="Sent" value={formatDate(invoice.sentAt)} />}
          {invoice.paidAt && <MetaField label="Paid" value={formatDate(invoice.paidAt)} />}
          {invoice.stripeInvoiceId && <MetaField label="Stripe ID" value={invoice.stripeInvoiceId} isPrivate />}
          {invoice.xeroInvoiceId && <MetaField label="Xero ID" value={invoice.xeroInvoiceId.slice(0, 8)} isPrivate />}
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
            {invoice.status !== 'written_off' && invoice.status !== 'paid' && (
              <ActionButton
                label="Void Invoice"
                disabled={patching !== null}
                onClick={() => {
                  if (confirm('Void this invoice? This will also void it in Xero if linked.')) {
                    patchStatus('written_off')
                  }
                }}
                variant="danger"
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
                      void mutate()
                    } else {
                      const err = await res.json() as { error?: string }
                      alert(err.error ?? 'Xero sync failed. Reconnect Xero in Settings.')
                    }
                  } catch { alert('Xero sync failed. Check connection in Settings.') }
                }}
                variant="ghost"
              />
            )}
            {invoice.status !== 'paid' && !invoice.stripeInvoiceId && (
              <ActionButton
                label="Create Stripe Link"
                disabled={patching !== null}
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath('/api/admin/invoices/stripe-create'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ invoiceId: invoice.id }),
                    })
                    if (res.ok) {
                      const data = await res.json() as { payUrl?: string }
                      if (data.payUrl) {
                        await navigator.clipboard.writeText(data.payUrl)
                        alert('Stripe invoice created - payment link copied to clipboard.')
                      }
                      void mutate()
                    } else {
                      // Surface the real Stripe error rather than a generic message.
                      // Most common cause: the client has no contact with email
                      // (Stripe rejects customer.create without one).
                      const err = await res.json().catch(() => ({})) as { error?: string; message?: string }
                      const detail = err.message || err.error || `HTTP ${res.status}`
                      alert(`Stripe invoice failed:\n\n${detail}\n\nIf this says "Missing email", add a contact with email on this client's Contacts tab.`)
                    }
                  } catch (err) {
                    alert(`Failed to create Stripe link: ${err instanceof Error ? err.message : 'unknown error'}`)
                  }
                }}
                variant="ghost"
              />
            )}
            {invoice.stripeInvoiceId && (
              <ActionButton
                label="Copy Payment Link"
                disabled={patching !== null}
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath(`/api/admin/integrations/stripe/provision?invoiceId=${invoice.id}`))
                    if (res.ok) {
                      const data = await res.json() as { payUrl?: string }
                      if (data.payUrl) {
                        await navigator.clipboard.writeText(data.payUrl)
                        alert('Payment link copied!')
                      } else {
                        alert('No payment link available')
                      }
                    }
                  } catch { alert('Failed') }
                }}
                variant="ghost"
              />
            )}
            <ActionButton
              label="Delete Invoice"
              disabled={patching !== null}
              onClick={async () => {
                if (!confirm('Are you sure you want to delete this invoice? This cannot be undone.')) return
                try {
                  const res = await fetch(apiPath(`/api/admin/invoices/${invoice.id}`), { method: 'DELETE' })
                  if (res.ok) {
                    router.push('/invoices')
                  } else {
                    const err = await res.json() as { error?: string }
                    alert(err.error ?? 'Failed to delete invoice')
                  }
                } catch { alert('Failed to delete invoice') }
              }}
              variant="danger"
            />
          </div>
        )}
      </div>

      {/* Overdue-invoice chase draft (admin only, sent/overdue invoices) */}
      {isAdmin && (status === 'sent' || status === 'overdue') && (
        <ChaseDraftCard invoiceId={invoiceId} recipientLabel={invoice.orgName ?? 'the client'} />
      )}

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
          <div className="h-scroll">
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
                    <td data-private style={{ padding: '0.875rem 1.25rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {item.description}
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      {item.quantity ?? 1}
                    </td>
                    <td data-private style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      {formatInvoiceCurrency(item.unitPriceUsd, invoice.currency)}
                    </td>
                    <td data-private style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
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
            <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{formatInvoiceCurrency(subtotal, invoice.currency)}</span>
          </div>
          {(() => {
            // Show tax if stored, or if total > subtotal (e.g. GST from Xero)
            const storedTax = invoice.taxAmountUsd ?? 0
            const impliedTax = invoice.totalUsd - subtotal
            const taxAmount = storedTax > 0 ? storedTax : (impliedTax > 0.01 ? impliedTax : 0)
            if (taxAmount <= 0) return null
            const isNzd = (invoice.currency ?? '').toUpperCase() === 'NZD'
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{isNzd ? 'GST (15%)' : 'Tax'}</span>
                <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{formatInvoiceCurrency(taxAmount, invoice.currency)}</span>
              </div>
            )
          })()}
          {(invoice.discountAmountUsd ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 240 }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Discount</span>
              <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>-{formatInvoiceCurrency(invoice.discountAmountUsd ?? 0, invoice.currency)}</span>
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
            <span data-private style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>{formatInvoiceCurrency(invoice.totalUsd, invoice.currency)}</span>
          </div>
        </div>
      </div>

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function MetaField({ label, value, highlight, isPrivate }: { label: string; value: string; highlight?: boolean; isPrivate?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.125rem' }}>
        {label}
      </p>
      <p {...(isPrivate ? { 'data-private': true } : {})} style={{ fontSize: '0.8125rem', fontWeight: 500, color: highlight ? 'var(--color-danger)' : 'var(--color-text)' }}>
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
  variant: 'primary' | 'success' | 'ghost' | 'danger'
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--color-brand)', color: 'white', border: 'none' },
    success: { background: 'var(--color-brand)', color: 'white', border: 'none' },
    ghost:   { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
    danger:  { background: 'var(--color-bg)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' },
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

// ─── AI chase draft card ────────────────────────────────────────────────────
// Clones the lead draft-reply triad for overdue invoices: generate a PENDING
// draft, edit it, then explicitly Send (Resend) or Dismiss. Nothing is ever
// sent automatically - a human clicks Send.

interface ChaseDraftRow {
  id: string
  aiDraftSubject: string | null
  aiDraftBody: string
  finalSubject: string | null
  finalBody: string | null
  status: string
  tokensSpent: number | null
}

function ChaseDraftCard({ invoiceId, recipientLabel }: { invoiceId: string; recipientLabel: string }) {
  const { data, mutate } = useSWR<{ draft: ChaseDraftRow | null }>(
    `/api/admin/invoices/${invoiceId}/draft-chase`
  )
  const draft = data?.draft ?? null

  const [subjectEdit, setSubjectEdit] = useState('')
  const [bodyEdit, setBodyEdit] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    if (draft) {
      setSubjectEdit(draft.finalSubject ?? draft.aiDraftSubject ?? '')
      setBodyEdit(draft.finalBody ?? draft.aiDraftBody ?? '')
    }
  }, [draft])

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    setSentTo(null)
    try {
      const res = await fetch(apiPath(`/api/admin/invoices/${invoiceId}/draft-chase`), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail ?? err.error ?? 'Draft generation failed')
      }
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft generation failed')
    } finally {
      setGenerating(false)
    }
  }, [invoiceId, mutate])

  const send = useCallback(async () => {
    if (!draft) return
    setSending(true)
    setError(null)
    try {
      const subjectChanged = subjectEdit !== (draft.finalSubject ?? draft.aiDraftSubject ?? '')
      const bodyChanged = bodyEdit !== (draft.finalBody ?? draft.aiDraftBody)
      if (subjectChanged || bodyChanged) {
        await fetch(apiPath(`/api/admin/ai-reply-drafts/${draft.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalSubject: subjectEdit, finalBody: bodyEdit }),
        })
      }
      const res = await fetch(apiPath(`/api/admin/ai-reply-drafts/${draft.id}/send`), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail ?? err.error ?? 'Send failed')
      }
      const body = await res.json().catch(() => ({})) as { recipientEmail?: string }
      setSentTo(body.recipientEmail ?? 'the client')
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [draft, subjectEdit, bodyEdit, mutate])

  const dismiss = useCallback(async () => {
    if (!draft) return
    try {
      await fetch(apiPath(`/api/admin/ai-reply-drafts/${draft.id}`), { method: 'DELETE' })
      await mutate()
    } catch {
      // ignore - the card falls back to the generate prompt on next load
    }
  }, [draft, mutate])

  const labelStyle: React.CSSProperties = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--color-text-subtle)',
    marginBottom: '0.25rem',
    display: 'block',
  }

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        padding: '1.25rem 1.25rem 1.375rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
        <Sparkles style={{ width: 16, height: 16, color: 'var(--color-brand)' }} aria-hidden="true" />
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
          Chase email
        </h2>
      </div>

      {sentTo && (
        <div
          style={{
            padding: '0.5rem 0.75rem',
            marginBottom: '0.75rem',
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success)',
            borderRadius: '0.5rem',
            fontSize: '0.8125rem',
            color: 'var(--color-success)',
          }}
        >
          Chase sent to {sentTo}.
        </div>
      )}

      {!draft ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Draft a polite overdue-payment follow-up to {recipientLabel}&rsquo;s primary contact. Grounded in this
            invoice (number, amount, days overdue) and Tahi&rsquo;s tone. You review and send it yourself.
          </p>
          {error && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger)',
                borderRadius: '0.5rem',
                fontSize: '0.75rem',
                color: 'var(--color-danger)',
              }}
            >
              {error}
            </div>
          )}
          <button
            onClick={() => void generate()}
            disabled={generating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0.5625rem 1.125rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'var(--color-brand)',
              color: 'white',
              border: 'none',
              cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.6 : 1,
              minHeight: 44,
            }}
          >
            {generating
              ? <RefreshCw style={{ width: 14, height: 14 }} className="animate-spin" aria-hidden="true" />
              : <Sparkles style={{ width: 14, height: 14 }} aria-hidden="true" />}
            {generating ? 'Drafting...' : 'Draft chase email'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>Subject</label>
            <input
              data-private
              value={subjectEdit}
              onChange={e => setSubjectEdit(e.target.value)}
              placeholder="(no subject)"
              style={{
                width: '100%',
                fontSize: '0.8125rem',
                fontFamily: 'inherit',
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                padding: '0.5rem 0.625rem',
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>Body</label>
            <textarea
              data-private
              value={bodyEdit}
              onChange={e => setBodyEdit(e.target.value)}
              rows={10}
              style={{
                width: '100%',
                fontSize: '0.8125rem',
                fontFamily: 'inherit',
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                padding: '0.5rem 0.625rem',
                lineHeight: 1.55,
                resize: 'vertical',
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger)',
                borderRadius: '0.5rem',
                fontSize: '0.75rem',
                color: 'var(--color-danger)',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => void send()}
              disabled={sending || !bodyEdit.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.5625rem 1.125rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'var(--color-brand)',
                color: 'white',
                border: 'none',
                cursor: sending || !bodyEdit.trim() ? 'not-allowed' : 'pointer',
                opacity: sending || !bodyEdit.trim() ? 0.6 : 1,
                minHeight: 44,
              }}
            >
              {sending
                ? <RefreshCw style={{ width: 14, height: 14 }} className="animate-spin" aria-hidden="true" />
                : <Send style={{ width: 14, height: 14 }} aria-hidden="true" />}
              {sending ? 'Sending...' : 'Send chase'}
            </button>
            <button
              onClick={() => void generate()}
              disabled={generating}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.5625rem 1.125rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.6 : 1,
                minHeight: 44,
              }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden="true" />
              Regenerate
            </button>
            <button
              onClick={() => void dismiss()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.5625rem 1.125rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              <X style={{ width: 14, height: 14 }} aria-hidden="true" />
              Dismiss
            </button>
            {draft.tokensSpent != null && draft.tokensSpent > 0 && (
              <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginLeft: 'auto' }}>
                {draft.tokensSpent.toLocaleString()} tokens
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
