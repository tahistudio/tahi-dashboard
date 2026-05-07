'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, AlertTriangle, Share2, Copy, ExternalLink, Mail, Eye,
  Diamond, FileText, ChevronUp, ChevronDown, BarChart3, GitBranch, Grid3x3, AlignLeft,
} from 'lucide-react'
import { EmailShareModal, type EmailRecipientSuggestion } from '@/components/tahi/email-share-modal'
import { LinkedToPanel } from '@/components/tahi/linked-to-panel'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { GanttGrid, type GanttRow, type RowOwner, type RowType } from '@/components/tahi/gantt-grid'
import { GanttLegend } from '@/components/tahi/gantt-legend'
import { SectionRenderer, type ScheduleSection, type SectionType } from '@/components/tahi/schedule-section-renderers'
import { ShareAnalyticsCard } from '@/components/tahi/share-analytics-card'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
import {
  BuilderShell, builderHeader, builderTitleInput, builderGrid, builderNav, builderMain, builderRail,
  toolbarBtn, toolbarPrimary, railBtn, navAddBtn, metaInputStyle,
  BuilderMoreMenu, BuilderNavGroup, BuilderNavItem,
  RailSection, FieldGroup, SaveIndicator, BuilderEditorShell, statusPillStyle,
} from '@/components/tahi/builder'

