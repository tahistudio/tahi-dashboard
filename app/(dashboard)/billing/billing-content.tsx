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
  totalAmount?: number
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

  // Admin billing dashboard
  if (isAdmin) {
    return <AdminBillingView />
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
                            ${(inv.totalUsd ?? inv.totalAmount ?? 0).toFixed(2)} {inv.currency}
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

// -- Admin Billing View --

interface AdminSubscription {
  id: string
  orgName: string
  planType: string
  status: string
  hasPrioritySupport: boolean
  currentPeriodEnd: string | null
}

function AdminBillingView() {
  const [subs, setSubs] = useState<AdminSubscription[]>([])
  const [recentInvoices, setRecentInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [subsRes, invRes] = await Promise.all([
        fetch(apiPath('/api/admin/subscriptions')),
        fetch(apiPath('/api/admin/invoices?limit=10')),
      ])

      if (subsRes.ok) {
        const data = await subsRes.json() as { items: AdminSubscription[] }
        setSubs(data.items ?? [])
      }

      if (invRes.ok) {
        const data = await invRes.json() as { items: InvoiceRow[] }
        setRecentInvoices(data.items ?? [])
      }
    } catch {
      // Failed
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const activeSubs = subs.filter(s => s.status === 'active')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Billing</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Subscriptions, invoices, and revenue overview.
          </p>
        </div>
        <TahiButton variant="secondary" size="sm" onClick={fetchData} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <BillingKPI label="Active Subscriptions" value={activeSubs.length} />
            <BillingKPI label="Total Clients" value={subs.length} />
            <BillingKPI label="Recent Invoices" value={recentInvoices.length} />
            <BillingKPI
              label="Outstanding"
              value={`$${recentInvoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.totalUsd ?? i.totalAmount ?? 0), 0).toFixed(0)}`}
            />
          </div>

          {/* Active Subscriptions */}
          <div>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
              Active Subscriptions
            </h2>
            {subs.length === 0 ? (
              <EmptyState
                icon={<CreditCard className="w-8 h-8 text-white" />}
                title="No subscriptions"
                description="Client subscriptions will appear here."
              />
            ) : (
              <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Client</th>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Plan</th>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Status</th>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Priority</th>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Next Billing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subs.map(sub => (
                        <tr key={sub.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text)' }}>{sub.orgName}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span className="capitalize text-sm" style={{ color: 'var(--color-text)' }}>{sub.planType}</span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <InvoiceStatusBadge status={sub.status} />
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>
                            {sub.hasPrioritySupport ? 'Yes' : 'No'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>
                            {sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Recent Invoices */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                Recent Invoices
              </h2>
              <a href="/dashboard/invoices" className="text-sm font-medium" style={{ color: 'var(--color-brand)', textDecoration: 'none' }}>
                View all
              </a>
            </div>
            {recentInvoices.length === 0 ? (
              <EmptyState
                icon={<FileText className="w-8 h-8 text-white" />}
                title="No invoices yet"
                description="Invoices will appear here once created."
              />
            ) : (
              <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>ID</th>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Amount</th>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Status</th>
                        <th className="text-left" style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>Due Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentInvoices.map(inv => (
                        <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                          <td className="font-mono text-xs" style={{ padding: '0.75rem 1rem', color: 'var(--color-text)' }}>
                            {inv.id.slice(0, 8).toUpperCase()}
                          </td>
                          <td className="font-medium" style={{ padding: '0.75rem 1rem', color: 'var(--color-text)' }}>
                            ${(inv.totalUsd ?? inv.totalAmount ?? 0).toFixed(2)} {inv.currency}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <InvoiceStatusBadge status={inv.status} />
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>
                            {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function BillingKPI({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-card)',
      padding: '1.25rem',
    }}>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: 'var(--color-text)', marginTop: '0.25rem' }}>{value}</p>
    </div>
  )
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    paid: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
    sent: { bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
    viewed: { bg: 'var(--status-submitted-bg)', text: 'var(--status-submitted-text)' },
    draft: { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)' },
    overdue: { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
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
