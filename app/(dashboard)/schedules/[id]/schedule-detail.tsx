'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Trash2, AlertTriangle, Share2, Copy, Diamond, Calendar } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { GanttGrid, type GanttRow, type RowOwner, type RowType } from '@/components/tahi/gantt-grid'
import { ShareAnalyticsCard } from '@/components/tahi/share-analytics-card'

interface Schedule {
  id: string
  orgId: string | null
  dealId: string | null
  title: string
  subtitle: string | null
  preparedFor: string | null
  preparedBy: string | null
  effectiveDate: string | null
  targetLaunchDate: string | null
  numberOfWeeks: number
  overviewHtml: string | null
  status: 'draft' | 'shared' | 'archived'
  publicShareToken: string | null
  publicSharedAt: string | null
  orgName: string | null
  dealTitle: string | null
  createdAt: string
  updatedAt: string
}

interface RowDraft {
  rowType: RowType
  label: string
  owner: RowOwner | null
  startWeek: number | null
  endWeek: number | null
  riskFlag: boolean
}

const OWNER_LABEL: Record<RowOwner, string> = {
  tahi: 'Tahi',
  client: 'Client',
  joint: 'Joint',
  tahi_parallel: 'Tahi (parallel)',
}

export function ScheduleDetail({ scheduleId }: { scheduleId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [rows, setRows] = useState<GanttRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RowDraft | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [sharing, setSharing] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { schedule: Schedule; rows: GanttRow[] }
      setSchedule(data.schedule)
      setRows(data.rows ?? [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [scheduleId])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // ── Top-level metadata: save on blur ────────────────────────────────
  const patchSchedule = useCallback(async (changes: Partial<Schedule>) => {
    setSchedule(prev => prev ? { ...prev, ...changes } : prev)
    try {
      await fetch(apiPath(`/api/admin/schedules/${scheduleId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
    } catch {
      showToast('Failed to save', 'error')
    }
  }, [scheduleId, showToast])

  // ── Add new row ──────────────────────────────────────────────────────
  async function addRow(rowType: RowType) {
    const defaultLabel: Record<RowType, string> = {
      section_header: 'New section',
      task: 'New task',
      gate: 'New gate',
      critical_gate: 'New critical gate',
    }
    const defaults: RowDraft = {
      rowType,
      label: defaultLabel[rowType],
      owner: rowType === 'task' ? 'tahi' : null,
      startWeek: rowType === 'section_header' ? null : 1,
      endWeek: rowType === 'section_header' ? null : (rowType === 'task' ? 2 : 1),
      riskFlag: false,
    }
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/rows`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaults),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { id: string }
      setEditingRowId(data.id)
      setDraft(defaults)
      await fetchAll()
    } catch {
      showToast('Failed to add row', 'error')
    }
  }

  function openRowEditor(row: GanttRow) {
    setEditingRowId(row.id)
    setDraft({
      rowType: row.rowType,
      label: row.label,
      owner: row.owner,
      startWeek: row.startWeek,
      endWeek: row.endWeek,
      riskFlag: !!row.riskFlag,
    })
  }

  async function saveRowDraft() {
    if (!editingRowId || !draft) return
    setSavingDraft(true)
    // Optimistic update so the bar moves before the server round-trip.
    setRows(prev => prev.map(r => r.id === editingRowId ? {
      ...r,
      rowType: draft.rowType,
      label: draft.label,
      owner: draft.owner,
      startWeek: draft.startWeek,
      endWeek: (draft.rowType === 'gate' || draft.rowType === 'critical_gate') ? draft.startWeek : draft.endWeek,
      riskFlag: draft.riskFlag ? 1 : 0,
    } : r))
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/rows/${editingRowId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error('Failed')
      setEditingRowId(null)
      setDraft(null)
    } catch {
      showToast('Failed to save row', 'error')
      await fetchAll() // restore
    } finally {
      setSavingDraft(false)
    }
  }

  async function deleteRow(rowId: string) {
    const previous = rows
    setRows(prev => prev.filter(r => r.id !== rowId))
    if (editingRowId === rowId) { setEditingRowId(null); setDraft(null) }
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/rows/${rowId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
    } catch {
      setRows(previous)
      showToast('Failed to delete row', 'error')
    }
  }

  async function deleteSchedule() {
    if (!schedule) return
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Schedule deleted', 'success')
      router.push('/schedules')
    } catch {
      showToast('Failed to delete schedule', 'error')
    }
  }

  // ── Share / unshare ──────────────────────────────────────────────────
  async function handleShare() {
    setSharing(true)
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/share`), { method: 'POST' })
      const data = await res.json() as { token?: string }
      if (!res.ok || !data.token) throw new Error('Failed')
      setSchedule(prev => prev ? { ...prev, status: 'shared', publicShareToken: data.token! } : prev)
      const url = `${window.location.origin}/dashboard/p/schedule/${data.token}`
      try {
        await navigator.clipboard.writeText(url)
        showToast('Public link copied to clipboard', 'success')
      } catch {
        showToast('Public link ready (copy from the field above)', 'success')
      }
    } catch {
      showToast('Failed to share', 'error')
    } finally {
      setSharing(false)
    }
  }

  async function handleUnshare() {
    setSharing(true)
    try {
      await fetch(apiPath(`/api/admin/schedules/${scheduleId}/share`), { method: 'DELETE' })
      setSchedule(prev => prev ? { ...prev, status: 'draft', publicShareToken: null } : prev)
      showToast('Public link revoked', 'success')
    } catch {
      showToast('Failed to revoke link', 'error')
    } finally {
      setSharing(false)
    }
  }

  if (loading || !schedule) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div className="animate-pulse rounded-xl" style={{ height: '8rem', background: 'var(--color-bg-secondary)', marginBottom: '1rem' }} />
        <div className="animate-pulse rounded-xl" style={{ height: '20rem', background: 'var(--color-bg-secondary)' }} />
      </div>
    )
  }

  const publicUrl = schedule.publicShareToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard/p/schedule/${schedule.publicShareToken}`
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Back */}
      <Link
        href="/schedules"
        className="inline-flex items-center"
        style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', textDecoration: 'none', gap: '0.375rem' }}
      >
        <ArrowLeft size={14} />
        All schedules
      </Link>

      {/* Cover header — editable */}
      <div
        style={{
          padding: '1.5rem 1.75rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <input
          type="text"
          value={schedule.subtitle ?? ''}
          onChange={e => setSchedule(prev => prev ? { ...prev, subtitle: e.target.value } : prev)}
          onBlur={e => patchSchedule({ subtitle: e.currentTarget.value || null })}
          placeholder="PROJECT SCHEDULE, GANTT"
          style={{
            display: 'block',
            width: '100%',
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            background: 'transparent',
            border: 'none',
            padding: 0,
            marginBottom: '0.5rem',
            outline: 'none',
          }}
        />
        <input
          type="text"
          value={schedule.title}
          onChange={e => setSchedule(prev => prev ? { ...prev, title: e.target.value } : prev)}
          onBlur={e => patchSchedule({ title: e.currentTarget.value || 'Untitled' })}
          placeholder="Schedule title"
          style={{
            display: 'block',
            width: '100%',
            fontSize: '1.5rem',
            fontWeight: 800,
            color: 'var(--color-text)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            outline: 'none',
            marginBottom: '1rem',
          }}
        />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1rem' }}>
          <FieldGroup label="Prepared for">
            <input
              type="text"
              value={schedule.preparedFor ?? ''}
              onChange={e => setSchedule(prev => prev ? { ...prev, preparedFor: e.target.value } : prev)}
              onBlur={e => patchSchedule({ preparedFor: e.currentTarget.value || null })}
              placeholder="Client name"
              style={metaInputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Prepared by">
            <input
              type="text"
              value={schedule.preparedBy ?? ''}
              onChange={e => setSchedule(prev => prev ? { ...prev, preparedBy: e.target.value } : prev)}
              onBlur={e => patchSchedule({ preparedBy: e.currentTarget.value || null })}
              placeholder="You / Tahi Studio"
              style={metaInputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Effective">
            <input
              type="date"
              value={schedule.effectiveDate ?? ''}
              onChange={e => patchSchedule({ effectiveDate: e.currentTarget.value || null })}
              style={metaInputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Target launch">
            <input
              type="date"
              value={schedule.targetLaunchDate ?? ''}
              onChange={e => patchSchedule({ targetLaunchDate: e.currentTarget.value || null })}
              style={metaInputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Weeks">
            <input
              type="number"
              min={1}
              max={52}
              value={schedule.numberOfWeeks}
              onChange={e => setSchedule(prev => prev ? { ...prev, numberOfWeeks: parseInt(e.target.value, 10) || 12 } : prev)}
              onBlur={e => {
                const n = parseInt(e.currentTarget.value, 10) || 12
                patchSchedule({ numberOfWeeks: Math.max(1, Math.min(52, n)) })
              }}
              style={metaInputStyle}
            />
          </FieldGroup>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
        <ToolbarButton onClick={() => addRow('section_header')} icon={<span style={{ fontWeight: 700 }}>§</span>}>
          Section
        </ToolbarButton>
        <ToolbarButton onClick={() => addRow('task')} icon={<Plus size={13} />}>
          Task
        </ToolbarButton>
        <ToolbarButton onClick={() => addRow('gate')} icon={<Diamond size={13} />}>
          Gate
        </ToolbarButton>
        <ToolbarButton onClick={() => addRow('critical_gate')} icon={<Diamond size={13} style={{ color: '#dc2626' }} />}>
          Critical gate
        </ToolbarButton>
        <div style={{ flex: 1 }} />
        {publicUrl ? (
          <>
            <button
              onClick={() => {
                navigator.clipboard.writeText(publicUrl).then(
                  () => showToast('Public link copied', 'success'),
                  () => showToast('Could not copy', 'error'),
                )
              }}
              className="inline-flex items-center"
              style={{
                padding: '0.4375rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                gap: '0.375rem',
                cursor: 'pointer',
              }}
              title={publicUrl}
            >
              <Copy size={13} />
              Copy public link
            </button>
            <button
              onClick={handleUnshare}
              disabled={sharing}
              className="inline-flex items-center"
              style={{
                padding: '0.4375rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                background: 'var(--color-bg)',
                color: 'var(--color-danger)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                gap: '0.375rem',
                cursor: sharing ? 'not-allowed' : 'pointer',
              }}
            >
              Revoke
            </button>
          </>
        ) : (
          <button
            onClick={handleShare}
            disabled={sharing}
            className="inline-flex items-center"
            style={{
              padding: '0.4375rem 0.75rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              background: 'var(--color-brand)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              gap: '0.375rem',
              cursor: sharing ? 'not-allowed' : 'pointer',
            }}
          >
            <Share2 size={13} />
            {sharing ? 'Generating…' : 'Get public link'}
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm('Delete this schedule? This cannot be undone.')) deleteSchedule()
          }}
          className="inline-flex items-center"
          style={{
            padding: '0.4375rem 0.75rem',
            fontSize: '0.75rem',
            fontWeight: 500,
            background: 'transparent',
            color: 'var(--color-text-subtle)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            gap: '0.375rem',
            cursor: 'pointer',
          }}
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      {/* Gantt grid */}
      <GanttGrid
        rows={rows}
        numberOfWeeks={schedule.numberOfWeeks}
        onRowClick={openRowEditor}
      />

      {/* Inline row editor */}
      {editingRowId && draft && (
        <RowEditor
          draft={draft}
          numberOfWeeks={schedule.numberOfWeeks}
          saving={savingDraft}
          onChange={setDraft}
          onSave={saveRowDraft}
          onDelete={() => deleteRow(editingRowId)}
          onCancel={() => { setEditingRowId(null); setDraft(null) }}
        />
      )}

      {/* Legend */}
      <div
        className="flex flex-wrap"
        style={{
          gap: '1rem',
          padding: '0.875rem 1rem',
          fontSize: '0.6875rem',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-muted)',
        }}
      >
        <LegendSwatch color="#5A824E" label="Tahi" />
        <LegendSwatch color="#1f2c1a" label="Client" />
        <LegendSwatch color="#d4a017" label="Joint" />
        <LegendSwatch color="#a8c89e" label="Tahi parallel" />
        <LegendSwatch riskOverlay label="Risk of delay" />
        <LegendDiamond label="Sign-off gate" />
        <LegendDiamond label="Critical gate" critical />
      </div>

      {/* Analytics — appears once the schedule has been shared at least once. */}
      {schedule.publicShareToken && (
        <ShareAnalyticsCard resourceType="schedule" resourceId={scheduleId} />
      )}
    </div>
  )
}

const metaInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.375rem 0.5rem',
  fontSize: '0.8125rem',
  fontWeight: 500,
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function ToolbarButton({
  onClick, icon, children,
}: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center"
      style={{
        padding: '0.4375rem 0.75rem',
        fontSize: '0.75rem',
        fontWeight: 500,
        background: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        gap: '0.375rem',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
    >
      {icon}
      {children}
    </button>
  )
}

function LegendSwatch({ color, label, riskOverlay }: { color?: string; label: string; riskOverlay?: boolean }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '0.375rem' }}>
      <span
        style={{
          width: '1rem',
          height: '0.625rem',
          background: riskOverlay
            ? 'repeating-linear-gradient(45deg, rgba(248,113,113,0.95) 0 4px, transparent 4px 8px)'
            : color,
          backgroundColor: riskOverlay ? '#5A824E' : undefined,
          borderRadius: '0.125rem',
        }}
      />
      {label}
    </span>
  )
}

function LegendDiamond({ label, critical }: { label: string; critical?: boolean }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '0.375rem' }}>
      <span
        style={{
          width: '0.625rem',
          height: '0.625rem',
          transform: 'rotate(45deg)',
          background: '#ffffff',
          border: critical ? '1.5px solid #dc2626' : '1.5px solid #5A824E',
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  )
}

// ── Row editor ──────────────────────────────────────────────────────────
function RowEditor({
  draft, numberOfWeeks, saving, onChange, onSave, onDelete, onCancel,
}: {
  draft: RowDraft
  numberOfWeeks: number
  saving: boolean
  onChange: (next: RowDraft) => void
  onSave: () => void
  onDelete: () => void
  onCancel: () => void
}) {
  const isGate = draft.rowType === 'gate' || draft.rowType === 'critical_gate'
  const isHeader = draft.rowType === 'section_header'

  return (
    <div
      style={{
        position: 'sticky',
        bottom: '1rem',
        padding: '1rem 1.25rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        zIndex: 5,
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
        <div className="flex items-center" style={{ gap: '0.5rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Editing row
          </span>
          <select
            value={draft.rowType}
            onChange={e => onChange({ ...draft, rowType: e.target.value as RowType })}
            style={{
              fontSize: '0.75rem',
              padding: '0.25rem 0.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            <option value="section_header">Section header</option>
            <option value="task">Task</option>
            <option value="gate">Sign-off gate</option>
            <option value="critical_gate">Critical gate</option>
          </select>
        </div>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}
        >
          Close
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <FieldGroup label="Label">
          <input
            type="text"
            value={draft.label}
            onChange={e => onChange({ ...draft, label: e.target.value })}
            autoFocus
            style={metaInputStyle}
          />
        </FieldGroup>

        {!isHeader && !isGate && (
          <FieldGroup label="Owner">
            <select
              value={draft.owner ?? 'tahi'}
              onChange={e => onChange({ ...draft, owner: e.target.value as RowOwner })}
              style={{ ...metaInputStyle, cursor: 'pointer' }}
            >
              {(['tahi', 'client', 'joint', 'tahi_parallel'] as RowOwner[]).map(o => (
                <option key={o} value={o}>{OWNER_LABEL[o]}</option>
              ))}
            </select>
          </FieldGroup>
        )}

        {!isHeader && (
          <FieldGroup label={isGate ? 'Week' : 'Start week'}>
            <input
              type="number"
              min={1}
              max={numberOfWeeks}
              value={draft.startWeek ?? ''}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                const sw = Number.isFinite(n) ? Math.max(1, Math.min(numberOfWeeks, n)) : null
                onChange({
                  ...draft,
                  startWeek: sw,
                  endWeek: isGate ? sw : draft.endWeek,
                })
              }}
              style={metaInputStyle}
            />
          </FieldGroup>
        )}

        {!isHeader && !isGate && (
          <FieldGroup label="End week">
            <input
              type="number"
              min={1}
              max={numberOfWeeks}
              value={draft.endWeek ?? ''}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                onChange({ ...draft, endWeek: Number.isFinite(n) ? Math.max(1, Math.min(numberOfWeeks, n)) : null })
              }}
              style={metaInputStyle}
            />
          </FieldGroup>
        )}

        {!isHeader && draft.rowType === 'task' && (
          <FieldGroup label="Risk overlay">
            <label className="inline-flex items-center" style={{ gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', cursor: 'pointer', height: '2.125rem' }}>
              <input
                type="checkbox"
                checked={draft.riskFlag}
                onChange={e => onChange({ ...draft, riskFlag: e.target.checked })}
                style={{ accentColor: 'var(--color-danger)' }}
              />
              <AlertTriangle size={13} style={{ color: 'var(--color-danger)' }} />
              At risk of delay
            </label>
          </FieldGroup>
        )}
      </div>

      <div className="flex items-center justify-end" style={{ gap: '0.5rem' }}>
        <button
          onClick={onDelete}
          className="inline-flex items-center"
          style={{
            padding: '0.4375rem 0.75rem',
            fontSize: '0.75rem',
            fontWeight: 500,
            background: 'transparent',
            color: 'var(--color-danger)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            gap: '0.375rem',
            cursor: 'pointer',
          }}
        >
          <Trash2 size={13} />
          Delete row
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '0.4375rem 0.75rem',
            fontSize: '0.75rem',
            fontWeight: 500,
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: '0.4375rem 0.875rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            background: 'var(--color-brand)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save row'}
        </button>
      </div>
    </div>
  )
}

// Re-export icons we don't otherwise reference from this file so the linter
// doesn't complain about the unused `Calendar` import inside the layout.
void Calendar