interface Schedule {
  id: string
  orgId: string | null
  dealId: string | null
  proposalId: string | null
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

// Schedule-specific status palette. The shared statusPillStyle helper
// renders the visual; we just hand it the right colours per status. Keep
// in sync with the schedule list page chip palette.
const STATUS_PALETTE: Record<Schedule['status'], { bg: string; fg: string; bd: string }> = {
  draft:    { bg: '#f7f9f6', fg: '#5a6657', bd: '#e8f0e6' },
  shared:   { bg: '#eff6ff', fg: '#1e40af', bd: '#bfdbfe' },
  archived: { bg: '#f5f5f4', fg: '#525252', bd: '#e7e5e4' },
}

const OWNER_LABEL: Record<RowOwner, string> = {
  tahi: 'Tahi',
  client: 'Client',
  joint: 'Joint',
  tahi_parallel: 'Tahi (parallel)',
}

// Friendly labels + icons for the nav and editor headers, keyed by
// section type. Keep these in sync with the section renderer's switch.
const SECTION_LABEL: Record<SectionType, string> = {
  gantt: 'Gantt timeline',
  overview: 'Overview',
  risk_register: 'Risk register',
  raci_matrix: 'RACI matrix',
  text: 'Custom text',
}

function sectionIcon(type: SectionType) {
  switch (type) {
    case 'gantt':         return <GitBranch size={12} />
    case 'overview':      return <AlignLeft size={12} />
    case 'risk_register': return <AlertTriangle size={12} />
    case 'raci_matrix':   return <Grid3x3 size={12} />
    case 'text':          return <FileText size={12} />
    default:              return <FileText size={12} />
  }
}

// Order matches the "Add section" picker. Gantt comes first so users get
// a fresh timeline as the default, but most schedules will already have
// a gantt section seeded by the create endpoint.
const ADDABLE_SECTION_TYPES: ReadonlyArray<{ value: SectionType; label: string; hint: string }> = [
  { value: 'gantt',         label: 'Gantt timeline',  hint: 'Weekly tasks, gates, and owners' },
  { value: 'overview',      label: 'Overview',        hint: 'Executive intro paragraph' },
  { value: 'risk_register', label: 'Risk register',   hint: 'Risks, owners, mitigations' },
  { value: 'raci_matrix',   label: 'RACI matrix',     hint: 'Responsibility per workstream' },
  { value: 'text',          label: 'Custom text',     hint: 'Free-form section' },
]

export function ScheduleDetail({ scheduleId }: { scheduleId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [sections, setSections] = useState<ScheduleSection[]>([])
  const [loading, setLoading] = useState(true)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RowDraft | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; email: string; isPrimary: number }>>([])

  // Active view drives the centre pane:
  //   'cover'           → cover meta editor (title, prepared for/by, weeks, dates)
  //   `section:${id}`   → that section's editor
  //   'analytics'       → share analytics card
  const [activeView, setActiveView] = useState<string>('cover')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [showAddSectionMenu, setShowAddSectionMenu] = useState(false)

  // Save indicator state — tracks in-flight saves and the most recent
  // successful save timestamp. trackSave wraps any promise so the
  // SaveIndicator stays accurate.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [savingCount, setSavingCount] = useState(0)
  const trackSave = useCallback((promise: Promise<unknown>) => {
    setSavingCount(c => c + 1)
    void promise.finally(() => {
      setSavingCount(c => Math.max(0, c - 1))
      setLastSavedAt(Date.now())
    })
  }, [])

  async function ensureContacts() {
    if (!schedule?.orgId || contacts.length > 0) return
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${schedule.orgId}/contacts`))
      if (!res.ok) return
      const data = await res.json() as { contacts: Array<{ id: string; name: string; email: string; isPrimary: number }> }
      setContacts(data.contacts ?? [])
    } catch { /* silent */ }
  }

  const fetchAll = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { schedule: Schedule; sections?: ScheduleSection[]; rows?: GanttRow[] }
      setSchedule(data.schedule)
      // New shape: sections (post 0026). Fall back to a synthetic gantt
      // section built from flat rows if the server is older.
      if (data.sections && data.sections.length > 0) {
        setSections(data.sections)
      } else if (data.rows) {
        setSections([{
          id: 'fallback-gantt',
          type: 'gantt',
          title: 'Project schedule',
          subtitle: null,
          startWeek: null,
          endWeek: null,
          data: null,
          position: 0,
          rows: data.rows,
        }])
      } else {
        setSections([])
      }
    } catch {
      // silent
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [scheduleId])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // If the active view points to a section that's been deleted, fall back
  // to the cover so we never render a stale id.
  useEffect(() => {
    if (activeView.startsWith('section:')) {
      const id = activeView.slice('section:'.length)
      if (sections.length > 0 && !sections.some(s => s.id === id)) setActiveView('cover')
    }
  }, [activeView, sections])

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

  // The first gantt-typed section in display order. Toolbar buttons add
  // rows here; if a schedule has multiple gantts (zoomed sub-views), the
  // user picks which one to edit by selecting it in the navigator.
  const sortedSections = [...sections].sort((a, b) => a.position - b.position)
  const activeSectionId = activeView.startsWith('section:') ? activeView.slice('section:'.length) : null
  const activeSection = activeSectionId ? sortedSections.find(s => s.id === activeSectionId) ?? null : null

  // ── Section CRUD ────────────────────────────────────────────────────
  function defaultDataForSection(type: SectionType): unknown {
    switch (type) {
      case 'overview':      return { html: '<p>How this project runs.</p>' }
      case 'text':          return { html: '' }
      case 'risk_register': return { rows: [] }
      case 'raci_matrix':   return {
        columns: [
          { id: 'tahi', label: 'Tahi' },
          { id: 'client', label: 'Client' },
        ],
        rows: [],
      }
      case 'gantt':         return null
      default:              return null
    }
  }

  async function addSection(type: SectionType) {
    const seedTitles: Record<SectionType, { title: string; subtitle: string | null }> = {
      gantt:         { title: 'Project schedule',         subtitle: 'Whole project, one view' },
      overview:      { title: 'How it runs',              subtitle: 'Executive overview' },
      risk_register: { title: 'Risks and dependencies',   subtitle: 'What can slow this down' },
      raci_matrix:   { title: 'Who is responsible',       subtitle: 'RACI matrix' },
      text:          { title: 'New section',              subtitle: null },
    }
    const seed = seedTitles[type]
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/sections`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: seed.title,
          subtitle: seed.subtitle,
          data: defaultDataForSection(type),
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const created = await res.json() as { id: string }
      await fetchAll({ silent: true })
      setActiveView(`section:${created.id}`)
    } catch {
      showToast('Failed to add section', 'error')
    }
  }

