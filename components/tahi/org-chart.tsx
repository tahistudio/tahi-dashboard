'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, ChevronDown, ChevronRight, Briefcase, Clock, Plus, X, Filter } from 'lucide-react'
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
// Categorical (neutral palette). No semantic status colours so we don't
// imply warning/danger where none exists.
const DEPT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  leadership:  { bg: 'var(--color-brand-50)',          text: 'var(--color-brand)',                  border: 'var(--color-brand-light)' },
  design:      { bg: 'var(--status-client-review-bg)', text: 'var(--status-client-review-text)',    border: 'var(--status-client-review-border)' },
  development: { bg: 'var(--status-submitted-bg)',     text: 'var(--status-submitted-text)',        border: 'var(--status-submitted-border)' },
  strategy:    { bg: 'var(--status-in-progress-bg)',   text: 'var(--status-in-progress-text)',      border: 'var(--status-in-progress-border)' },
  operations:  { bg: 'var(--color-bg-tertiary)',       text: 'var(--color-text-muted)',             border: 'var(--color-border)' },
  marketing:   { bg: 'var(--priority-urgent-bg)',      text: 'var(--priority-urgent-text)',         border: 'var(--priority-urgent-border)' },
}

function getDeptStyle(dept: string | null) {
  return DEPT_COLORS[dept?.toLowerCase() ?? ''] ?? DEPT_COLORS.operations
}

// -- Helpers --

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// -- Node Components --

