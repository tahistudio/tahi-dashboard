'use client'

/** The client Revenue tab: invoiced, paid, outstanding, hours and LTV. */

import useSWR from 'swr'
import { AlertTriangle, Check, Clock, DollarSign, TrendingUp } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { SkeletonList } from '@/components/tahi/skeletons'

// ── Revenue tab ───────────────────────────────────────────────────────────────

export interface RevenueInvoice {
  id: string
  totalAmount: number
  currency: string | null
  status: string
}

export interface RevenueTimeEntry {
  id: string
  hours: number
  billable: boolean | null
}

export function RevenueTab({ clientId }: { clientId: string }) {
  // Invoices + time entries load together via an inline SWR fetcher; each side
  // swallows its own error and falls back to an empty list, just like before.
  const { data, isLoading: loading } = useSWR<{ invoices: RevenueInvoice[]; timeEntries: RevenueTimeEntry[] }>(
    `client-revenue:${clientId}`,
    async () => {
      const [inv, time] = await Promise.all([
        fetch(apiPath(`/api/admin/invoices?orgId=${clientId}`))
          .then(r => r.json() as Promise<{ items: RevenueInvoice[] }>)
          .then(d => d.items ?? [])
          .catch(() => [] as RevenueInvoice[]),
        fetch(apiPath(`/api/admin/time?orgId=${clientId}`))
          .then(r => r.json() as Promise<{ items: RevenueTimeEntry[] }>)
          .then(d => d.items ?? [])
          .catch(() => [] as RevenueTimeEntry[]),
      ])
      return { invoices: inv, timeEntries: time }
    },
  )
  const invoices = data?.invoices ?? []
  const timeEntries = data?.timeEntries ?? []

  if (loading) {
    return (
      <SkeletonList rows={4} />
    )
  }

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)
  const paidInvoices = invoices.filter(i => i.status === 'paid')
  const totalPaid = paidInvoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)
  const outstandingInvoices = invoices.filter(i => i.status === 'sent' || i.status === 'overdue')
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)

  const totalHours = timeEntries.reduce((s, e) => s + e.hours, 0)
  const billableHours = timeEntries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)
  // Estimate cost at $50/hr for LTV calculation
  const HOURLY_RATE = 50
  const estimatedTimeCost = billableHours * HOURLY_RATE

  // LTV = total paid + outstanding (expected revenue)
  const ltv = totalPaid + totalOutstanding

  const statCards = [
    {
      label: 'Total Invoiced',
      value: `$${totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `${invoices.length} invoices`,
      icon: DollarSign,
      color: 'var(--color-brand)',
      bg: 'var(--color-brand-50)',
    },
    {
      label: 'Total Paid',
      value: `$${totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `${paidInvoices.length} paid`,
      icon: Check,
      color: 'var(--color-brand)',
      bg: 'var(--color-success-bg)',
    },
    {
      label: 'Outstanding',
      value: `$${totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `${outstandingInvoices.length} unpaid`,
      icon: AlertTriangle,
      color: totalOutstanding > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)',
      bg: totalOutstanding > 0 ? 'var(--color-warning-bg)' : 'var(--color-bg-secondary)',
    },
    {
      label: 'Billable Hours',
      value: `${billableHours.toFixed(1)}h`,
      detail: `${totalHours.toFixed(1)}h total`,
      icon: Clock,
      color: 'var(--color-info)',
      bg: 'var(--color-info-bg)',
    },
    {
      label: 'Estimated Time Cost',
      value: `$${estimatedTimeCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `at $${HOURLY_RATE}/hr`,
      icon: TrendingUp,
      color: 'var(--status-client-review-text)',
      bg: 'var(--status-client-review-bg)',
    },
    {
      label: 'Lifetime Value (LTV)',
      value: `$${ltv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: 'paid + outstanding',
      icon: TrendingUp,
      color: 'var(--color-brand)',
      bg: 'var(--color-brand-50)',
    },
  ]

  return (
    <div>
      <h2 className="font-semibold text-[var(--color-text)] mb-4">Revenue summary</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map(card => {
          const Icon = card.icon
          return (
            <Card key={card.label}>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: card.bg }}
                >
                  <Icon className="w-5 h-5" style={{ color: card.color }} />
                </div>
                <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  {card.label}
                </span>
              </div>
              <p className="text-xl font-bold text-[var(--color-text)]">{card.value}</p>
              <p className="text-xs text-[var(--color-text-subtle)] mt-1">{card.detail}</p>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
