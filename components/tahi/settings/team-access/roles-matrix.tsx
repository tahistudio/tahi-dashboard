'use client'

/**
 * RolesMatrix - the role-by-feature grid.
 *
 * Reads GET /api/admin/permissions/matrix (role .view baselines + role-level
 * feature_visibility overrides, computed server-side with the same logic the
 * resolver enforces). Clicking a cell opens a small popover with the same
 * three-way control the slide-over uses; writes go to /feature-visibility with
 * subjectType 'role', optimistic with a refetch to reconcile.
 *
 * The super_admin column is locked: that role always has every feature.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import useSWR from 'swr'
import { Check, X, Lock } from 'lucide-react'
import { apiPath } from '@/lib/api'
import type { FeatureNode } from '@/lib/feature-tree'
import { Tri, type TriValue } from '@/components/tahi/settings/primitives'
import { TEAM_FEATURE_GROUPS, childrenFor } from './groups'
import { humaniseRole, type Effect } from './shared'
import type { ToastFn } from './feature-slideover'

interface MatrixRole {
  id: string
  name: string
  description: string | null
  locked: boolean
}

interface MatrixCell {
  base: Effect
  override: Effect | null
}

interface MatrixResponse {
  roles: MatrixRole[]
  featureKeys: string[]
  cells: Record<string, Record<string, MatrixCell>>
}

interface PopState {
  featureKey: string
  featureLabel: string
  roleId: string
  roleLabel: string
  x: number
  y: number
  current: TriValue
}

function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

export function RolesMatrix({ search, toast }: { search: string; toast: ToastFn }) {
  const { data, isLoading, mutate } = useSWR<MatrixResponse>('/api/admin/permissions/matrix')
  const [pop, setPop] = useState<PopState | null>(null)

  const roles = data?.roles ?? []
  const q = search.trim().toLowerCase()

  // Matrix rows: parent + child nodes per design group, filtered by search.
  const groups = useMemo(() => {
    return TEAM_FEATURE_GROUPS.map((g) => {
      const rows: Array<{ node: FeatureNode; child: boolean }> = g.nodes.flatMap((n) => [
        { node: n, child: false },
        ...childrenFor(n, 'team').map((c) => ({ node: c, child: true })),
      ])
      const filtered = q
        ? rows.filter(
            (r) => r.node.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q),
          )
        : rows
      return { label: g.label, rows: filtered }
    }).filter((g) => g.rows.length > 0)
  }, [q])

  const setCell = useCallback(
    async (featureKey: string, roleId: string, next: TriValue) => {
      setPop(null)
      // Optimistic: patch the cached cell, then reconcile with a refetch.
      void mutate(
        (prev) => {
          if (!prev) return prev
          const cellRow = prev.cells[featureKey]
          if (!cellRow || !cellRow[roleId]) return prev
          return {
            ...prev,
            cells: {
              ...prev.cells,
              [featureKey]: {
                ...cellRow,
                [roleId]: { ...cellRow[roleId], override: next === 'inherit' ? null : next },
              },
            },
          }
        },
        { revalidate: false },
      )
      try {
        const res = await fetch(apiPath('/api/admin/permissions/feature-visibility'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjectType: 'role', subjectId: roleId, featureKey, effect: next }),
        })
        if (!res.ok) throw new Error('Failed')
        toast(
          next === 'inherit' ? 'Saved: inheriting default' : next === 'allow' ? 'Saved: allowed' : 'Saved: denied',
          'ok',
        )
        void mutate()
      } catch {
        toast('Could not save change', 'err')
        void mutate()
      }
    },
    [mutate, toast],
  )

  if (isLoading && !data) {
    return (
      <div className="set-card" aria-busy="true" style={{ padding: 18 }}>
        <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ height: 30, borderRadius: 8, background: 'var(--bg-secondary)' }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mx-legend">
        <span className="mx-leg">
          <span className="mx-mark-a">
            <Check size={15} aria-hidden="true" />
          </span>
          Allowed
        </span>
        <span className="mx-leg">
          <span className="mx-mark-d">
            <X size={15} aria-hidden="true" />
          </span>
          Hidden
        </span>
        <span className="mx-leg">
          <span className="mx-mark-dot">-</span>
          Default
        </span>
        <span className="mx-leg">
          <span className="mx-ovrdot" style={{ position: 'static' }} />
          Override
        </span>
      </div>
      <div className="mx-scroll">
        <table className="mx">
          <colgroup>
            <col style={{ width: '16rem' }} />
            {roles.map((r) => (
              <col key={r.id} className="rolecol" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="mx-featcol" scope="col">
                Feature
              </th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className={r.locked ? 'mx-col-locked' : ''}>
                  {r.locked ? (
                    <span className="mx-lockhdr">
                      {humaniseRole(r.name)}
                      <span className="lk" title="Super admin always has every feature.">
                        <Lock size={12} aria-hidden="true" />
                      </span>
                    </span>
                  ) : (
                    humaniseRole(r.name)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <MatrixGroup key={g.label} label={g.label} rows={g.rows} roles={roles} cells={data?.cells ?? {}} onOpen={setPop} />
            ))}
          </tbody>
        </table>
      </div>
      {pop && <MatrixPop pop={pop} onSet={setCell} onClose={() => setPop(null)} />}
    </div>
  )
}

function MatrixGroup({
  label,
  rows,
  roles,
  cells,
  onOpen,
}: {
  label: string
  rows: Array<{ node: FeatureNode; child: boolean }>
  roles: MatrixRole[]
  cells: Record<string, Record<string, MatrixCell>>
  onOpen: (pop: PopState) => void
}) {
  return (
    <>
      <tr className="mx-grouprow">
        <td colSpan={roles.length + 1}>{label}</td>
      </tr>
      {rows.map(({ node, child }) => (
        <tr key={node.key} className="mx-frow">
          <td className="mx-featcol">
            <span className={'mx-featname' + (child ? ' child' : '')}>{node.label}</span>
          </td>
          {roles.map((role) => {
            const cell = cells[node.key]?.[role.id]
            const effective: Effect = cell ? cell.override ?? cell.base : 'allow'
            const hasOverride = !!cell?.override
            return (
              <td key={role.id} className={'mx-cell' + (role.locked ? ' mx-col-locked' : '')}>
                <button
                  type="button"
                  className="mx-cellbtn"
                  disabled={role.locked}
                  aria-label={
                    node.label +
                    ' for ' +
                    humaniseRole(role.name) +
                    ': ' +
                    (effective === 'allow' ? 'allowed' : 'hidden') +
                    (role.locked ? '' : '. Edit')
                  }
                  onClick={(e) => {
                    if (role.locked) return
                    const r = e.currentTarget.getBoundingClientRect()
                    onOpen({
                      featureKey: node.key,
                      featureLabel: node.label,
                      roleId: role.id,
                      roleLabel: humaniseRole(role.name),
                      x: r.left,
                      y: r.bottom,
                      current: cell?.override ?? 'inherit',
                    })
                  }}
                >
                  {effective === 'allow' ? (
                    <span className="mx-mark-a">
                      <Check size={16} aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="mx-mark-d">
                      <X size={16} aria-hidden="true" />
                    </span>
                  )}
                  {hasOverride && <span className="mx-ovrdot" />}
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

function MatrixPop({
  pop,
  onSet,
  onClose,
}: {
  pop: PopState
  onSet: (featureKey: string, roleId: string, next: TriValue) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(pop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 250)),
    top: pop.y + 6,
  }

  return (
    <BodyPortal>
      <div className="mx-cellpop" ref={ref} style={style}>
        <div className="cp-t">
          {pop.featureLabel} - {pop.roleLabel}
        </div>
        <Tri value={pop.current} onChange={(v) => onSet(pop.featureKey, pop.roleId, v)} label={pop.featureLabel} />
      </div>
    </BodyPortal>
  )
}
