'use client'

import { useCallback, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Download, FileText, Lock, Plus, RefreshCw } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { ApiError } from '@/lib/swr-fetcher'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { oneOf, useUserPreference } from '@/lib/use-user-preference'
import { invoiceReference } from '@/lib/invoice-billing'
import { invoiceAgeLabel, invoiceDaysPastDue, invoiceDueLabel } from '@/lib/invoice-pay-state'
import { PageHeader } from '@/components/tahi/page-header'
import { RailLayout } from '@/components/tahi/rail/rail-layout'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { SkeletonKPIStrip } from '@/components/tahi/skeletons'
import { TahiButton } from '@/components/tahi/tahi-button'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { useToast } from '@/components/tahi/toast'
import { InvoiceStatusBadge } from '../invoice-status'
import { StripeInvoiceRecovery } from '../stripe-invoice-recovery'
import { RailChip } from '../rail-chip'
import { InvoiceAmount, InvoiceMobileRow } from './invoice-mobile-row'
import { InvoicesBand } from './invoices-band'
import { buildInvoiceChips, InvoicesRail } from './invoices-rail'
import { DEFAULT_INVOICE_FILTERS, INVOICE_VIEWS, filterInvoiceRows, invoiceDisplayStatus, invoiceViewCounts, type InvoiceFilters, type InvoiceView, type StudioInvoice } from './invoice-views'
import { useAllInvoices } from './use-all-invoices'
import './invoice-ledger.css'

export interface InvoiceCreateProps { open: boolean; onClose: () => void; onCreated: (invoiceId?: string) => void }

