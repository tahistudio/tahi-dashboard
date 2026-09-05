'use client'

/** The client Invoices tab. */

import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { DollarSign, Plus } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { StatusBadge } from '@/components/tahi/status-badge'
import { TahiButton } from '@/components/tahi/tahi-button'

// ── Invoices tab ───────────────────────────────────────────────────────────────

export interface InvoiceRow {
  id: string
  orgId: string
  orgName: string | null
  status: string
  totalAmount: number
  currency: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

export function InvoicesTab({ clientId }: { clientId: string }) {
  const router = useRouter()

  const { data, isLoading: loading } = useSWR<{ items: InvoiceRow[] }>(
    `/api/admin/invoices?orgId=${clientId}`,
  )
  const invoices = data?.items ?? []

  const formatTabDate = (dateStr: string | null): string => {
    if (!dateStr) return '--'
    return new Date(dateStr).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      render: r => <StatusBadge status={r.status} type="invoice" />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      width: '10rem',
      render: r => (
        <span data-private style={{ fontWeight: 600, color: 'var(--color-text)' }}>
          ${(r.totalAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'currency',
      header: 'Currency',
      muted: true,
      render: r => r.currency ?? 'USD',
    },
    {
      key: 'dueDate',
      header: 'Due date',
      muted: true,
      render: r => formatTabDate(r.dueDate),
    },
    {
      key: 'createdAt',
      header: 'Created',
      muted: true,
      render: r => formatTabDate(r.createdAt),
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Invoices</h2>
        <TahiButton variant="primary" size="sm" onClick={() => router.push('/invoices')}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New invoice
        </TahiButton>
      </div>

      <Card padding="none">
        <DataTable<InvoiceRow>
          ariaLabel="Invoices"
          columns={columns}
          rows={invoices}
          getRowId={r => r.id}
          loading={loading}
          onRowClick={r => router.push(`/invoices/${r.id}`)}
          empty={
            <EmptyState
              variant="inline"
              icon={<DollarSign className="w-8 h-8" />}
              title="No invoices for this client yet"
            />
          }
        />
      </Card>
    </div>
  )
}
