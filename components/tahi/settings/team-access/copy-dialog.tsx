'use client'

/**
 * CopyDialog - clone one subject's access onto another.
 *
 * Team members: role + data scope + feature overrides. Clients: feature
 * overrides. POST /api/admin/permissions/copy-access replaces the target's
 * access wholesale and audit-logs the copy; the pane refreshes its caches on
 * success.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { apiPath } from '@/lib/api'
import { TaSelect } from '@/components/tahi/settings/primitives'
import type { ToastFn } from './feature-slideover'
import {
  humaniseRole,
  humanisePlan,
  type SubjectMember,
  type SubjectOrg,
} from './shared'

function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

interface CopySource {
  id: string
  name: string
  summary: string
}

function memberSummary(m: SubjectMember, overrideCount: number | null): string {
  const role = m.roles[0] ? humaniseRole(m.roles[0].roleName) : 'No role'
  const scope =
    !m.scope || m.scope.scopeType === 'all_clients'
      ? 'all clients'
      : m.scope.scopeType === 'plan_type'
        ? humanisePlan(m.scope.planType) + ' plan clients'
        : 'sees ' + m.scope.orgIds.length + ' client' + (m.scope.orgIds.length === 1 ? '' : 's')
  const ovr = overrideCount === null ? '' : ', ' + overrideCount + ' override' + (overrideCount === 1 ? '' : 's')
  return role + ', ' + scope + ovr
}

export function CopyDialog({
  subjectType,
  target,
  members,
  orgs,
  toast,
  onClose,
  onCopied,
}: {
  subjectType: 'team_member' | 'organisation'
  target: { id: string; name: string }
  members: SubjectMember[]
  orgs: SubjectOrg[]
  toast: ToastFn
  onClose: () => void
  onCopied: () => void
}) {
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const options: CopySource[] =
    subjectType === 'team_member'
      ? members
          .filter((m) => m.id !== target.id)
          .map((m) => ({ id: m.id, name: m.name, summary: memberSummary(m, null) }))
      : orgs
          .filter((o) => o.id !== target.id)
          .map((o) => ({ id: o.id, name: o.name, summary: humanisePlan(o.planType) + ' plan' }))

  const source = options.find((o) => o.id === sourceId) ?? null

  async function copy() {
    if (!source || busy) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/permissions/copy-access'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectType, sourceId: source.id, targetId: target.id }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? 'Failed')
      }
      toast('Access copied from ' + source.name, 'ok')
      onCopied()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not copy access', 'err')
      setBusy(false)
    }
  }

  return (
    <BodyPortal>
      <div className="dlg-backdrop" onClick={onClose}>
        <div
          className="dlg"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Copy access from"
        >
          <h3>Copy access from</h3>
          <TaSelect
            value={sourceId}
            ariaLabel="Copy access source"
            display={
              source ? (
                source.name
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>
                  {subjectType === 'team_member' ? 'Choose a person' : 'Choose a client'}
                </span>
              )
            }
            opts={options.map((o) => ({ value: o.id, title: o.name, desc: o.summary }))}
            onChange={(v) => setSourceId(v)}
          />
          {source && <div className="dlg-preview">{source.summary}</div>}
          {source && (
            <div className="dlg-warn">
              This replaces {target.name}&apos;s current{' '}
              {subjectType === 'team_member' ? 'role, data scope, and feature overrides' : 'feature overrides'}.
            </div>
          )}
          <div className="dlg-foot">
            <button type="button" className="btn2" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn1" disabled={!source || busy} onClick={() => void copy()}>
              {busy ? 'Copying...' : 'Copy access'}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  )
}
