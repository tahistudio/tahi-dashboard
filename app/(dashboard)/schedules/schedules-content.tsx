'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Calendar, Plus, Search, RefreshCw, Building2, Target, Trash2, ExternalLink, Eye,
  ChevronDown, Sparkles, FilePlus2,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { Input } from '@/components/tahi/input'
import { useToast } from '@/components/tahi/toast'

interface ScheduleListItem {
  id: string
  orgId: string | null
  dealId: string | null
  title: string
  subtitle: string | null
  preparedFor: string | null
  effectiveDate: string | null
  targetLaunchDate: string | null
  numberOfWeeks: number
  status: 'draft' | 'shared' | 'archived'
  publicShareToken: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  dealTitle: string | null
}

interface ScheduleTemplateOption {
  id: string
  name: string
  description: string | null
  updatedAt: string
}

type ScheduleStatus = ScheduleListItem['status']

const STATUS_STYLES: Record<ScheduleStatus, { bg: string; color: string; label: string }> = {
  draft: { bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', label: 'Draft' },
  shared: { bg: '#eff6ff', color: '#1e40af', label: 'Shared' },
  archived: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)', label: 'Archived' },
}

const STATUS_TABS: { value: 'all' | ScheduleStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'shared', label: 'Shared' },
  { value: 'archived', label: 'Archived' },
]