  async function patchSection(sectionId: string, changes: { title?: string | null; subtitle?: string | null; startWeek?: number | null; endWeek?: number | null; data?: unknown }) {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s
      const next: ScheduleSection = { ...s }
      if (changes.title !== undefined) next.title = changes.title
      if (changes.subtitle !== undefined) next.subtitle = changes.subtitle
      if (changes.startWeek !== undefined) next.startWeek = changes.startWeek
      if (changes.endWeek !== undefined) next.endWeek = changes.endWeek
      if (changes.data !== undefined) next.data = changes.data === null ? null : JSON.stringify(changes.data)
      return next
    }))
    try {
      await fetch(apiPath(`/api/admin/schedules/${scheduleId}/sections/${sectionId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
    } catch {
      showToast('Failed to save section', 'error')
    }
  }

  async function deleteSection(sectionId: string) {
    const previous = sections
    setSections(prev => prev.filter(s => s.id !== sectionId))
    if (activeSectionId === sectionId) setActiveView('cover')
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/sections/${sectionId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
    } catch {
      setSections(previous)
      showToast('Failed to delete section', 'error')
    }
  }

  async function moveSection(sectionId: string, dir: -1 | 1) {
    const sorted = [...sections].sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex(s => s.id === sectionId)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= sorted.length) return
    // Optimistic swap of positions.
    const a = sorted[idx]
    const b = sorted[target]
    setSections(prev => prev.map(s => {
      if (s.id === a.id) return { ...s, position: b.position }
      if (s.id === b.id) return { ...s, position: a.position }
      return s
    }))
    // Reorder via the bulk endpoint so positions stay contiguous server-side.
    const newOrder = [...sorted]
    newOrder[idx] = b
    newOrder[target] = a
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/sections/reorder`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: newOrder.map(s => s.id) }),
      })
      if (!res.ok) throw new Error('Failed')
    } catch {
      await fetchAll({ silent: true })
      showToast('Failed to reorder', 'error')
    }
  }

  // ── Row CRUD (only meaningful inside a gantt section) ───────────────
  async function addRow(rowType: RowType) {
    if (!activeSection || activeSection.type !== 'gantt') {
      showToast('Pick a gantt section before adding rows', 'error')
      return
    }
    const defaultLabel: Record<RowType, string> = {
      section_header: 'New section',
      task: 'New task',
      gate: 'New gate',
      critical_gate: 'New critical gate',
    }
    // TODO (Task #31): clamp start/end week server-side against
    // schedule.numberOfWeeks. The client clamps below but a malformed
    // payload still slips through.
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
        body: JSON.stringify({ ...defaults, sectionId: activeSection.id }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { id: string }
      setEditingRowId(data.id)
      setDraft(defaults)
      await fetchAll({ silent: true })
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

  // Mutate rows in a specific section optimistically.
  function mutateGanttRows(sectionId: string, updater: (rows: GanttRow[]) => GanttRow[]) {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s
      return { ...s, rows: updater(s.rows ?? []) }
    }))
  }

  async function saveRowDraft() {
    if (!editingRowId || !draft || !activeSection) return
    setSavingDraft(true)
    // Optimistic update so the bar moves before the server round-trip.
    mutateGanttRows(activeSection.id, rows => rows.map(r => r.id === editingRowId ? {
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
      await fetchAll({ silent: true })
    } finally {
      setSavingDraft(false)
    }
  }

  async function deleteRow(rowId: string) {
    if (!activeSection) return
    const previousSections = sections
    mutateGanttRows(activeSection.id, rows => rows.filter(r => r.id !== rowId))
    if (editingRowId === rowId) { setEditingRowId(null); setDraft(null) }
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/${scheduleId}/rows/${rowId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
    } catch {
      setSections(previousSections)
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
        showToast('Public link ready', 'success')
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
    <BuilderShell className="schedule-builder">
      {/* Sticky top bar: back link, inline title edit, status pill, save state, actions */}
      <header style={builderHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', minWidth: 0, flex: 1 }}>
          <Link
            href="/schedules"
            aria-label="All schedules"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2rem', height: '2rem', borderRadius: '0.5rem', color: 'var(--color-text-muted)', flexShrink: 0 }}
            className="nav-item-hover"
          >
            <ArrowLeft size={16} />
          </Link>
          <div style={{ minWidth: 0, flex: 1 }}>
            <input
              type="text"
              value={schedule.title}
              onChange={e => setSchedule(p => p ? { ...p, title: e.target.value } : p)}
              onBlur={e => trackSave(patchSchedule({ title: e.currentTarget.value || 'Untitled' }))}
              placeholder="Untitled schedule"
              style={builderTitleInput}
            />
          </div>
          <span style={statusPillStyle(STATUS_PALETTE[schedule.status])}>{schedule.status}</span>
          <SaveIndicator savingCount={savingCount} lastSavedAt={lastSavedAt} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {publicUrl ? (
            <button
              onClick={() => { void ensureContacts(); setShowEmail(true) }}
              style={toolbarPrimary}
              title="Email the public link to a client"
            >
              <Mail size={13} />
              Email link
            </button>
          ) : (
            <button
              onClick={() => trackSave(handleShare())}
              disabled={sharing}
              style={toolbarPrimary}
              title="Generate a public link"
            >
              <Share2 size={13} />
              {sharing ? 'Generating' : 'Get public link'}
            </button>
          )}
          <Link
            href={`/preview/schedule/${scheduleId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center"
            style={toolbarBtn}
          >
            <Eye size={13} />
            Preview
          </Link>
          <BuilderMoreMenu
            open={moreMenuOpen}
            onToggle={() => setMoreMenuOpen(v => !v)}
            onClose={() => setMoreMenuOpen(false)}
            items={[
              { icon: <Trash2 size={13} />, label: 'Delete schedule', danger: true, onClick: () => setShowDeleteConfirm(true) },
            ]}
          />
        </div>
      </header>

      {/* Three-column main */}
      <div style={builderGrid} className="tahi-builder-grid">
        {/* Left navigator */}
        <aside style={builderNav} className="tahi-builder-nav">
          <BuilderNavGroup label="Schedule" count={1 + sortedSections.length}>
            <BuilderNavItem
              active={activeView === 'cover'}
              onClick={() => setActiveView('cover')}
              number={1}
              icon={<FileText size={12} />}
              label="Cover"
              hint={schedule.subtitle || 'Title, dates, prepared by'}
            />
            {sortedSections.map((s, i) => (
              <BuilderNavItem
                key={s.id}
                active={activeView === `section:${s.id}`}
                onClick={() => setActiveView(`section:${s.id}`)}
                number={i + 2}
                icon={sectionIcon(s.type)}
                label={s.title || SECTION_LABEL[s.type]}
                hint={SECTION_LABEL[s.type]}
              />
            ))}
            <AddSectionMenu
              open={showAddSectionMenu}
              onToggle={() => setShowAddSectionMenu(v => !v)}
              onClose={() => setShowAddSectionMenu(false)}
              onPick={(type) => {
                setShowAddSectionMenu(false)
                trackSave(addSection(type))
              }}
            />
          </BuilderNavGroup>

          {schedule.publicShareToken && (
            <BuilderNavGroup label="More">
              <BuilderNavItem
                active={activeView === 'analytics'}
                onClick={() => setActiveView('analytics')}
                icon={<BarChart3 size={12} />}
                label="Analytics"
                hint="View, time on page"
              />
            </BuilderNavGroup>
          )}
        </aside>

        {/* Centre editor — keyed by activeView so the fade-in plays on switch */}
        <main style={builderMain} key={activeView}>
          {activeView === 'cover' && (
            <CoverEditor
              schedule={schedule}
              setSchedule={setSchedule}
              onPatch={(p) => trackSave(patchSchedule(p))}
            />
          )}

          {activeSection && (
            <SectionEditorPane
              key={activeSection.id}
              schedule={schedule}
              section={activeSection}
              numberOfWeeks={schedule.numberOfWeeks}
              isFirst={sortedSections.findIndex(s => s.id === activeSection.id) === 0}
              isLast={sortedSections.findIndex(s => s.id === activeSection.id) === sortedSections.length - 1}
              slideNumber={sortedSections.findIndex(s => s.id === activeSection.id) + 2}
              onPatch={(changes) => trackSave(patchSection(activeSection.id, changes))}
              onMoveUp={() => trackSave(moveSection(activeSection.id, -1))}
              onMoveDown={() => trackSave(moveSection(activeSection.id, 1))}
              onDelete={() => trackSave(deleteSection(activeSection.id))}
              // Gantt-only props.
              ganttDraft={draft}
              ganttEditingRowId={editingRowId}
              ganttSavingDraft={savingDraft}
              onAddRow={addRow}
              onOpenRow={openRowEditor}
              onSaveRowDraft={saveRowDraft}
              onDeleteRow={() => editingRowId && deleteRow(editingRowId)}
              onCancelRowEdit={() => { setEditingRowId(null); setDraft(null) }}
              onChangeRowDraft={setDraft}
            />
          )}

          {activeView === 'analytics' && schedule.publicShareToken && (
            <BuilderEditorShell eyebrow="Analytics" kicker="View activity">
              <ShareAnalyticsCard resourceType="schedule" resourceId={scheduleId} />
            </BuilderEditorShell>
          )}
        </main>

        {/* Right rail — public link, linked-to, meta */}
        <aside style={builderRail} className="tahi-builder-rail">
          <RailSection title="Public link">
            {publicUrl ? (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{
                  padding: '0.5rem 0.625rem',
                  fontSize: '0.6875rem',
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-all',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                }}>
                  {publicUrl}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  <button
                    onClick={() => { void ensureContacts(); setShowEmail(true) }}
                    className="inline-flex items-center"
                    style={{ ...railBtn, background: 'var(--color-brand)', color: '#FFFFFF', borderColor: 'var(--color-brand)', flex: 1 }}
                  >
                    <Mail size={12} />
                    Email
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(publicUrl).then(
                        () => showToast('Public link copied', 'success'),
                        () => showToast('Could not copy', 'error'),
                      )
                    }}
                    className="inline-flex items-center"
                    style={railBtn}
                    title="Copy URL"
                  >
                    <Copy size={12} />
                    Copy
                  </button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center"
                    style={railBtn}
                    title="Open in new tab"
                  >
                    <ExternalLink size={12} />
                    Open
                  </a>
                </div>
                <button
                  onClick={() => trackSave(handleUnshare())}
                  disabled={sharing}
                  className="inline-flex items-center"
                  style={{ ...railBtn, color: 'var(--color-danger)', justifyContent: 'center' }}
                >
                  Revoke link
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                  Generate a public link to send the schedule to the client.
                </p>
                <button
                  onClick={() => trackSave(handleShare())}
                  disabled={sharing}
                  className="inline-flex items-center"
                  style={{ ...railBtn, background: 'var(--color-brand)', color: '#FFFFFF', borderColor: 'var(--color-brand)', justifyContent: 'center' }}
                >
                  <Share2 size={12} />
                  {sharing ? 'Generating' : 'Generate public link'}
                </button>
              </div>
            )}
          </RailSection>

          <RailSection title="Linked to">
            <LinkedToPanel
              resourceType="schedule"
              resourceId={scheduleId}
              orgId={schedule.orgId}
              dealId={schedule.dealId}
              proposalId={schedule.proposalId}
              orgName={schedule.orgName}
              dealTitle={schedule.dealTitle}
              onChanged={() => void fetchAll({ silent: true })}
            />
          </RailSection>

          <RailSection title="Meta">
            <div style={{ display: 'grid', gap: '0.625rem' }}>
              <FieldGroup label="Prepared for">
                <input
                  type="text"
                  value={schedule.preparedFor ?? ''}
                  onChange={e => setSchedule(p => p ? { ...p, preparedFor: e.target.value } : p)}
                  onBlur={e => trackSave(patchSchedule({ preparedFor: e.currentTarget.value || null }))}
                  placeholder="Client name"
                  style={metaInputStyle}
                />
              </FieldGroup>
              <FieldGroup label="Prepared by">
                <input
                  type="text"
                  value={schedule.preparedBy ?? ''}
                  onChange={e => setSchedule(p => p ? { ...p, preparedBy: e.target.value } : p)}
                  onBlur={e => trackSave(patchSchedule({ preparedBy: e.currentTarget.value || null }))}
                  placeholder="Tahi Studio"
                  style={metaInputStyle}
                />
              </FieldGroup>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <FieldGroup label="Effective">
                  <input
                    type="date"
                    value={schedule.effectiveDate ?? ''}
                    onChange={e => trackSave(patchSchedule({ effectiveDate: e.currentTarget.value || null }))}
                    style={metaInputStyle}
                  />
                </FieldGroup>
                <FieldGroup label="Target launch">
                  <input
                    type="date"
                    value={schedule.targetLaunchDate ?? ''}
                    onChange={e => trackSave(patchSchedule({ targetLaunchDate: e.currentTarget.value || null }))}
                    style={metaInputStyle}
                  />
                </FieldGroup>
              </div>
              <FieldGroup label="Number of weeks">
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={schedule.numberOfWeeks}
                  onChange={e => setSchedule(p => p ? { ...p, numberOfWeeks: parseInt(e.target.value, 10) || 12 } : p)}
                  onBlur={e => {
                    const n = parseInt(e.currentTarget.value, 10) || 12
                    trackSave(patchSchedule({ numberOfWeeks: Math.max(1, Math.min(52, n)) }))
                  }}
                  style={metaInputStyle}
                />
              </FieldGroup>
            </div>
          </RailSection>
        </aside>
      </div>

      <EmailShareModal
        open={showEmail}
        onClose={() => setShowEmail(false)}
        resourceLabel="schedule"
        resourceTitle={schedule.title}
        suggestions={contacts.map<EmailRecipientSuggestion>(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          badge: c.isPrimary ? 'Primary' : undefined,
        }))}
        postUrl={`/api/admin/schedules/${scheduleId}/email`}
        mode="recipients"
        onSent={({ sent }) => {
          if (sent > 0) showToast(`Sent ${sent} email${sent === 1 ? '' : 's'}.`, 'success')
        }}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this schedule?"
        description="Permanently removes the schedule, every section, and every Gantt row. Cannot be undone."
        confirmLabel="Delete schedule"
        variant="danger"
        onConfirm={async () => { setShowDeleteConfirm(false); await deleteSchedule() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </BuilderShell>
  )
}

// ─── Cover editor (centre pane for the cover slide) ─────────────────────

function CoverEditor({
  schedule, setSchedule, onPatch,
}: {
  schedule: Schedule
  setSchedule: React.Dispatch<React.SetStateAction<Schedule | null>>
  onPatch: (changes: Partial<Schedule>) => void
}) {
  return (
    <BuilderEditorShell eyebrow="Slide 1" kicker="Cover">
      <div style={{ display: 'grid', gap: '1rem', padding: '1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <FieldGroup label="Eyebrow">
          <input
            type="text"
            value={schedule.subtitle ?? ''}
            onChange={e => setSchedule(p => p ? { ...p, subtitle: e.target.value } : p)}
            onBlur={e => onPatch({ subtitle: e.currentTarget.value || null })}
            placeholder="PROJECT SCHEDULE"
            style={metaInputStyle}
          />
        </FieldGroup>
        <FieldGroup label="Title">
          <input
            type="text"
            value={schedule.title}
            onChange={e => setSchedule(p => p ? { ...p, title: e.target.value } : p)}
            onBlur={e => onPatch({ title: e.currentTarget.value || 'Untitled' })}
            style={{ ...metaInputStyle, fontSize: '1.125rem', fontWeight: 700, padding: '0.5rem 0.625rem' }}
          />
        </FieldGroup>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.875rem' }}>
          <FieldGroup label="Prepared for">
            <input type="text" value={schedule.preparedFor ?? ''} onChange={e => setSchedule(p => p ? { ...p, preparedFor: e.target.value } : p)} onBlur={e => onPatch({ preparedFor: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Prepared by">
            <input type="text" value={schedule.preparedBy ?? ''} onChange={e => setSchedule(p => p ? { ...p, preparedBy: e.target.value } : p)} onBlur={e => onPatch({ preparedBy: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Effective">
            <input type="date" value={schedule.effectiveDate ?? ''} onChange={e => onPatch({ effectiveDate: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Target launch">
            <input type="date" value={schedule.targetLaunchDate ?? ''} onChange={e => onPatch({ targetLaunchDate: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Number of weeks">
            <input
              type="number"
              min={1}
              max={52}
              value={schedule.numberOfWeeks}
              onChange={e => setSchedule(p => p ? { ...p, numberOfWeeks: parseInt(e.target.value, 10) || 12 } : p)}
              onBlur={e => {
                const n = parseInt(e.currentTarget.value, 10) || 12
                onPatch({ numberOfWeeks: Math.max(1, Math.min(52, n)) })
              }}
              style={metaInputStyle}
            />
          </FieldGroup>
        </div>
      </div>
    </BuilderEditorShell>
  )
}

// ─── Section editor pane (centre pane when a section is active) ─────────

function SectionEditorPane(props: {
  schedule: Schedule
  section: ScheduleSection
  numberOfWeeks: number
  isFirst: boolean
  isLast: boolean
  slideNumber: number
  onPatch: (changes: { title?: string | null; subtitle?: string | null; startWeek?: number | null; endWeek?: number | null; data?: unknown }) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  // Gantt row editing.
  ganttDraft: RowDraft | null
  ganttEditingRowId: string | null
  ganttSavingDraft: boolean
  onAddRow: (type: RowType) => void
  onOpenRow: (row: GanttRow) => void
  onSaveRowDraft: () => void
  onDeleteRow: () => void
  onCancelRowEdit: () => void
  onChangeRowDraft: (next: RowDraft) => void
}) {
  const { section, numberOfWeeks, isFirst, isLast, slideNumber, onPatch, onMoveUp, onMoveDown, onDelete } = props

  const actions = (
    <>
      {!isFirst && (
        <button onClick={onMoveUp} aria-label="Move up" style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem' }} title="Move up">
          <ChevronUp size={13} />
        </button>
      )}
      {!isLast && (
        <button onClick={onMoveDown} aria-label="Move down" style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem' }} title="Move down">
          <ChevronDown size={13} />
        </button>
      )}
      <button onClick={onDelete} aria-label="Delete section" style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem' }} title="Delete">
        <Trash2 size={13} />
      </button>
    </>
  )

  return (
    <BuilderEditorShell
      eyebrow={`Slide ${slideNumber}`}
      kicker={section.title || SECTION_LABEL[section.type]}
      actions={actions}
    >
      {/* Title + eyebrow */}
      <div style={{ display: 'grid', gap: '0.875rem', padding: '1.25rem 1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
          <FieldGroup label="Title">
            <input
              type="text"
              defaultValue={section.title ?? ''}
              onBlur={e => onPatch({ title: e.currentTarget.value || null })}
              style={metaInputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Eyebrow">
            <input
              type="text"
              defaultValue={section.subtitle ?? ''}
              onBlur={e => onPatch({ subtitle: e.currentTarget.value || null })}
              style={metaInputStyle}
            />
          </FieldGroup>
        </div>
      </div>

      {/* Type-specific editor */}
      {section.type === 'gantt' && (
        <GanttSectionEditor
          section={section}
          numberOfWeeks={numberOfWeeks}
          draft={props.ganttDraft}
          editingRowId={props.ganttEditingRowId}
          savingDraft={props.ganttSavingDraft}
          onAddRow={props.onAddRow}
          onOpenRow={props.onOpenRow}
          onSaveRowDraft={props.onSaveRowDraft}
          onDeleteRow={props.onDeleteRow}
          onCancelRowEdit={props.onCancelRowEdit}
          onChangeRowDraft={props.onChangeRowDraft}
          onPatchSection={onPatch}
        />
      )}

      {(section.type === 'overview' || section.type === 'text') && (
        <ProseSectionEditor section={section} onPatch={onPatch} />
      )}

      {(section.type === 'risk_register' || section.type === 'raci_matrix') && (
        <PreviewOnlySection section={section} numberOfWeeks={numberOfWeeks} />
      )}
    </BuilderEditorShell>
  )
}

// ─── Gantt section editor ────────────────────────────────────────────────

function GanttSectionEditor({
  section, numberOfWeeks, draft, editingRowId, savingDraft,
  onAddRow, onOpenRow, onSaveRowDraft, onDeleteRow, onCancelRowEdit, onChangeRowDraft,
  onPatchSection,
}: {
  section: ScheduleSection
  numberOfWeeks: number
  draft: RowDraft | null
  editingRowId: string | null
  savingDraft: boolean
  onAddRow: (type: RowType) => void
  onOpenRow: (row: GanttRow) => void
  onSaveRowDraft: () => void
  onDeleteRow: () => void
  onCancelRowEdit: () => void
  onChangeRowDraft: (next: RowDraft) => void
  onPatchSection: (changes: { startWeek?: number | null; endWeek?: number | null }) => void
}) {
  const rows = section.rows ?? []

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {/* Optional zoom range — lets a gantt section show only weeks N-M */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.625rem', padding: '0.875rem 1rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)' }}>
        <FieldGroup label="Zoom from week (optional)">
          <input
            type="number"
            min={1}
            max={numberOfWeeks}
            defaultValue={section.startWeek ?? ''}
            onBlur={e => {
              const v = e.currentTarget.value.trim()
              const n = parseInt(v, 10)
              onPatchSection({ startWeek: Number.isFinite(n) ? Math.max(1, Math.min(numberOfWeeks, n)) : null })
            }}
            placeholder="W1"
            style={metaInputStyle}
          />
        </FieldGroup>
        <FieldGroup label="Zoom to week (optional)">
          <input
            type="number"
            min={1}
            max={numberOfWeeks}
            defaultValue={section.endWeek ?? ''}
            onBlur={e => {
              const v = e.currentTarget.value.trim()
              const n = parseInt(v, 10)
              onPatchSection({ endWeek: Number.isFinite(n) ? Math.max(1, Math.min(numberOfWeeks, n)) : null })
            }}
            placeholder={`W${numberOfWeeks}`}
            style={metaInputStyle}
          />
        </FieldGroup>
      </div>

      {/* Toolbar — row creation */}
      <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
        <ToolbarButton onClick={() => onAddRow('section_header')} icon={<span style={{ fontWeight: 700 }}>§</span>}>
          Section
        </ToolbarButton>
        <ToolbarButton onClick={() => onAddRow('task')} icon={<Plus size={13} />}>
          Task
        </ToolbarButton>
        <ToolbarButton onClick={() => onAddRow('gate')} icon={<Diamond size={13} />}>
          Gate
        </ToolbarButton>
        <ToolbarButton onClick={() => onAddRow('critical_gate')} icon={<Diamond size={13} style={{ color: '#dc2626' }} />}>
          Critical gate
        </ToolbarButton>
      </div>

      {/* The grid itself */}
      <GanttGrid
        rows={rows}
        numberOfWeeks={numberOfWeeks}
        onRowClick={onOpenRow}
      />

      <GanttLegend />

      {/* Inline row editor (sticky) */}
      {editingRowId && draft && (
        <RowEditor
          draft={draft}
          numberOfWeeks={numberOfWeeks}
          saving={savingDraft}
          onChange={onChangeRowDraft}
          onSave={onSaveRowDraft}
          onDelete={onDeleteRow}
          onCancel={onCancelRowEdit}
        />
      )}
    </div>
  )
}

// ─── Prose-style section editor (overview / text) ────────────────────────

function ProseSectionEditor({
  section, onPatch,
}: {
  section: ScheduleSection
  onPatch: (changes: { data?: unknown }) => void
}) {
  let initialHtml = ''
  if (section.data) {
    try { initialHtml = (JSON.parse(section.data) as { html?: string }).html ?? '' }
    catch { initialHtml = '' }
  }
  return (
    <div style={{ padding: '1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <FieldGroup label="Content">
        <TiptapDocEditor
          content={initialHtml}
          onChange={(html) => onPatch({ data: { html } })}
          placeholder="Start writing"
        />
      </FieldGroup>
    </div>
  )
}

// ─── Read-only preview for risk register + RACI ─────────────────────────

function PreviewOnlySection({
  section, numberOfWeeks,
}: { section: ScheduleSection; numberOfWeeks: number }) {
  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div
        style={{
          padding: '0.625rem 0.875rem',
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: 'var(--color-text-subtle)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          background: 'var(--color-bg-secondary)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}
        title="Edit this section type via the API or MCP for now"
      >
        Read-only preview · structured editor lands in a follow-up
      </div>
      <SectionRenderer section={section} numberOfWeeks={numberOfWeeks} />
    </div>
  )
}

// ─── Add section dropdown (left nav) ─────────────────────────────────────

function AddSectionMenu({
  open, onToggle, onClose, onPick,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  onPick: (type: SectionType) => void
}) {
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('[data-add-section]')) onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose])
  return (
    <div data-add-section style={{ position: 'relative' }}>
      <button onClick={onToggle} style={navAddBtn} className="nav-item-hover">
        <Plus size={12} />
        Add section
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 0.25rem)',
          left: 0,
          right: 0,
          minWidth: '17rem',
          maxHeight: '24rem',
          overflowY: 'auto',
          padding: '0.375rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 16px 40px -12px rgba(31, 44, 26, 0.18)',
          zIndex: 30,
        }}>
          {ADDABLE_SECTION_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => onPick(t.value)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                padding: '0.5rem 0.625rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: 'var(--color-text)',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              className="nav-item-hover"
            >
              <span style={{ flexShrink: 0, marginTop: '0.125rem', color: 'var(--color-text-subtle)' }}>
                {sectionIcon(t.value)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{t.label}</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}>{t.hint}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Toolbar button (used inside the gantt editor) ───────────────────────

function ToolbarButton({
  onClick, icon, children,
}: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center"
      style={toolbarBtn}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
    >
      {icon}
      {children}
    </button>
  )
}

// ─── Sticky row editor (kept from the old build, restyled) ──────────────

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
          {saving ? 'Saving' : 'Save row'}
        </button>
      </div>
    </div>
  )
}