function MemberNode({ node, depth = 0, onMemberClick }: { node: OrgMember & { type: 'member' }; depth?: number; onMemberClick?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true)
  const [hovered, setHovered] = useState(false)
  const hasChildren = node.children.length > 0
  const deptStyle = getDeptStyle(node.department)

  return (
    <div style={{ marginLeft: depth > 0 ? 'clamp(0.75rem, 3vw, 2rem)' : '0' }}>
      {/* Connector line */}
      {depth > 0 && (
        <div
          className="border-l-2 hidden sm:block"
          style={{
            borderColor: 'var(--color-border-subtle)',
            height: '1.5rem',
            marginLeft: '1.25rem',
          }}
        />
      )}

      <div
        className="rounded-xl border bg-[var(--color-bg)] p-3 sm:p-4 transition-shadow cursor-pointer"
        style={{
          borderColor: hovered ? 'var(--color-brand)' : 'var(--color-border)',
          maxWidth: '100%',
          boxShadow: hovered ? '0 4px 12px rgba(90, 130, 78, 0.15)' : 'none',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => {
          if (onMemberClick) {
            e.stopPropagation()
            onMemberClick(node.id)
          } else if (hasChildren) {
            setExpanded(!expanded)
          }
        }}
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
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
                  className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors"
                  style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                >
                  {expanded
                    ? <ChevronDown style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }} />
                    : <ChevronRight style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }} />
                  }
                </button>
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

        {/* Capacity utilization bar (T458) */}
        {node.weeklyCapacityHours != null && node.weeklyCapacityHours > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <Clock style={{ width: '0.625rem', height: '0.625rem', color: 'var(--color-text-subtle)' }} />
                <span className="text-xs text-[var(--color-text-subtle)]">{node.weeklyCapacityHours}h/week</span>
              </div>
            </div>
            <div style={{ width: '100%', height: '0.375rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }}>
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'var(--color-brand)',
                  borderRadius: '0.25rem',
                  opacity: 0.7,
                }}
              />
            </div>
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
              <MemberNode key={child.id} node={child as OrgMember & { type: 'member' }} depth={depth + 1} onMemberClick={onMemberClick} />
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
    <div style={{ marginLeft: depth > 0 ? 'clamp(0.75rem, 3vw, 2rem)' : '0' }}>
      {depth > 0 && (
        <div
          className="border-l-2 hidden sm:block"
          style={{
            borderColor: 'var(--color-border-subtle)',
            borderStyle: 'dashed',
            height: '1.5rem',
            marginLeft: '1.25rem',
          }}
        />
      )}

      <div
        className="rounded-xl border-2 border-dashed p-3 sm:p-4"
        style={{ borderColor: 'var(--color-border)', maxWidth: '100%', background: 'var(--color-bg-secondary)' }}
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

// -- Add Planned Role Form --

function AddPlannedRoleForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [priority, setPriority] = useState('medium')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inputStyle = {
    padding: '0.5rem 0.75rem',
    fontSize: '0.8125rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    width: '100%',
    outline: 'none',
  } as const

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }

    setSaving(true)
    setError('')
    try {
      const res = await fetch(apiPath('/api/admin/planned-roles'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          department: department.trim() || undefined,
          priority,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to create planned role')
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="rounded-xl border"
      style={{
        padding: '1rem 1.25rem',
        background: 'var(--color-bg)',
        borderColor: 'var(--color-border)',
        maxWidth: '24rem',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[var(--color-text)]">Add Planned Role</p>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors"
          style={{ border: 'none', background: 'none', cursor: 'pointer' }}
          aria-label="Cancel"
        >
          <X style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)' }} />
        </button>
      </div>

      {error && (
        <div
          className="text-xs rounded-lg mb-3"
          role="alert"
          style={{ padding: '0.375rem 0.625rem', background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
            Title <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Senior Designer"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
            Department
          </label>
          <select
            value={department}
            onChange={e => setDepartment(e.target.value)}
            style={inputStyle}
          >
            <option value="">Unassigned</option>
            <option value="leadership">Leadership</option>
            <option value="design">Design</option>
            <option value="development">Development</option>
            <option value="strategy">Strategy</option>
            <option value="operations">Operations</option>
            <option value="marketing">Marketing</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
            Priority
          </label>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            style={inputStyle}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
            style={{
              background: saving ? 'var(--color-text-subtle)' : 'var(--color-brand)',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              minHeight: '2rem',
            }}
          >
            {saving ? 'Saving...' : 'Add Role'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)',
              border: 'none',
              cursor: 'pointer',
              minHeight: '2rem',
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// -- Department filter helper --

function collectDepartments(nodes: OrgNode[]): string[] {
  const depts = new Set<string>()
  function walk(list: OrgNode[]) {
    for (const n of list) {
      if (n.department) depts.add(n.department.toLowerCase())
      if ('children' in n && n.children.length > 0) walk(n.children)
    }
  }
  walk(nodes)
  return Array.from(depts).sort()
}

function filterByDepartment(nodes: OrgNode[], dept: string): OrgNode[] {
  return nodes.reduce<OrgNode[]>((acc, node) => {
    const matches = node.department?.toLowerCase() === dept
    const filteredChildren = 'children' in node && node.children.length > 0
      ? filterByDepartment(node.children, dept)
      : []
    if (matches || filteredChildren.length > 0) {
      acc.push({ ...node, children: filteredChildren } as OrgNode)
    }
    return acc
  }, [])
}

// -- Main Component --

export function OrgChart() {
  const router = useRouter()
  const [tree, setTree] = useState<OrgNode[]>([])
  const [loading, setLoading] = useState(true)
  const [deptFilter, setDeptFilter] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

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

  const handleMemberClick = useCallback((memberId: string) => {
    router.push(`/team?member=${memberId}`)
  }, [router])

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

  const departments = collectDepartments(tree)
  const displayTree = deptFilter ? filterByDepartment(tree, deptFilter) : tree

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Organisation Chart</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            Team structure and reporting hierarchy
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Department filter */}
          {departments.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Filter style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)' }} />
              <select
                value={deptFilter}
                onChange={e => setDeptFilter(e.target.value)}
                className="text-sm rounded-lg border"
                style={{
                  padding: '0.375rem 0.625rem',
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="">All Departments</option>
                {departments.map(d => (
                  <option key={d} value={d} className="capitalize">{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Add Planned Role button */}
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white rounded-lg transition-colors"
            style={{
              padding: '0.5rem 0.875rem',
              background: 'var(--color-brand)',
              border: 'none',
              cursor: 'pointer',
              minHeight: '2.25rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-dark)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-brand)' }}
          >
            <Plus style={{ width: '0.75rem', height: '0.75rem' }} />
            Add Planned Role
          </button>
        </div>
      </div>

      {/* Inline add form */}
      {showAddForm && (
        <div style={{ marginBottom: '1.5rem' }}>
          <AddPlannedRoleForm
            onCreated={() => { setShowAddForm(false); fetchChart() }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      <div className="space-y-2">
        {displayTree.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]" style={{ padding: '1rem 0' }}>
            No team members in this department.
          </p>
        ) : (
          displayTree.map(node => (
            node.type === 'member' ? (
              <MemberNode key={node.id} node={node as OrgMember & { type: 'member' }} onMemberClick={handleMemberClick} />
            ) : (
              <PlannedNode key={node.id} node={node as PlannedRole & { type: 'planned' }} />
            )
          ))
        )}
      </div>
    </div>
  )
}
