'use client'

/**
 * ChangeHistory - the permission change trail.
 *
 * Backed by the real audit log: every permission mutation (role assignment,
 * feature override, data-scope change, copy-access) is written by its API
 * route via lib/audit.ts. This view reads /api/admin/audit filtered to the
 * permission.* action prefix with names resolved server-side, and humanises
 * each entry into the design's "Who did what to whom, and why" table.
 */

import useSWR from 'swr'
import { ArrowLeft } from 'lucide-react'
import {
  humaniseAudit,
  auditReason,
  formatWhen,
  initialsOf,
  type AuditItem,
} from './shared'

const ENTITY_LABELS: Record<string, string> = {
  team_member: 'Team member',
  organisation: 'Client',
  role: 'Role',
}

export function ChangeHistory({ onBack }: { onBack: () => void }) {
  const { data, isLoading } = useSWR<{ items: AuditItem[] }>(
    '/api/admin/audit?actionPrefix=permission.&resolveNames=1',
  )
  const items = data?.items ?? []

  return (
    <div>
      <button type="button" className="btn2 hist-back mb-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </button>
      <button type="button" className="btn-ghost hist-back" onClick={onBack} style={{ marginBottom: 14 }}>
        &larr; Team &amp; access
      </button>
      <div className="hist-wrap">
        <table className="hist">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Change</th>
              <th scope="col">Target</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-faint)' }}>
                  Loading history...
                </td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-faint)' }}>
                  No permission changes recorded yet.
                </td>
              </tr>
            )}
            {items.map((h) => {
              const who = h.actorName ?? (h.actorId ? 'Team member' : 'System')
              return (
                <tr key={h.id}>
                  <td className="h-when">{formatWhen(h.createdAt)}</td>
                  <td className="h-who">
                    <span className="wc">
                      <span className="subj-av">{initialsOf(who)}</span>
                      {who.split(' ')[0]}
                    </span>
                  </td>
                  <td className="h-change">
                    <b>{humaniseAudit(h)}</b>
                  </td>
                  <td className="h-target">
                    {h.entityName ?? '-'}
                    <span className="tp">{(h.entityType && ENTITY_LABELS[h.entityType]) ?? h.entityType ?? ''}</span>
                  </td>
                  <td className="h-reason">{auditReason(h)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="hist-foot">Showing the last {Math.min(items.length, 50)} changes.</div>
      </div>
    </div>
  )
}
