'use client'

/** The client Activity tab: the audit trail for this organisation. */

import useSWR from 'swr'
import { Activity } from 'lucide-react'
import { EmptyState } from '@/components/tahi/empty-state'
import { SkeletonList } from '@/components/tahi/skeletons'

// ── Activity tab ──────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  action: string
  entityType: string | null
  createdAt: string
  details: string | null
}

export function ActivityTab({ clientId }: { clientId: string }) {
  const { data, isLoading: loading } = useSWR<{ items: AuditEntry[] }>(
    `/api/admin/audit-log?orgId=${clientId}&limit=50`,
  )
  const entries = data?.items ?? []

  if (loading) {
    return (
      <SkeletonList rows={4} />
    )
  }

  return (
    <div>
      <h2 className="font-semibold text-[var(--color-text)] mb-4">Activity Log</h2>

      {entries.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<Activity className="w-8 h-8" />}
          title="No activity recorded for this client yet"
        />
      ) : (
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {entries.map(entry => (
              <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Activity className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--color-text)]">{entry.action}</p>
                  {entry.details && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{entry.details}</p>
                  )}
                </div>
                <span className="text-xs text-[var(--color-text-subtle)] flex-shrink-0 whitespace-nowrap">
                  {new Date(entry.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
