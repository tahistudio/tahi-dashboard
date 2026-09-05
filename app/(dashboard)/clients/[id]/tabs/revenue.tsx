'use client'

/**
 * The Revenue section of the client Money tab: invoiced, paid, outstanding,
 * hours, and what those hours cost against the client's own rate.
 *
 * The invoice tiles group by the currency each invoice was billed in rather
 * than stamping the org's preferred code on a mixed total. The rate is NZD:
 * /api/admin/clients/[id]/profitability treats organisations.defaultHourlyRate
 * as NZD (`hourlyRateNzd`), so the cost goes through <Money nzd> and converts
 * to whatever the nav bar is showing.
 */

import useSWR from 'swr'
import { apiPath } from '@/lib/api'
import { Money } from '@/components/tahi/money'
import { SkeletonList } from '@/components/tahi/skeletons'
import { Tile, TileGrid } from '../_kit/chrome'
import { MoneySums, sumByCurrency } from '../_kit/currency-sums'

export interface RevenueInvoice {
  id: string
  totalAmount: number
  currency: string | null
  status: string
}

/** Statuses that mean the money has been asked for and has not landed. */
const OUTSTANDING_STATUSES = ['sent', 'viewed', 'overdue']

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

  const paidInvoices = invoices.filter(i => i.status === 'paid')
  const outstandingInvoices = invoices.filter(i => OUTSTANDING_STATUSES.includes(i.status))

  const invoicedSums = sumByCurrency(invoices, currency)
  const paidSums = sumByCurrency(paidInvoices, currency)
  const outstandingSums = sumByCurrency(outstandingInvoices, currency)
  // Lifetime value: what has been paid, plus what is still expected, each in
  // the currency it was billed in.
  const ltvSums = sumByCurrency([...paidInvoices, ...outstandingInvoices], currency)
  const anyOutstanding = outstandingSums.some(s => s.total > 0)
  const anyPaid = paidSums.some(s => s.total > 0)

  const totalHours = timeEntries.reduce((s, e) => s + e.hours, 0)
  const billableHours = timeEntries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)
  const rate = hourlyRate ?? DEFAULT_HOURLY_RATE
  const estimatedTimeCost = billableHours * rate

  return (
    <TileGrid>
      <Tile
        label="Total invoiced"
        value={<MoneySums sums={invoicedSums} fallback={currency} />}
        hint={`${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`}
      />
      <Tile
        label="Total paid"
        tone={anyPaid ? 'positive' : 'neutral'}
        value={<MoneySums sums={paidSums} fallback={currency} />}
        hint={`${paidInvoices.length} settled`}
      />
      <Tile
        label="Outstanding"
        tone={anyOutstanding ? 'danger' : 'neutral'}
        value={<MoneySums sums={outstandingSums} fallback={currency} />}
        hint={`${outstandingInvoices.length} unpaid`}
      />
      <Tile
        label="Billable hours"
        value={`${billableHours.toFixed(1)}h`}
        hint={`${totalHours.toFixed(1)}h logged in total`}
      />
      <Tile
        label="Estimated time cost"
        value={<Money nzd={estimatedTimeCost} sensitive />}
        hint={hourlyRate != null
          ? `at their NZD ${rate}/hr rate`
          : `at the NZD ${rate}/hr studio fallback, no rate set for this client`}
      />
      <Tile
        label="Lifetime value"
        value={<MoneySums sums={ltvSums} fallback={currency} />}
        hint="paid plus outstanding"
      />
    </TileGrid>
  )
}