function statusKey(status: string): ScheduleStatus {
  return (status in STATUS_STYLES ? status : 'draft') as ScheduleStatus
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function SchedulesContent() {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<ScheduleListItem[]>([])
  const [templates, setTemplates] = useState<ScheduleTemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduleStatus>('all')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScheduleListItem | null>(null)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newMenuRef = useRef<HTMLDivElement | null>(null)

  // Click-outside handling for the New menu.
  useEffect(() => {
    if (!newMenuOpen) return
    function onDoc(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNewMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [newMenuOpen])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [schedulesRes, templatesRes] = await Promise.all([
        fetch(apiPath('/api/admin/schedules')),
        fetch(apiPath('/api/admin/schedules/templates')),
      ])
      if (schedulesRes.ok) {
        const data = await schedulesRes.json() as { items: ScheduleListItem[] }
        setItems(data.items ?? [])
      } else {
        setItems([])
      }
      if (templatesRes.ok) {
        const data = await templatesRes.json() as { items: ScheduleTemplateOption[] }
        setTemplates(data.items ?? [])
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const filtered = items.filter(s => {
    if (statusFilter !== 'all' && statusKey(s.status) !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!s.title.toLowerCase().includes(q) &&
          !(s.orgName ?? '').toLowerCase().includes(q) &&
          !(s.dealTitle ?? '').toLowerCase().includes(q) &&
          !(s.preparedFor ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  async function handleCreate(opts: { templateId?: string } = {}) {
    setCreating(true)
    setNewMenuOpen(false)
    try {
      const body: Record<string, unknown> = opts.templateId
        ? { templateId: opts.templateId }
        : {
            title: 'New project schedule',
            subtitle: 'PROJECT SCHEDULE, GANTT',
            numberOfWeeks: 12,
          }
      const res = await fetch(apiPath('/api/admin/schedules'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { id?: string }
      if (res.ok && data.id) {
        router.push(`/schedules/${data.id}`)
      } else {
        showToast('Failed to create schedule', 'error')
      }
    } catch {
      showToast('Failed to create schedule', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const res = await fetch(apiPath(`/api/admin/schedules/${deleteTarget.id}`), { method: 'DELETE' })
    if (res.ok) {
      setDeleteTarget(null)
      void fetchAll()
    } else {
      showToast('Failed to delete schedule', 'error')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedules"
        subtitle="Project gantts and timelines you can share with clients."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchAll} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <Link href="/schedules/templates">
          <TahiButton variant="secondary" size="sm">
            Templates
          </TahiButton>
        </Link>
        <div ref={newMenuRef} style={{ position: 'relative' }}>
          <TahiButton
            size="sm"
            onClick={() => {
              if (templates.length === 0) {
                void handleCreate()
              } else {
                setNewMenuOpen(v => !v)
              }
            }}
            disabled={creating}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
            iconRight={templates.length > 0 ? <ChevronDown className="w-3.5 h-3.5" /> : undefined}
          >
            {creating ? 'Creating...' : 'New schedule'}
          </TahiButton>
          {newMenuOpen && templates.length > 0 && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 0.375rem)',
                right: 0,
                minWidth: '17rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.625rem',
                boxShadow: '0 8px 24px rgba(31, 44, 26, 0.12)',
                padding: '0.375rem',
                zIndex: 50,
              }}
            >
              <button
                role="menuitem"
                onClick={() => void handleCreate()}
                className="w-full flex items-start gap-2 text-left px-3 py-2 rounded-md hover:bg-[var(--color-bg-secondary)] transition-colors"
              >
                <FilePlus2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--color-text-muted)]" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)]">Blank schedule</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">Empty 12-week gantt to start from scratch.</div>
                </div>
              </button>
              <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '0.375rem 0.25rem' }} />
              <div className="px-3 pt-1 pb-1.5 text-[0.625rem] font-bold tracking-wider uppercase text-[var(--color-text-subtle)]">
                From template
              </div>
              <div style={{ maxHeight: '14rem', overflowY: 'auto' }}>
                {templates.map(t => (
                  <button
                    key={t.id}
                    role="menuitem"
                    onClick={() => void handleCreate({ templateId: t.id })}
                    className="w-full flex items-start gap-2 text-left px-3 py-2 rounded-md hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--color-brand)]" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text)] truncate">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{t.description}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search schedules..."
            leadingIcon={<Search size={14} aria-hidden="true" />}
            style={{ width: '100%' }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{
                background: statusFilter === tab.value ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                color: statusFilter === tab.value ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : filtered.length === 0 ? (
        items.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-8 h-8 text-white" />}
            title="No schedules yet"
            description="Create one to map a project timeline you can share with clients."
            ctaLabel="New schedule"
            onCtaClick={() => void handleCreate()}
          />
        ) : (
          <EmptyState
            variant="inline"
            icon={<Calendar className="w-8 h-8" />}
            title="No schedules match your filters"
            description="Try clearing the search or changing the status tab."
          />
        )
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Org</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Deal</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Target launch</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const sty = STATUS_STYLES[statusKey(s.status)]
                return (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                    onClick={() => router.push(`/schedules/${s.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{s.title}</div>
                      {s.preparedFor && (
                        <div className="text-xs text-[var(--color-text-subtle)] mt-0.5 md:hidden">
                          for {s.preparedFor}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: sty.bg, color: sty.color }}
                      >
                        {sty.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden md:table-cell">
                      {s.orgId && s.orgName ? (
                        <Link
                          href={`/clients/${s.orgId}`}
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-dark)] transition-colors"
                        >
                          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate max-w-[14rem]">{s.orgName}</span>
                        </Link>
                      ) : <span className="text-[var(--color-text-subtle)]">-</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden md:table-cell">
                      {s.dealId && s.dealTitle ? (
                        <Link
                          href={`/pipeline/${s.dealId}`}
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-dark)] transition-colors"
                        >
                          <Target className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate max-w-[14rem]">{s.dealTitle}</span>
                        </Link>
                      ) : <span className="text-[var(--color-text-subtle)]">-</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        {formatDate(s.targetLaunchDate)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={e => e.stopPropagation()}
                      >
                        {s.publicShareToken && (
                          <a
                            href={`/dashboard/p/schedule/${s.publicShareToken}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                            aria-label="Open public viewer"
                            title="Open public viewer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <Link
                          href={`/schedules/${s.id}`}
                          className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                          aria-label="Preview"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={() => setDeleteTarget(s)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-subtle)] hover:text-red-500 transition-colors"
                          aria-label="Delete"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete schedule"
        description={deleteTarget ? `Delete "${deleteTarget.title}"? This removes all rows and sections. Cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
