'use client'

/** The client Contracts tab. */

import useSWR from 'swr'
import { Download, ScrollText } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'

// ── Contracts tab ─────────────────────────────────────────────────────────────

export interface ContractRow {
  id: string
  type: string
  name: string
  status: string
  storageKey: string
  startDate: string | null
  expiryDate: string | null
  createdAt: string
}

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  nda: 'NDA',
  sla: 'SLA',
  msa: 'MSA',
  sow: 'SOW',
  other: 'Other',
}

export const CONTRACT_STATUS_TONES: Record<string, BadgeTone> = {
  draft:     'neutral',
  sent:      'info',
  signed:    'positive',
  expired:   'danger',
  cancelled: 'neutral',
}

export function ContractsTab({ clientId }: { clientId: string }) {
  const { data, isLoading: loading } = useSWR<{ items: ContractRow[] }>(
    `/api/admin/contracts?orgId=${clientId}`,
  )
  const contracts = data?.items ?? []

  const columns: DataTableColumn<ContractRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: r => (
        <div className="flex items-center gap-2 font-medium text-[var(--color-text)]">
          <ScrollText className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
          {r.name}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: r => (
        <Badge tone="neutral" size="sm">{CONTRACT_TYPE_LABELS[r.type] ?? r.type}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: r => <Badge tone={CONTRACT_STATUS_TONES[r.status] ?? 'neutral'} size="sm" className="capitalize">{r.status}</Badge>,
    },
    {
      key: 'expiry',
      header: 'Expiry',
      muted: true,
      render: r => r.expiryDate
        ? new Date(r.expiryDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
        : '--',
    },
    {
      key: 'download',
      header: '',
      align: 'right',
      width: '8rem',
      render: r => (
        <a
          href={apiPath(`/api/uploads/serve/${r.storageKey}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] font-medium"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Contracts ({contracts.length})</h2>
      </div>

      <Card padding="none">
        <DataTable<ContractRow>
          ariaLabel="Contracts"
          columns={columns}
          rows={contracts}
          getRowId={r => r.id}
          loading={loading}
          empty={
            <EmptyState
              variant="inline"
              icon={<ScrollText className="w-8 h-8" />}
              title="No contracts for this client yet"
              description="Upload contracts from the contracts page."
            />
          }
        />
      </Card>
    </div>
  )
}