export function StudioInvoiceList({ CreateInvoice }: { CreateInvoice: ComponentType<InvoiceCreateProps> }) {
  const ledger = useAllInvoices()
  const { mutate } = ledger
  const router = useRouter()
  const { showToast } = useToast()
  const { displayCurrency, exchangeRates } = useDisplayCurrency()
  const [view, setView] = useUserPreference<InvoiceView>('invoices.view', 'owed', { validator: oneOf(INVOICE_VIEWS.map(item => item.key)) })
  const [filters, setFilters] = useState<InvoiceFilters>({ ...DEFAULT_INVOICE_FILTERS })
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [importing, setImporting] = useState(false)
  const clear = () => { setFilters({ ...DEFAULT_INVOICE_FILTERS }); setQuery(''); setView('all') }
  const clients = useMemo(() => [
    { value: 'all', label: 'All clients' },
    ...[...new Map(ledger.items.map(inv => [inv.orgId, inv.orgName ?? 'Client'])).entries()]
      .sort(([, a], [, b]) => a.localeCompare(b)).map(([value, label]) => ({ value, label })),
  ], [ledger.items])
  const counts = ledger.complete ? invoiceViewCounts(ledger.items) : null
  const rows = filterInvoiceRows(ledger.items, view, filters, query)
  const chips = buildInvoiceChips(filters, clients)
  const denied = ledger.error instanceof ApiError && ledger.error.status === 403
  const disabled = !ledger.complete || ledger.scopeNone
  const created = useCallback((invoiceId?: string) => {
    setShowCreate(false)
    void mutate()
    if (invoiceId) router.push(`/invoices/${invoiceId}`)
  }, [mutate, router])
  const columns: DataTableColumn<StudioInvoice>[] = [
    { key: 'client', header: 'Client', sortable: true, sortValue: inv => inv.orgName ?? '', width: '18%', wrap: true,
      render: inv => <Link href={`/clients/${inv.orgId}`} data-row-control data-private className="tahi-focus-ring inline-flex items-center min-h-11 hover:underline" style={{ color: 'var(--color-link)', minWidth: 0, width: '100%', maxWidth: '12rem', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{inv.orgName ?? 'Client'}</Link> },
    { key: 'number', header: 'Invoice', sortable: true, sortValue: inv => invoiceReference(inv.id, inv.number), width: '16%', wrap: true,
      render: inv => <Link href={`/invoices/${inv.id}`} data-row-control data-private className="tahi-focus-ring inline-flex items-center min-h-11 font-mono hover:underline" style={{ color: 'var(--color-link)', minWidth: 0, width: '100%', maxWidth: '11rem', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{invoiceReference(inv.id, inv.number)}</Link> },
    { key: 'amount', header: 'Amount', align: 'right', width: '16%', wrap: true, render: inv => <InvoiceAmount invoice={inv} currency={displayCurrency} rates={exchangeRates} /> },
    { key: 'status', header: 'Status', width: '12%', wrap: true, render: inv => <InvoiceStatusBadge status={invoiceDisplayStatus(inv)} dueDate={null} /> },
    { key: 'rail', header: 'Rail', width: '14%', wrap: true, render: inv => <RailChip invoice={inv} full /> },
    { key: 'dueDate', header: 'Due', sortable: true, sortValue: inv => inv.dueDate, width: '12%', wrap: true,
      render: inv => <span style={{ color: invoiceDaysPastDue(inv) ? 'var(--color-danger-ink)' : 'var(--color-text-muted)' }}>{inv.dueDate ?? 'No date'}<span className="block text-xs">{invoiceDueLabel(inv)}</span></span> },
    { key: 'createdAt', header: 'Age', sortable: true, sortValue: inv => inv.createdAt, width: '12%', wrap: true, render: inv => <span style={{ color: 'var(--color-text-subtle)' }}>{invoiceAgeLabel(inv)}</span> },
  ]
  const rail = { view, onView: setView, counts, filters, onFilters: setFilters, clients, onClear: clear }
  const stateTitle = denied ? 'Invoices are not on your seat' : ledger.scopeNone ? 'No client is in your scope yet' : 'We could not load the ledger'
  const readProblem = !!ledger.error || ledger.capped
  return <div className="flex flex-col min-w-0" style={{ gap: '1.25rem' }}>
    <PageHeader title="Invoices" subtitle="Every invoice in your scope, what it is worth, and whether the client can pay it.">
      <TahiButton variant="secondary" size="sm" style={{ minHeight: '2.75rem' }} disabled={disabled} iconLeft={<Download size={14} />} onClick={() => {
        const link = document.createElement('a')
        link.href = apiPath('/api/admin/export/invoices')
        link.download = 'invoices.csv'
        link.click()
      }}>Export CSV</TahiButton>
      <StripeInvoiceRecovery onImported={created} />
      <TahiButton variant="secondary" size="sm" style={{ minHeight: '2.75rem' }} disabled={importing || disabled} iconLeft={<RefreshCw size={14} className={importing ? 'animate-spin' : undefined} />} onClick={async () => {
        if (importing) return
        setImporting(true)
        try {
          const res = await fetch(apiPath('/api/admin/integrations/stripe/import-invoices'), { method: 'POST' })
          const json = await res.json() as { imported?: number; updated?: number; skipped?: number; error?: string; message?: string }
          if (res.ok) {
            showToast(`Stripe: ${json.imported ?? 0} imported, ${json.updated ?? 0} updated, ${json.skipped ?? 0} skipped`)
            created()
          } else showToast(json.message ?? json.error ?? 'Import failed')
        } catch { showToast('Import failed, check connection') }
        finally { setImporting(false) }
      }}>{importing ? 'Importing...' : 'Import from Stripe'}</TahiButton>
      <TahiButton size="sm" style={{ minHeight: '2.75rem' }} disabled={disabled} onClick={() => setShowCreate(true)} iconLeft={<Plus size={14} />}>Create invoice</TahiButton>
    </PageHeader>
    {disabled && <p className="text-xs" role="status" style={{ margin: 0, color: 'var(--color-text-muted)' }}>
      {ledger.loading ? 'Reading the full ledger before enabling create, import and export.' : ledger.scopeNone ? 'Create, import and export need a client in your scope.' : 'Create, import and export are unavailable until the complete ledger can be read.'}
    </p>}
    {ledger.complete && !ledger.scopeNone ? <InvoicesBand invoices={ledger.items} currency={displayCurrency} rates={exchangeRates} />
      : ledger.loading ? <SkeletonKPIStrip cells={4} /> : <p className="text-xs" style={{ margin: 0, color: 'var(--color-text-muted)' }}>Ledger totals are unavailable.</p>}
    <RailLayout rail={<InvoicesRail {...rail} />} railTouch={<InvoicesRail {...rail} touch />} railLabel="Invoice views and filters" sheetTitle="Invoice filters"
      chips={chips} onClearChip={chip => setFilters({ ...filters, [chip.key]: DEFAULT_INVOICE_FILTERS[chip.key as keyof InvoiceFilters] })} onClearAll={clear}
      query={query} onQueryChange={setQuery} searchPlaceholder="Search client, reference or rail ID" total={rows.length} itemNoun="invoice"
      loading={ledger.loading} countOverride={!ledger.complete ? (denied ? 'Access denied' : readProblem ? 'Ledger incomplete' : 'Loading') : undefined}
      extraActiveCount={view === 'all' ? 0 : 1}>
      {(denied || ledger.scopeNone || readProblem) && <Card padding="none"><EmptyState icon={denied || ledger.scopeNone ? <Lock size={24} /> : <AlertTriangle size={24} />}
        title={ledger.capped ? 'The ledger read reached its limit' : stateTitle}
        description={denied ? 'Ask Liam to grant invoice access to your seat.' : ledger.scopeNone ? 'Invoices follow the clients you can see. Ask Liam to widen your access and this fills in.'
          : ledger.capped ? `Only the first ${ledger.items.length} invoices were read. Totals and view counts are withheld.`
            : 'Nothing has changed on any invoice. The read is incomplete, so totals and view counts are withheld.'}
        action={!denied && !ledger.scopeNone ? <TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} onClick={() => void ledger.mutate()} iconLeft={<RefreshCw size={14} />}>Retry</TahiButton> : undefined} /></Card>}
      {!denied && !ledger.scopeNone && (ledger.items.length > 0 || !readProblem) && <Card padding="none">
        {!ledger.complete && ledger.items.length > 0 && <p className="text-xs" role="status" style={{ margin: 0, padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>These are loaded rows only. Filters and search do not cover the complete ledger yet.</p>}
        <DataTable<StudioInvoice> className="invoice-ledger-table" ariaLabel="Invoices" columns={columns} rows={rows} getRowId={inv => inv.id}
          defaultSort={{ key: 'createdAt', dir: 'desc' }} loading={ledger.loading && ledger.items.length === 0}
          mobileCard={inv => <InvoiceMobileRow invoice={inv} currency={displayCurrency} rates={exchangeRates} />}
          cardBreakpoint="xl"
          onRowClick={inv => router.push(`/invoices/${inv.id}`)}
          empty={<EmptyState icon={<FileText size={24} />} title={ledger.items.length === 0 ? 'No invoices yet' : 'Nothing matches that'}
            description={ledger.items.length === 0 ? 'Raise the first one and it lands here with everything the studio needs to chase it.' : 'Try another view, or clear the search and filters.'}
            action={ledger.items.length === 0 ? <TahiButton style={{ minHeight: '2.75rem' }} disabled={disabled} onClick={() => setShowCreate(true)}>Create invoice</TahiButton> : <TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} onClick={clear}>See all invoices</TahiButton>} />} />
      </Card>}
    </RailLayout>
    <CreateInvoice open={showCreate} onClose={() => setShowCreate(false)} onCreated={created} />
  </div>
}
