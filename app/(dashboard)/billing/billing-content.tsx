'use client'

import { useState, useEffect, useCallback } from 'react'
import { CreditCard, ExternalLink, FileText, RefreshCw } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'

interface InvoiceRow {
  id: string
  status: string
  amountUsd: number
  totalUsd: number
  currency: string
  dueDate: string | null
  paidAt: string | null
  createdAt: string
}

interface SubscriptionRow {
  id: string
  planType: string
  status: string
  currentPeriodEnd: string | null
}

export function BillingContent({ isAdmin }: { isAdmin: boolean }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      if (isAdmin) {
        // Admin billing is a placeholder for now
        setLoading(false)
        return
      }

      const [invoicesRes, subRes] = await Promise.all([
        fetch(apiPath('/api/portal/invoices?status=all')),
        fetch(apiPath('/api/portal/capacity')).catch(() => null),
      ])

      if (invoicesRes.ok) {
        const data = await invoicesRes.json() as { items: InvoiceRow[] }
        setInvoices(data.items ?? [])
      }

      if (subRes?.ok) {
        const data = await subRes.json() as { subscription?: SubscriptionRow }
        setSubscription(data.subscription ?? null)
      }
    } catch {
      // Failed to load
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { fetchData() }, [fetchData])

  async function openBillingPortal() {
    setPortalLoading(true)
    try {
      const res = await fetch(apiPath('/api/portal/billing/session'))
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        console.error('[billing] Portal session error:', data.error)
        return
      }
      const data = await res.json() as { url: string }
      if (data.url) {
        window.open(data.url, '_blank')
      }
    } catch {
      console.error('[billing] Failed to open portal')
    } finally {
      setPortalLoading(false)
    }
  }

  // Admin placeholder
  if (isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Billing</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Subscriptions, plans, and Stripe management.</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
            <CreditCard className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">Admin billing coming soon</h3>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Stripe subscription management and billing configuration will live here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Billing</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">View your plan, invoices, and manage billing.</p>
        </div>
        <TahiButton variant="secondary" size="sm" onClick={fetchData} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="space-y-6">
          {/* Current Plan */}
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">Current Plan</h2>
                {subscription ? (
                  <div className="space-y-1">
                    <p className="text-sm text-[var(--color-text)]">
                      <span className="font-medium capitalize">{subscription.planType}</span>
                      <span
                        className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: subscription.status === 'active' ? 'var(--color-success-bg, #f0fdf4)' : 'var(--color-bg-tertiary)',
                          color: subscription.status === 'active' ? 'var(--color-success, #16a34a)' : 'var(--color-text-muted)',
                        }}
                      >
                        {subscription.status}
                      </span>
                    </p>
                    {subscription.currentPeriodEnd && (
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Next billing: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">No active subscription found.</p>
                )}
              </div>
              <TahiButton
                size="sm"
                onClick={openBillingPortal}
                disabled={portalLoading}
                iconLeft={<ExternalLink className="w-3.5 h-3.5" />}
              >
                {portalLoading ? 'Loading...' : 'Manage Billing'}
              </TahiButton>
            </div>
          </div>

          {/* Invoice History */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">Invoice History</h2>
            {invoices.length === 0 ? (
              <EmptyState
                icon={<FileText className="w-8 h-8 text-white" />}
                title="No invoices yet"
                description="Your invoice history will appear here once invoices are generated."
              />
            ) : (
              <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)]">
                        <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">ID</th>
                        <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Amount</th>
                        <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Due Date</th>
                        <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(inv => (
                        <tr key={inv.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                          <td className="px-4 py-3 font-mono text-xs text-[var(--color-text)]">
                            {inv.id.slice(0, 8).toUpperCase()}
                          </td>
                          <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                            ${inv.totalUsd.toFixed(2)} {inv.currency}
                          </td>
                          <td className="px-4 py-3">
                            <InvoiceStatusBadge status={inv.status} />
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)]">
                            {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)]">
                            {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    paid: { bg: '#f0fdf4', text: '#16a34a' },
    sent: { bg: '#eff6ff', text: '#2563eb' },
    viewed: { bg: '#eff6ff', text: '#2563eb' },
    draft: { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)' },
    overdue: { bg: '#fef2f2', text: '#dc2626' },
    written_off: { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-subtle)' },
  }

  const c = config[status] ?? config.draft

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
      style={{ background: c.bg, color: c.text }}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
