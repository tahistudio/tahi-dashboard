'use client'

/**
 * AuditLogSection - the immutable action log, searchable and filterable.
 *
 * Pixel-perfect port of the design's Audit pane: .ta-switchrow toolbar with a
 * .ta-search pill + "All actions" select, then a .hist-wrap/.hist table
 * (When / Who / Action / Target) closed by a .hist-foot count line.
 *
 * Data is real: it reads /api/admin/audit?resolveNames=1 (GET), which returns
 * auditLog rows with actorName/entityName resolved server-side (team members
 * by Clerk id; team_member / organisation / role entities by id). The select
 * filters server-side via the endpoint's ?actionPrefix= param using the
 * prefixes the app actually writes (permission.*, subscription.*, contract*).
 * The text box filters the loaded page client-side, debounced.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { SectionShell } from '@/components/tahi/settings/primitives'

interface AuditRow {
  id: string
  actorId: string | null
  actorType: string | null
  actorName?: string | null
  action: string
  entityType: string | null
  entityId: string | null
  entityName?: string | null
  metadata: string | null
  ipAddress: string | null
  createdAt: string
}

interface AuditResponse {
  items: AuditRow[]
  page: number
  limit: number
}

// Filter options map to real auditLog.action prefixes written by the app
// (permission.* from the Team & access surfaces, subscription.* from portal
// change requests, contract* from the signing emailer). The endpoint matches
// them server-side via ?actionPrefix=.
const ACTION_FILTERS: [string, string][] = [
  ['', 'All actions'],
  ['permission.', 'Permissions'],
  ['subscription.', 'Subscriptions'],
  ['contract', 'Contracts'],
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
  if (r.actorName) return r.actorName
  if (!r.actorId || r.actorType === 'system') return 'System'
  // Unresolved Clerk id: show a short honest form rather than the full token.
  return r.actorId.length > 14 ? r.actorId.slice(0, 14) + '…' : r.actorId
}

function actionLabel(action: string): string {
  if (!action) return 'Unknown'
  // 'permission.feature_override_set' -> 'Feature override set'
  const dot = action.indexOf('.')
  const tail = dot >= 0 ? action.slice(dot + 1) : action
  const words = tail.replace(/[._]/g, ' ').trim()
  if (!words) return 'Unknown'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function targetLabel(r: AuditRow): string {
  if (r.entityName) return r.entityName
  const type = r.entityType ? r.entityType.replace(/_/g, ' ') : null
  if (type && r.entityId) return `${type} ${r.entityId.slice(0, 8)}`
  return type ?? r.entityId ?? '-'
}

const SKELETON_WIDTHS: [number, number, number, number][] = [
  [86, 64, 190, 96],
  [92, 52, 150, 110],
  [80, 70, 210, 88],
  [88, 58, 170, 102],
]

function SkeletonCell({ width }: { width: number }) {
  return (
    <span
      className="animate-pulse"
      style={{
        display: 'block',
        height: 11,
        width,
        maxWidth: '100%',
        borderRadius: 6,
        background: 'var(--border-subtle)',
      }}
    />
  )
}

export function AuditLogSection(_props: { isAdmin?: boolean } = {}) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [actionPrefix, setActionPrefix] = useState('')

  // Debounce the free-text filter so typing doesn't churn the table.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(t)
  }, [query])

  const url =
    '/api/admin/audit?resolveNames=1' +
    (actionPrefix ? `&actionPrefix=${encodeURIComponent(actionPrefix)}` : '')
  const { data, isLoading } = useResource<AuditResponse>(url)
  const rows = useMemo(() => data?.items ?? [], [data])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const haystack = [formatWhen(r.createdAt), whoLabel(r), actionLabel(r.action), targetLabel(r)]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, debouncedQuery])

  const searching = debouncedQuery.trim().length > 0
  const footText = searching
    ? `Showing ${filtered.length} of the last ${rows.length} action${rows.length === 1 ? '' : 's'}.`
    : rows.length === 1
      ? 'Showing the last action.'
      : `Showing the last ${rows.length} actions.`

  return (
    <SectionShell title="Audit log" lede="Every action, logged and searchable.">
      <div className="ta-switchrow" style={{ marginBottom: 14 }}>
        <div className="ta-search">
          <Search size={16} aria-hidden="true" />
          <input
            placeholder="Filter actions"
            aria-label="Filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="set-input"
          style={{ maxWidth: 160 }}
          value={actionPrefix}
          onChange={(e) => setActionPrefix(e.target.value)}
          aria-label="Filter by action type"
        >
          {ACTION_FILTERS.map(([value, label]) => (
            <option key={value || 'all'} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="hist-wrap">
        <table className="hist">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              SKELETON_WIDTHS.map((w, i) => (
                <tr key={i} aria-hidden="true">
                  <td className="h-when">
                    <SkeletonCell width={w[0]} />
                  </td>
                  <td className="h-who">
                    <SkeletonCell width={w[1]} />
                  </td>
                  <td className="h-change">
                    <SkeletonCell width={w[2]} />
                  </td>
                  <td className="h-target">
                    <SkeletonCell width={w[3]} />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    textAlign: 'center',
                    padding: '28px 14px',
                    color: 'var(--text-faint)',
                  }}
                >
                  {searching || actionPrefix
                    ? 'No actions match your filter.'
                    : 'No actions logged yet.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="h-when">{formatWhen(r.createdAt)}</td>
                  <td className="h-who">{whoLabel(r)}</td>
                  <td className="h-change">
                    <b>{actionLabel(r.action)}</b>
                  </td>
                  <td className="h-target">{targetLabel(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!isLoading && filtered.length > 0 && <div className="hist-foot">{footText}</div>}
      </div>
    </SectionShell>
  )
}
