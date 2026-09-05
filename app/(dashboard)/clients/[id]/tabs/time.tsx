'use client'

/** The client Time tab: hours logged against this client. */

import useSWR from 'swr'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'

// ── Time tab ──────────────────────────────────────────────────────────────────

export interface TimeEntryRow {
  id: string
  hours: number
  billable: boolean | null
  notes: string | null
  date: string
  teamMemberName: string | null
  requestTitle: string | null
}

export function TimeTab({ clientId }: { clientId: string }) {
  const { data, isLoading: loading } = useSWR<{ items: TimeEntryRow[] }>(
    `/api/admin/time?orgId=${clientId}`,
  )
  const entries = data?.items ?? []

  const totalHours = entries.reduce((s, e) => s + e.hours, 0)
  const billableHours = entries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)

  const columns: DataTableColumn<TimeEntryRow>[] = [
    {
      key: 'date',
      header: 'Date',
      muted: true,
      render: r => new Date(r.date.includes('T') ? r.date : r.date + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }),
    },
    {
      key: 'teamMember',
      header: 'Team member',
      render: r => (
        <span className="font-medium text-[var(--color-text)]">{r.teamMemberName ?? 'Unknown'}</span>
      ),
    },
    {
      key: 'hours',
      header: 'Hours',
      render: r => (
        <span className="font-semibold text-[var(--color-text)]">{r.hours.toFixed(1)}h</span>
      ),
    },
    {
      key: 'billable',
      header: 'Billable',
      render: r => (
        <Badge tone={r.billable ? 'positive' : 'neutral'} size="sm">{r.billable ? 'Yes' : 'No'}</Badge>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      muted: true,
      wrap: true,
      render: r => <span className="block max-w-[12.5rem] truncate">{r.notes ?? '--'}</span>,
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          Time entries ({entries.length})
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-text-muted)]">
            Total: <strong className="text-[var(--color-text)]">{totalHours.toFixed(1)}h</strong>
          </span>
          <span className="text-[var(--color-text-muted)]">
            Billable: <strong style={{ color: 'var(--color-brand)' }}>{billableHours.toFixed(1)}h</strong>
          </span>
        </div>
      </div>

      <Card padding="none">
        <DataTable<TimeEntryRow>
          ariaLabel="Time entries"
          columns={columns}
          rows={entries}
          getRowId={r => r.id}
          loading={loading}
          empty={
            <EmptyState
              variant="inline"
              icon={<Clock className="w-8 h-8" />}
              title="No time entries for this client yet"
            />
          }
        />
      </Card>
    </div>
  )
}
