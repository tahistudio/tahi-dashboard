'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, ChevronDown, ChevronRight, Briefcase, Clock } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'

// -- Types --

interface OrgMember {
  id: string
  name: string
  email: string
  title: string | null
  role: string
  department: string | null
  parsedRoles: string[]
  avatarUrl: string | null
  weeklyCapacityHours: number | null
  reportsToId: string | null
  children: OrgNode[]
}

interface PlannedRole {
  id: string
  title: string
  department: string | null
  priority: string
  status: string
  estimatedStartDate: string | null
  weeklyCapacityHours: number | null
  reportsToId: string | null
  children: OrgNode[]
}

type OrgNode = { type: 'member' } & OrgMember | { type: 'planned' } & PlannedRole

// -- Department colors --
const DEPT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  leadership:  { bg: 'var(--color-brand-50)',    text: 'var(--color-brand)',      border: 'var(--color-brand-light)' },
  design:      { bg: '#f3e8ff',                  text: '#7c3aed',                 border: '#c4b5fd' },
  development: { bg: '#eff6ff',                  text: '#2563eb',                 border: '#93c5fd' },
  strategy:    { bg: '#fff7ed',                  text: '#ea580c',                 border: '#fdba74' },
  operations:  { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)', border: 'var(--color-border)' },
  marketing:   { bg: '#fdf2f8',                  text: '#db2777',                 border: '#f9a8d4' },
}

function getDeptStyle(dept: string | null) {
  return DEPT_COLORS[dept?.toLowerCase() ?? ''] ?? DEPT_COLORS.operations
}

// -- Helpers --

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// -- Node Components --

