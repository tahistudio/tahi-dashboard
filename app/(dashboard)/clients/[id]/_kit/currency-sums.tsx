'use client'

/**
 * Summing money that was billed in more than one currency.
 *
 * Invoices carry their own currency (the route selects it, the row renders it,
 * and POST /api/admin/invoices takes one from VALID_CURRENCIES). Adding the raw
 * totals and stamping the org's preferred code on the result turns a US$4,000
 * invoice into "NZ$4,000" on the tile above the table that shows it correctly.
 *
 * So the totals are grouped by the currency each row was billed in. One
 * currency renders exactly as before; a mixed client gets a line per currency
 * rather than a single wrong number.
 */

import { Money } from '@/components/tahi/money'

export interface CurrencySum {
  currency: string
  total: number
}

export interface AmountRow {
  totalAmount?: number | null
  currency?: string | null
}

/** Group and total by billed currency, largest first. NZD when a row has none. */
export function sumByCurrency(rows: AmountRow[], fallback = 'NZD'): CurrencySum[] {
  const by = new Map<string, number>()
  for (const r of rows) {
    const code = (r.currency ?? fallback).toUpperCase()
    by.set(code, (by.get(code) ?? 0) + (r.totalAmount ?? 0))
  }
  return [...by.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Render a set of currency totals. Empty renders a zero in the fallback
 * currency so a tile never goes blank.
 */
export function MoneySums({
  sums,
  fallback = 'NZD',
}: {
  sums: CurrencySum[]
  fallback?: string
}) {
  if (sums.length === 0) {
    return <Money native={0} currency={fallback} sensitive />
  }
  if (sums.length === 1) {
    return <Money native={sums[0].total} currency={sums[0].currency} sensitive />
  }
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
      {sums.map(s => (
        <Money key={s.currency} native={s.total} currency={s.currency} sensitive style={{ lineHeight: 1.2 }} />
      ))}
    </span>
  )
}
