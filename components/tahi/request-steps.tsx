'use client'

/**
 * RequestSteps
 *
 * Renders nested steps (ClickUp-style) for a request.
 * Steps can be nested infinitely via parentStepId.
 *
 * Features:
 * - Check/uncheck individual steps
 * - Add new steps at any level (click "+ Add step" under parent)
 * - Inline title editing on click
 * - Delete step (admin only)
 * - Progress bar showing overall completion
 */

import { useState, useRef, useEffect } from 'react'
import { apiPath } from '@/lib/api'
import { Plus, Check, ChevronDown, ChevronRight, Trash2, Loader2 } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StepNode {
  id: string
  requestId: string
  parentStepId: string | null
  title: string
  description: string | null
  completed: boolean | null
  completedAt: string | null
  orderIndex: number | null
  assigneeId: string | null
  createdAt: string
  updatedAt: string
  children: StepNode[]
}

interface RequestStepsProps {
  requestId: string
  isAdmin?: boolean
  initialSteps?: StepNode[]
}

// ── Step item ─────────────────────────────────────────────────────────────────

function StepItem({
  step, requestId, isAdmin, depth = 0, onUpdate, onDelete, onAddChild,
}: {
  step: StepNode
  requestId: string
  isAdmin: boolean
  depth?: number
  onUpdate: (id: string, updates: Partial<StepNode>) => void
  onDelete: (id: string) => void
  onAddChild: (parentId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(step.title)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasChildren = step.children.length > 0
  const indent = depth * 1.25  // rem per level

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  async function toggleComplete() {
    setSaving(true)
    try {
      const apiBase = isAdmin
        ? apiPath(`/api/admin/requests/${requestId}/steps/${step.id}`)
        : apiPath(`/api/portal/requests/${requestId}/steps/${step.id}`)
      const res = await fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !step.completed }),
      })
      if (res.ok) {
        onUpdate(step.id, { completed: !step.completed })
      }
    } finally {
      setSaving(false)
    }
  }

  async function saveTitle() {
    setEditing(false)
    if (title.trim() === step.title) return
    if (!title.trim()) { setTitle(step.title); return }
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/steps/${step.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      })
      if (res.ok) {
        onUpdate(step.id, { title: title.trim() })
      } else {
        setTitle(step.title)
      }
    } catch {
      setTitle(step.title)
    }
  }

  async function deleteStep() {
    try {
      await fetch(apiPath(`/api/admin/requests/${requestId}/steps/${step.id}`), { method: 'DELETE' })
      onDelete(step.id)
    } catch { /* ignore */ }
  }

  return (
    <div style={{ marginLeft: depth > 0 ? `${indent}rem` : 0 }}>
      <div
        className="group"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.3125rem 0.25rem',
          borderRadius: 'var(--radius-button)',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* Expand/collapse toggle */}
        <button
          type="button"
          onClick={() => hasChildren && setExpanded(!expanded)}
          style={{
            width: '1rem', flexShrink: 0, border: 'none', background: 'transparent',
            color: 'var(--color-text-subtle)', cursor: hasChildren ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          }}
        >
          {hasChildren
            ? (expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
            : <span style={{ width: 11 }} />
          }
        </button>

        {/* Checkbox */}
        <button
          type="button"
          onClick={toggleComplete}
          disabled={saving}
          style={{
            width: '1.125rem', height: '1.125rem', flexShrink: 0,
            borderRadius: '0.25rem',
            border: step.completed ? 'none' : '1.5px solid var(--color-border)',
            background: step.completed ? 'var(--color-brand)' : 'transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.1s', padding: 0,
          }}
        >
          {saving
            ? <Loader2 size={9} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} />
            : step.completed
              ? <Check size={10} style={{ color: 'white' }} />
              : null
          }
        </button>

        {/* Title */}
        {editing ? (
          <input
            ref={inputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitle(step.title); setEditing(false) } }}
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: '0.8125rem', color: 'var(--color-text)',
              background: 'transparent', padding: 0, fontFamily: 'inherit',
            }}
          />
        ) : (
          <span
            onClick={() => isAdmin && setEditing(true)}
            style={{
              flex: 1,
              fontSize: '0.8125rem',
              color: step.completed ? 'var(--color-text-subtle)' : 'var(--color-text)',
              textDecoration: step.completed ? 'line-through' : 'none',
              cursor: isAdmin ? 'text' : 'default',
              lineHeight: 1.4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {step.title}
          </span>
        )}

        {/* Actions — only on hover */}
        <div style={{ display: 'flex', gap: '0.125rem', opacity: 0, transition: 'opacity 0.1s' }}
          className="group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onAddChild(step.id)}
            title="Add sub-step"
            style={{
              width: '1.25rem', height: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '0.25rem',
              color: 'var(--color-text-subtle)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)'; e.currentTarget.style.color = 'var(--color-brand)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
          >
            <Plus size={11} />
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={deleteStep}
              title="Delete step"
              style={{
                width: '1.25rem', height: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '0.25rem',
                color: 'var(--color-text-subtle)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-bg)'; e.currentTarget.style.color = 'var(--color-danger)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div style={{ borderLeft: '1.5px solid var(--color-border-subtle)', marginLeft: `${indent + 0.8}rem` }}>
          {step.children.map(child => (
            <StepItem
              key={child.id}
              step={child}
              requestId={requestId}
              isAdmin={isAdmin}
              depth={depth + 1}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function countSteps(steps: StepNode[]): { total: number; done: number } {
  let total = 0; let done = 0
  function walk(nodes: StepNode[]) {
    for (const n of nodes) {
      total++
      if (n.completed) done++
      if (n.children.length > 0) walk(n.children)
    }
  }
  walk(steps)
  return { total, done }
}

// ── Main component ────────────────────────────────────────────────────────────

export function RequestSteps({ requestId, isAdmin = false, initialSteps = [] }: RequestStepsProps) {
  const [steps, setSteps] = useState<StepNode[]>(initialSteps)
  const [loading, setLoading] = useState(initialSteps.length === 0)
  const [addingAt, setAddingAt] = useState<string | null>(null)  // parentStepId or 'root'
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  const apiBase = isAdmin
    ? apiPath(`/api/admin/requests/${requestId}/steps`)
    : apiPath(`/api/portal/requests/${requestId}/steps`)

  useEffect(() => {
    if (initialSteps.length > 0) return
    fetch(apiBase)
      .then(r => r.json() as Promise<{ steps: StepNode[] }>)
      .then(data => setSteps(data.steps ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [requestId])

  useEffect(() => {
    if (addingAt !== null && addInputRef.current) {
      addInputRef.current.focus()
    }
  }, [addingAt])

  // Flatten updater: find a step by id anywhere in the tree and update it
  function updateStep(id: string, updates: Partial<StepNode>) {
    setSteps(prev => updateInTree(prev, id, updates))
  }

  function deleteStep(id: string) {
    setSteps(prev => removeFromTree(prev, id))
  }

  async function addStep(parentStepId: string | null) {
    if (!newTitle.trim()) { setAddingAt(null); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { title: newTitle.trim(), orderIndex: 999 }
      if (parentStepId) body.parentStepId = parentStepId

      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json() as { step: StepNode & { children?: StepNode[] } }
        const newStep: StepNode = { ...data.step, children: [] }
        if (parentStepId) {
          setSteps(prev => addToParent(prev, parentStepId, newStep))
        } else {
          setSteps(prev => [...prev, newStep])
        }
      }
    } finally {
      setSaving(false)
      setAddingAt(null)
      setNewTitle('')
    }
  }

  const { total, done } = countSteps(steps)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0', color: 'var(--color-text-subtle)', fontSize: '0.8125rem' }}>
        <Loader2 size={13} className="animate-spin" /> Loading steps…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* Header + progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Steps
        </span>
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <div style={{ flex: 1, height: '0.25rem', borderRadius: '99px', background: 'var(--color-border-subtle)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-brand)', borderRadius: '99px', transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap' }}>
              {done}/{total}
            </span>
          </div>
        )}
      </div>

      {/* Step tree */}
      {steps.length > 0 && (
        <div>
          {steps.map(step => (
            <StepItem
              key={step.id}
              step={step}
              requestId={requestId}
              isAdmin={isAdmin}
              onUpdate={updateStep}
              onDelete={deleteStep}
              onAddChild={(parentId) => { setAddingAt(parentId); setNewTitle('') }}
            />
          ))}
        </div>
      )}

      {/* Inline add form */}
      {addingAt !== null ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          marginLeft: addingAt !== 'root' ? '2.5rem' : 0,
          padding: '0.375rem 0.5rem',
          borderRadius: 'var(--radius-button)',
          border: '1.5px solid var(--color-brand)',
          background: 'var(--color-brand-50)',
        }}>
          <div style={{
            width: '1.125rem', height: '1.125rem',
            borderRadius: '0.25rem', border: '1.5px solid var(--color-border)',
            flexShrink: 0,
          }} />
          <input
            ref={addInputRef}
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addStep(addingAt === 'root' ? null : addingAt)
              if (e.key === 'Escape') { setAddingAt(null); setNewTitle('') }
            }}
            placeholder="Step title…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: '0.8125rem', color: 'var(--color-text)',
              background: 'transparent', padding: 0, fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={() => addStep(addingAt === 'root' ? null : addingAt)}
            disabled={saving || !newTitle.trim()}
            style={{
              fontSize: '0.75rem', fontWeight: 600,
              color: 'var(--color-brand-dark)',
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => { setAddingAt(null); setNewTitle('') }}
            style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setAddingAt('root'); setNewTitle('') }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.375rem 0.5rem',
            fontSize: '0.8125rem', fontWeight: 500,
            color: 'var(--color-text-subtle)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            borderRadius: 'var(--radius-button)',
            transition: 'all 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-brand)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
        >
          <Plus size={13} />
          Add step
        </button>
      )}
    </div>
  )
}

// ── Tree utilities ────────────────────────────────────────────────────────────

function updateInTree(nodes: StepNode[], id: string, updates: Partial<StepNode>): StepNode[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, ...updates }
    if (n.children.length > 0) return { ...n, children: updateInTree(n.children, id, updates) }
    return n
  })
}

function removeFromTree(nodes: StepNode[], id: string): StepNode[] {
  return nodes
    .filter(n => n.id !== id)
    .map(n => ({ ...n, children: removeFromTree(n.children, id) }))
}

function addToParent(nodes: StepNode[], parentId: string, newStep: StepNode): StepNode[] {
  return nodes.map(n => {
    if (n.id === parentId) return { ...n, children: [...n.children, newStep] }
    if (n.children.length > 0) return { ...n, children: addToParent(n.children, parentId, newStep) }
    return n
  })
}
