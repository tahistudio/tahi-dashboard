'use client'

/** The Revenue section of the client Money tab: invoiced, paid, outstanding,
 *  hours, and what those hours cost against the client's own rate. */

import useSWR from 'swr'
import { apiPath } from '@/lib/api'
import { Money } from '@/components/tahi/money'
import { SkeletonList } from '@/components/tahi/skeletons'
import { Tile, TileGrid } from '../_kit/chrome'

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

/** Fallback when the client has no rate of their own on record. */
const DEFAULT_HOURLY_RATE = 50

export function RevenueTab({
  clientId,
  currency,
  hourlyRate,
}: {
  clientId: string
  currency: string
  /** org.defaultHourlyRate. The old tab hardcoded 50 for every client. */
  hourlyRate: number | null
}) {
  // Invoices + time entries load together via an inline SWR fetcher; each side
  // swallows its own error and falls back to an empty list.
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

  if (loading) return <SkeletonList rows={4} />

  const invoices = data?.invoices ?? []
  const timeEntries = data?.timeEntries ?? []

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)
  const paidInvoices = invoices.filter(i => i.status === 'paid')
  const totalPaid = paidInvoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)
  const outstandingInvoices = invoices.filter(i => i.status === 'sent' || i.status === 'viewed' || i.status === 'overdue')
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)

  const totalHours = timeEntries.reduce((s, e) => s + e.hours, 0)
  const billableHours = timeEntries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)
  const rate = hourlyRate ?? DEFAULT_HOURLY_RATE
  const estimatedTimeCost = billableHours * rate

  // Lifetime value: what has been paid, plus what is still expected.
  const ltv = totalPaid + totalOutstanding

  return (
    <TileGrid>
      <Tile
        label="Total invoiced"
        value={<Money native={totalInvoiced} currency={currency} sensitive />}
        hint={`${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`}
      />
      <Tile
        label="Total paid"
        tone={totalPaid > 0 ? 'positive' : 'neutral'}
        value={<Money native={totalPaid} currency={currency} sensitive />}
        hint={`${paidInvoices.length} settled`}
      />
      <Tile
        label="Outstanding"
        tone={totalOutstanding > 0 ? 'danger' : 'neutral'}
        value={<Money native={totalOutstanding} currency={currency} sensitive />}
        hint={`${outstandingInvoices.length} unpaid`}
      />
      <Tile
        label="Billable hours"
        value={`${billableHours.toFixed(1)}h`}
        hint={`${totalHours.toFixed(1)}h logged in total`}
      />
      <Tile
        label="Estimated time cost"
        value={<Money native={estimatedTimeCost} currency={currency} sensitive />}
        hint={hourlyRate != null
          ? `at their ${currency} ${rate}/hr rate`
          : `at the ${currency} ${rate}/hr studio fallback, no rate set for this client`}
      />
      <Tile
        label="Lifetime value"
        value={<Money native={ltv} currency={currency} sensitive />}
        hint="paid plus outstanding"
      />
    </TileGrid>
  )
}
