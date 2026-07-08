'use client'

/**
 * AuditLogSection - the immutable action log, searchable and filterable.
 *
 * Data is real: it reads /api/admin/audit (GET), which returns raw auditLog
 * rows (actorId, actorType, action, entityType, entityId, metadata, createdAt).
 * The action filter maps to the endpoint's ?action= query param; the search box
 * filters the loaded page client-side across when / who / action / target,
 * because the endpoint has no free-text search parameter.
 *
 * The endpoint resolves neither actor nor target to a display name, so "Who"
 * shows the actor id (falling back to actor type) and "Target" shows the entity
 * type and a short id. That is the honest shape of what /api/admin/audit gives.
 *
 * The design mocked a `.hist` table and a `.ta-search` control that do not
 * exist in settings.css, so the table and search field are built with inline
 * styles that reference existing CSS variables (no hardcoded hex).
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { Search } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { SectionShell, EmptyRow } from '@/components/tahi/settings/primitives'

interface AuditRow {
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

interface AuditResponse {
  items: AuditRow[]
}

// Filter select values map to distinct auditLog.action values.
const ACTION_FILTERS: [string, string][] = [
  ['', 'All actions'],
  ['created', 'Created'],
  ['updated', 'Updated'],
  ['deleted', 'Deleted'],
]

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(d)
    .replace(/\s/g, '')
    .toLowerCase()
  return `${date} ${time}`
}

function whoLabel(r: AuditRow): string {
  return r.actorId ?? r.actorType ?? 'System'
}

function actionLabel(action: string): string {
  if (!action) return 'Unknown'
  return action.charAt(0).toUpperCase() + action.slice(1).replace(/_/g, ' ')
}

function targetLabel(r: AuditRow): string {
  if (r.entityType && r.entityId) {
    return `${r.entityType} ${r.entityId.slice(0, 8)}`
  }
  return r.entityType ?? r.entityId ?? '-'
}

const TH_STYLE: CSSProperties = {
  textAlign: 'left',
  font: "700 11px 'Manrope', sans-serif",
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--text-faint)',
  padding: '0 14px 10px',
  whiteSpace: 'nowrap',
}

const TD_STYLE: CSSProperties = {
  padding: '11px 14px',
  borderTop: '1px solid var(--border-subtle)',
  font: "500 13px 'Manrope', sans-serif",
  color: 'var(--text)',
  verticalAlign: 'top',
}

export function AuditLogSection(_props: { isAdmin?: boolean } = {}) {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')

  const url = action ? `/api/admin/audit?action=${encodeURIComponent(action)}` : '/api/admin/audit'
  const { data, isLoading } = useResource<AuditResponse>(url)
  const rows = useMemo(() => data?.items ?? [], [data])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => {
      const haystack = [
        formatWhen(r.createdAt),
        whoLabel(r),
        actionLabel(r.action),
        targetLabel(r),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, query])

  return (
    <SectionShell title="Audit log" lede="Every action, logged and searchable.">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              color: 'var(--text-faint)',
              pointerEvents: 'none',
            }}
          >
            <Search size={16} />
          </span>
          <input
            className="set-input"
            style={{ paddingLeft: 36 }}
            placeholder="Filter actions"
            aria-label="Filter actions"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <select
          className="set-input"
          style={{ maxWidth: 160 }}
          value={action}
          onChange={e => setAction(e.target.value)}
          aria-label="Filter by action type"
        >
          {ACTION_FILTERS.map(([value, label]) => (
            <option key={value || 'all'} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="set-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <EmptyRow text="Loading audit log..." />
        ) : filtered.length === 0 ? (
          <EmptyRow text={query ? 'No actions match your filter.' : 'No actions logged yet.'} />
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH_STYLE, paddingTop: 14 }}>When</th>
                    <th style={{ ...TH_STYLE, paddingTop: 14 }}>Who</th>
                    <th style={{ ...TH_STYLE, paddingTop: 14 }}>Action</th>
                    <th style={{ ...TH_STYLE, paddingTop: 14 }}>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...TD_STYLE, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatWhen(r.createdAt)}
                      </td>
                      <td style={{ ...TD_STYLE, whiteSpace: 'nowrap' }}>{whoLabel(r)}</td>
                      <td style={TD_STYLE}>
                        <b style={{ fontWeight: 600 }}>{actionLabel(r.action)}</b>
                      </td>
                      <td style={{ ...TD_STYLE, color: 'var(--text-muted)' }}>{targetLabel(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              style={{
                padding: '11px 14px',
                borderTop: '1px solid var(--border-subtle)',
                font: "500 12px 'Manrope', sans-serif",
                color: 'var(--text-faint)',
              }}
            >
              Showing the {filtered.length === 1 ? 'only' : `most recent ${filtered.length}`}{' '}
              {filtered.length === 1 ? 'action' : 'actions'}.
            </div>
          </>
        )}
      </div>
    </SectionShell>
  )
}