function MemberNode({ node, depth = 0 }: { node: OrgMember & { type: 'member' }; depth?: number }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const deptStyle = getDeptStyle(node.department)

  return (
    <div style={{ marginLeft: depth > 0 ? '2rem' : '0' }}>
      {/* Connector line */}
      {depth > 0 && (
        <div
          className="border-l-2"
          style={{
            borderColor: 'var(--color-border-subtle)',
            height: '1.5rem',
            marginLeft: '1.25rem',
          }}
        />
      )}

      <div
        className="rounded-xl border bg-[var(--color-bg)] p-4 hover:shadow-md transition-shadow cursor-pointer"
        style={{ borderColor: 'var(--color-border)', maxWidth: '20rem' }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {/* Avatar */}
          {node.avatarUrl ? (
            <img
              src={node.avatarUrl}
              alt={node.name}
              className="flex-shrink-0"
              style={{
                width: '2.75rem', height: '2.75rem',
                borderRadius: 'var(--radius-leaf-sm)',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              className="flex-shrink-0 flex items-center justify-center brand-gradient text-white font-semibold text-sm"
              style={{
                width: '2.75rem', height: '2.75rem',
                borderRadius: 'var(--radius-leaf-sm)',
              }}
            >
              {getInitials(node.name)}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[var(--color-text)] truncate">
                {node.name}
              </p>
              {hasChildren && (
                expanded
                  ? <ChevronDown style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                  : <ChevronRight style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
              )}
            </div>

            {/* Roles as badges */}
            <div className="flex flex-wrap gap-1 mt-1">
              {node.parsedRoles.length > 0 ? (
                node.parsedRoles.map((role, i) => (
                  <span
                    key={i}
                    className="text-xs font-medium rounded-full"
                    style={{
                      padding: '0.0625rem 0.5rem',
                      background: deptStyle.bg,
                      color: deptStyle.text,
                      border: `1px solid ${deptStyle.border}`,
                    }}
                  >
                    {role}
                  </span>
                ))
              ) : (
                <span
                  className="text-xs font-medium rounded-full"
                  style={{
                    padding: '0.0625rem 0.5rem',
                    background: deptStyle.bg,
                    color: deptStyle.text,
                    border: `1px solid ${deptStyle.border}`,
                  }}
                >
                  {node.title ?? node.role}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Capacity */}
        {node.weeklyCapacityHours && (
          <div className="flex items-center gap-1.5 mt-2">
            <Clock style={{ width: '0.625rem', height: '0.625rem', color: 'var(--color-text-subtle)' }} />
            <span className="text-xs text-[var(--color-text-subtle)]">
              {node.weeklyCapacityHours}h/week
            </span>
          </div>
        )}

        {/* Department badge */}
        {node.department && (
          <div className="mt-2">
            <span
              className="text-xs rounded px-1.5 py-0.5 font-medium capitalize"
              style={{
                background: deptStyle.bg,
                color: deptStyle.text,
              }}
            >
              {node.department}
            </span>
          </div>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            child.type === 'member' ? (
              <MemberNode key={child.id} node={child as OrgMember & { type: 'member' }} depth={depth + 1} />
            ) : (
              <PlannedNode key={child.id} node={child as PlannedRole & { type: 'planned' }} depth={depth + 1} />
            )
          ))}
        </div>
      )}
    </div>
  )
}

function PlannedNode({ node, depth = 0 }: { node: PlannedRole & { type: 'planned' }; depth?: number }) {
  const deptStyle = getDeptStyle(node.department)
  const priorityColor = node.priority === 'high' ? 'var(--color-danger)' : node.priority === 'medium' ? 'var(--color-warning)' : 'var(--color-text-subtle)'

  return (
    <div style={{ marginLeft: depth > 0 ? '2rem' : '0' }}>
      {depth > 0 && (
        <div
          className="border-l-2"
          style={{
            borderColor: 'var(--color-border-subtle)',
            borderStyle: 'dashed',
            height: '1.5rem',
            marginLeft: '1.25rem',
          }}
        />
      )}

      <div
        className="rounded-xl border-2 border-dashed p-4"
        style={{ borderColor: 'var(--color-border)', maxWidth: '20rem', background: 'var(--color-bg-secondary)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex-shrink-0 flex items-center justify-center border-2 border-dashed"
            style={{
              width: '2.75rem', height: '2.75rem',
              borderRadius: 'var(--radius-leaf-sm)',
              borderColor: 'var(--color-border)',
            }}
          >
            <Briefcase style={{ width: '1rem', height: '1rem', color: 'var(--color-text-subtle)' }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text-muted)]">{node.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-xs font-medium rounded-full"
                style={{
                  padding: '0.0625rem 0.5rem',
                  background: deptStyle.bg,
                  color: deptStyle.text,
                  border: `1px solid ${deptStyle.border}`,
                }}
              >
                {node.department ?? 'Unassigned'}
              </span>
              <span
                className="text-xs font-medium"
                style={{ color: priorityColor }}
              >
                {node.priority} priority
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-subtle)]">
          <span className="capitalize">{node.status}</span>
          {node.estimatedStartDate && (
            <>
              <span>|</span>
              <span>Est. {new Date(node.estimatedStartDate).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}</span>
            </>
          )}
          {node.weeklyCapacityHours && (
            <>
              <span>|</span>
              <span>{node.weeklyCapacityHours}h/week</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// -- Main Component --

export function OrgChart() {
  const [tree, setTree] = useState<OrgNode[]>([])
  const [loading, setLoading] = useState(true)

  const fetchChart = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/team/org-chart'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { tree: OrgNode[] }
      setTree(data.tree)
    } catch {
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchChart() }, [fetchChart])

  if (loading) return <LoadingSkeleton rows={4} />

  if (tree.length === 0) {
    return (
      <EmptyState
        icon={<Users className="w-8 h-8 text-white" />}
        title="No org structure yet"
        description="Add reporting relationships to your team members to build the org chart."
      />
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Organisation Chart</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            Team structure and reporting hierarchy
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {tree.map(node => (
          node.type === 'member' ? (
            <MemberNode key={node.id} node={node as OrgMember & { type: 'member' }} />
          ) : (
            <PlannedNode key={node.id} node={node as PlannedRole & { type: 'planned' }} />
          )
        ))}
      </div>
    </div>
  )
}
