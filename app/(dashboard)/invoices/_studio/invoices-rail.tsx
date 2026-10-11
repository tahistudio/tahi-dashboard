'use client'

import { useState } from 'react'
import { RailGroupLabel, RailSelect, RailViewItem, buildRailChips, type RailOption } from '@/components/tahi/rail/rail-controls'
import { TahiButton } from '@/components/tahi/tahi-button'
import { DEFAULT_INVOICE_FILTERS, INVOICE_VIEWS, type InvoiceFilters, type InvoiceView } from './invoice-views'

const STATUS_OPTIONS: RailOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft', dot: 'var(--badge-neutral-dot)' },
  { value: 'sent', label: 'Sent', dot: 'var(--badge-warning-dot)' },
  { value: 'viewed', label: 'Viewed', dot: 'var(--badge-info-dot)' },
  { value: 'overdue', label: 'Overdue', dot: 'var(--badge-danger-dot)' },
  { value: 'paid', label: 'Paid', dot: 'var(--badge-positive-dot)' },
  { value: 'written_off', label: 'Written Off', dot: 'var(--badge-neutral-dot)' },
]
const SOURCE_OPTIONS: RailOption[] = [
  { value: 'all', label: 'All rails' }, { value: 'manual', label: 'Manual' },
  { value: 'xero', label: 'Xero' }, { value: 'stripe', label: 'Stripe' },
]
export function buildInvoiceChips(filters: InvoiceFilters, clients: RailOption[]) {
  return buildRailChips({ ...filters }, { ...DEFAULT_INVOICE_FILTERS }, [
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
    { key: 'source', label: 'Rail', options: SOURCE_OPTIONS },
    { key: 'client', label: 'Client', options: clients },
    { key: 'from', label: 'Due from', options: [] }, { key: 'to', label: 'Due to', options: [] },
  ])
}
export interface InvoicesRailProps {
  view: InvoiceView
  onView: (view: InvoiceView) => void
  counts: Record<InvoiceView, number> | null
  filters: InvoiceFilters
  onFilters: (filters: InvoiceFilters) => void
  clients: RailOption[]
  onClear: () => void
  touch?: boolean
}
export function InvoicesRail({ view, onView, counts, filters, onFilters, clients, onClear, touch = false }: InvoicesRailProps) {
  const [open, setOpen] = useState<string | null>(null)
  const dimensions = [
    { key: 'status' as const, label: 'Status', options: STATUS_OPTIONS },
    { key: 'source' as const, label: 'Rail', options: SOURCE_OPTIONS },
    { key: 'client' as const, label: 'Client', options: clients },
  ]
  return (
    <div className="flex flex-col" style={{ gap: '1.125rem' }}>
      <div>
        <RailGroupLabel>Views</RailGroupLabel>
        {INVOICE_VIEWS.map(item => <RailViewItem key={item.key} label={item.label} count={counts?.[item.key] ?? null} active={item.key === view} onClick={() => onView(item.key)} touch={touch} />)}
        {!counts && <p className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>Counts wait for the complete ledger.</p>}
      </div>
      <div className="flex flex-col" style={{ gap: '0.375rem' }}>
        <RailGroupLabel>Filters</RailGroupLabel>
        {dimensions.map(dimension => <RailSelect
          key={dimension.key} label={dimension.label} options={dimension.options} value={filters[dimension.key]}
          onChange={value => onFilters({ ...filters, [dimension.key]: value })}
          open={open === dimension.key} onToggle={() => setOpen(open === dimension.key ? null : dimension.key)} onClose={() => setOpen(null)}
          active={filters[dimension.key] !== 'all'} onClear={() => onFilters({ ...filters, [dimension.key]: 'all' })}
          searchable={dimension.key === 'client'} searchLabel="Search clients" touch={touch}
        />)}
        {(['from', 'to'] as const).map(key => <label key={key} className="flex flex-col text-xs" style={{ gap: '0.375rem', color: 'var(--color-text-muted)' }}>
          Due {key}
          <input type="date" value={filters[key]} onChange={event => onFilters({ ...filters, [key]: event.target.value })}
            className="tahi-focus-ring min-h-11 w-full min-w-0"
            style={{ padding: '0.375rem 0.5rem', border: '0.0625rem solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', color: 'var(--color-text)', font: 'inherit' }} />
        </label>)}
      </div>
      <TahiButton variant="ghost" style={{ minHeight: '2.75rem' }} onClick={onClear}>Clear all</TahiButton>
    </div>
  )
}
