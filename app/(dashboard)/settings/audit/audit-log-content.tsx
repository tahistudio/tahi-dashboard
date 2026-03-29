'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Shield, ArrowLeft, RefreshCw, ChevronLeft, ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'
import Link from 'next/link'

interface AuditEntry {
  id: string
  actorId: string | null
  actorType: string | null
  action: string
  entityType: string | null
  entityId: string | null
  metadata: string | null
  ipAddress: string | null
  createdAt: string
}

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'login', label: 'Login' },
  { value: 'impersonated', label: 'Impersonated' },
  { value: 'status_changed', label: 'Status Changed' },
]

const ENTITY_OPTIONS = [
  { value: '', label: 'All Entities' },
  { value: 'request', label: 'Requests' },
  { value: 'client', label: 'Clients' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'task', label: 'Tasks' },
  { value: 'team_member', label: 'Team Members' },
  { value: 'conversation', label: 'Conversations' },
  { value: 'contract', label: 'Contracts' },
  { value: 'automation', label: 'Automations' },
]

export function AuditLogContent() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  // Filters
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      if (actionFilter) params.set('action', actionFilter)
      if (entityFilter) params.set('entityType', entityFilter)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)

      const res = await fetch(apiPath(`/api/admin/audit?${params.toString()}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { items: AuditEntry[] }
      setEntries(data.items ?? [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter, entityFilter, dateFrom, dateTo])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  function formatTimestamp(iso: string): string {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors"
            aria-label="Back to settings"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Audit Log</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              View a history of all admin actions across the dashboard.
            </p>
          </div>
        </div>
        <TahiButton variant="secondary" size="sm" onClick={fetchEntries} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
      </div>

      {/* Filters */}
      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <select
              value={actionFilter}
              onChange={e => { setActionFilter(e.target.value); setPage(1) }}
              className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 pr-8 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] appearance-none"
              aria-label="Filter by action"
            >
              {ACTION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)] pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={entityFilter}
              onChange={e => { setEntityFilter(e.target.value); setPage(1) }}
              className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 pr-8 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] appearance-none"
              aria-label="Filter by entity type"
            >
              {ENTITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)] pointer-events-none" />
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(1) }}
            placeholder="From"
            className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            aria-label="Date from"
          />

          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(1) }}
            placeholder="To"
            className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            aria-label="Date to"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Shield className="w-8 h-8 text-white" />}
          title="No audit entries found"
          description="Audit log entries will appear here as actions are performed across the dashboard."
        />
      ) : (
        <>
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Timestamp</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Actor</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Action</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Entity</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Entity ID</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => (
                    <tr key={entry.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                        {formatTimestamp(entry.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text)]">
                        <div className="flex items-center gap-1">
                          <span className="font-mono">{entry.actorId?.slice(0, 8) ?? '-'}</span>
                          {entry.actorType && (
                            <span className="text-[var(--color-text-subtle)]">({entry.actorType})</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ActionBadge action={entry.action} />
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text)] capitalize">
                        {entry.entityType?.replace('_', ' ') ?? '-'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
                        {entry.entityId?.slice(0, 8) ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] max-w-xs truncate">
                        {entry.metadata ? summarizeMetadata(entry.metadata) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--color-text-muted)]">
              Page {page} - Showing {entries.length} entries
            </p>
            <div className="flex items-center gap-2">
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                iconLeft={<ChevronLeft className="w-3.5 h-3.5" />}
              >
                Previous
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={entries.length < 50}
                iconLeft={<ChevronRight className="w-3.5 h-3.5" />}
              >
                Next
              </TahiButton>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    created: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
    updated: { bg: 'var(--color-info-bg)', text: 'var(--color-info)' },
    deleted: { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
    login: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
    impersonated: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)' },
    status_changed: { bg: 'var(--color-info-bg)', text: 'var(--color-info)' },
  }

  const c = colorMap[action] ?? { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)' }

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
      style={{ background: c.bg, color: c.text }}
    >
      {action.replace('_', ' ')}
    </span>
  )
}

function summarizeMetadata(metadataJson: string): string {
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>
    const keys = Object.keys(parsed)
    if (keys.length === 0) return '-'
    // Show first few key-value pairs
    return keys.slice(0, 3).map(k => `${k}: ${String(parsed[k]).slice(0, 30)}`).join(', ')
  } catch {
    return metadataJson.slice(0, 50)
  }
}
