'use client'

import { useState, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import {
  Plus, Megaphone, RefreshCw, Calendar, Target,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Select, Textarea } from '@/components/tahi/input'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { apiPath } from '@/lib/api'

// -- Types --

interface Announcement {
  id: string
  title: string
  body: string
  type: string
  targetType: string
  targetValue: string | null
  targetIds: string | null
  publishedAt: string | null
  expiresAt: string | null
  createdAt: string
}

type Status = 'draft' | 'active' | 'expired'

// -- Helpers --

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    return new Date(dateStr).toLocaleDateString('en-NZ', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '--'
  }
}

const TYPE_TONE: Record<string, BadgeTone> = {
  info: 'info',
  warning: 'warning',
  success: 'positive',
  maintenance: 'neutral',
}

const TYPE_LABEL: Record<string, string> = {
  info: 'Info',
  warning: 'Warning',
  success: 'Success',
  maintenance: 'Maintenance',
}

const TARGET_LABELS: Record<string, string> = {
  all: 'All clients',
  plan_type: 'By plan',
  org: 'Specific clients',
}

const STATUS_TONE: Record<Status, BadgeTone> = {
  draft: 'neutral',
  active: 'positive',
  expired: 'warning',
}

const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  active: 'Active',
  expired: 'Expired',
}

function getStatus(a: Announcement): Status {
  const now = new Date().toISOString()
  if (!a.publishedAt) return 'draft'
  if (a.expiresAt && a.expiresAt < now) return 'expired'
  return 'active'
}

// -- Main Component --

export function AnnouncementsContent() {
  const { data: announcementsData, isLoading: loading, mutate: mutateAnnouncements } = useSWR<{ announcements: Announcement[] }>('/api/admin/announcements')
  const announcements = announcementsData?.announcements ?? []
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])

  const selected = useMemo(
    () => announcements.find(a => a.id === selectedId) ?? null,
    [announcements, selectedId],
  )

  // Filter defs — Status, Type, Target. All multiselect so the user
  // can hold multiple values in one chip without re-adding it.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'status',
      label: 'Status',
      kind: 'multiselect',
      options: [
        { value: 'draft',   label: 'Draft',   tone: 'neutral' },
        { value: 'active',  label: 'Active',  tone: 'positive' },
        { value: 'expired', label: 'Expired', tone: 'warning' },
      ],
    },
    {
      id: 'type',
      label: 'Type',
      kind: 'multiselect',
      options: [
        { value: 'info',        label: 'Info',        tone: 'info' },
        { value: 'warning',     label: 'Warning',     tone: 'warning' },
        { value: 'success',     label: 'Success',     tone: 'positive' },
        { value: 'maintenance', label: 'Maintenance', tone: 'neutral' },
      ],
    },
    {
      id: 'target',
      label: 'Audience',
      kind: 'multiselect',
      options: [
        { value: 'all',       label: 'All clients',      tone: 'brand' },
        { value: 'plan_type', label: 'By plan',          tone: 'teal' },
        { value: 'org',       label: 'Specific clients', tone: 'purple' },
      ],
    },
  ]), [])

  const selectedStatuses = useMemo(() => {
    return new Set(activeFilters.find(a => a.id === 'status')?.values ?? [])
  }, [activeFilters])
  const selectedTypes = useMemo(() => {
    return new Set(activeFilters.find(a => a.id === 'type')?.values ?? [])
  }, [activeFilters])
  const selectedTargets = useMemo(() => {
    return new Set(activeFilters.find(a => a.id === 'target')?.values ?? [])
  }, [activeFilters])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return announcements.filter(a => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(getStatus(a))) return false
      if (selectedTypes.size > 0 && !selectedTypes.has(a.type)) return false
      if (selectedTargets.size > 0 && !selectedTargets.has(a.targetType)) return false
      if (q) {
        const inTitle = a.title.toLowerCase().includes(q)
        const inBody = a.body.toLowerCase().includes(q)
        if (!inTitle && !inBody) return false
      }
      return true
    })
  }, [announcements, search, selectedStatuses, selectedTypes, selectedTargets])

  // Column defs for the DataTable. Sort by created date by default.
  const columns: DataTableColumn<Announcement>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      sortValue: r => r.title.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <Megaphone size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <span style={{
            fontWeight: 600,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{r.title}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      sortValue: r => r.type,
      width: '8rem',
      render: r => (
        <Badge tone={TYPE_TONE[r.type] ?? 'neutral'} variant="soft" size="sm">
          {TYPE_LABEL[r.type] ?? r.type}
        </Badge>
      ),
    },
    {
      key: 'target',
      header: 'Audience',
      sortable: true,
      sortValue: r => r.targetType,
      width: '11rem',
      render: r => (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          <Target size={11} aria-hidden="true" />
          {TARGET_LABELS[r.targetType] ?? r.targetType}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => getStatus(r),
      width: '7rem',
      render: r => {
        const s = getStatus(r)
        return (
          <Badge tone={STATUS_TONE[s]} variant="soft" size="sm" dot>
            {STATUS_LABEL[s]}
          </Badge>
        )
      },
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      sortValue: r => r.createdAt,
      width: '9rem',
      render: r => (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          <Calendar size={11} aria-hidden="true" />
          {formatDate(r.createdAt)}
        </span>
      ),
    },
  ]

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <h1 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            letterSpacing: '-0.015em',
          }}>Announcements</h1>
          <p style={{
            margin: '0.25rem 0 0',
            fontSize: '0.875rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}>
            Create and manage announcements for the client portal.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => void mutateAnnouncements()}
            iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </TahiButton>
          <TahiButton
            size="sm"
            onClick={() => setShowCreate(true)}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
          >
            New announcement
          </TahiButton>
        </div>
      </div>

      {/* Filter row */}
      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search title or content',
        }}
        size="sm"
      />

      {/* Table */}
      <Card padding="none">
        <DataTable<Announcement>
          ariaLabel="Announcements"
          columns={columns}
          rows={filtered}
          getRowId={r => r.id}
          defaultSort={{ key: 'createdAt', dir: 'desc' }}
          loading={loading}
          empty={
            <EmptyState
              icon={<Megaphone className="w-6 h-6" />}
              title={announcements.length === 0 ? 'No announcements yet' : 'No matches'}
              description={announcements.length === 0
                ? 'Create your first announcement to notify clients.'
                : 'Try clearing a filter or adjusting your search.'}
              action={
                announcements.length === 0 ? (
                  <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                    New announcement
                  </TahiButton>
                ) : undefined
              }
            />
          }
          onRowPreview={(r) => setSelectedId(r.id)}
        />
      </Card>

      {/* View slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelectedId(null)}
        icon={<Megaphone size={15} />}
        title={selected?.title ?? ''}
        subtitle={selected ? `Created ${formatDate(selected.createdAt)}` : undefined}
        maxWidth="48rem"
      >
        {selected && (
          <>
            <SlideOver.Body>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.875rem' }}>
                <Badge tone={TYPE_TONE[selected.type] ?? 'neutral'} variant="soft" size="sm">
                  {TYPE_LABEL[selected.type] ?? selected.type}
                </Badge>
                <Badge tone={STATUS_TONE[getStatus(selected)]} variant="soft" size="sm" dot>
                  {STATUS_LABEL[getStatus(selected)]}
                </Badge>
                <Badge tone="neutral" variant="soft" size="sm">
                  {TARGET_LABELS[selected.targetType] ?? selected.targetType}
                </Badge>
                {selected.targetValue && (
                  <Badge tone="teal" variant="soft" size="sm">
                    {selected.targetValue}
                  </Badge>
                )}
              </div>
              <div style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '0.875rem 1rem',
                fontSize: '0.875rem',
                color: 'var(--color-text)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.55,
              }}>
                {selected.body}
              </div>
              <div style={{
                marginTop: '0.875rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.375rem',
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
              }}>
                {selected.publishedAt && (
                  <span>Published: {formatDate(selected.publishedAt)}</span>
                )}
                {selected.expiresAt && (
                  <span>Expires: {formatDate(selected.expiresAt)}</span>
                )}
              </div>
            </SlideOver.Body>
            <SlideOver.Footer>
              <TahiButton variant="secondary" size="sm" onClick={() => setSelectedId(null)}>
                Close
              </TahiButton>
            </SlideOver.Footer>
          </>
        )}
      </SlideOver>

      {/* Create slide-over */}
      <CreateAnnouncementSlideOver
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => void mutateAnnouncements()}
      />

    </div>
  )
}

// -- Create slide-over --

function CreateAnnouncementSlideOver({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState('info')
  const [targetType, setTargetType] = useState('all')
  const [targetValue, setTargetValue] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [publish, setPublish] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset form whenever the slide-over re-opens.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setContent('')
    setType('info')
    setTargetType('all')
    setTargetValue('')
    setExpiresAt('')
    setPublish(false)
    setError('')
  }, [open])

  async function handleSubmit() {
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch(apiPath('/api/admin/announcements'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          type,
          targetType,
          targetValue: targetType === 'plan_type' ? targetValue : undefined,
          expiresAt: expiresAt || undefined,
          publish,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to create announcement')
      }

      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create announcement')
    } finally {
      setSaving(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.625rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-subtle)',
    marginBottom: '0.3125rem',
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<Plus size={15} />}
      title="New announcement"
      subtitle="Notify the client portal."
      maxWidth="48rem"
    >
      <SlideOver.Body>
        {error && (
          <div
            role="alert"
            aria-live="polite"
            style={{
              marginBottom: '0.75rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
              fontSize: '0.8125rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label htmlFor="ann-title" style={labelStyle}>Title</label>
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title"
              inputSize="md"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label htmlFor="ann-content" style={labelStyle}>Content</label>
            <Textarea
              id="ann-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="Write the announcement content..."
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label htmlFor="ann-type" style={labelStyle}>Type</label>
              <Select
                id="ann-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                style={{ width: '100%' }}
                options={[
                  { value: 'info',        label: 'Info' },
                  { value: 'warning',     label: 'Warning' },
                  { value: 'success',     label: 'Success' },
                  { value: 'maintenance', label: 'Maintenance' },
                ]}
              />
            </div>
            <div>
              <label htmlFor="ann-target" style={labelStyle}>Audience</label>
              <Select
                id="ann-target"
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                style={{ width: '100%' }}
                options={[
                  { value: 'all',       label: 'All clients' },
                  { value: 'plan_type', label: 'By plan type' },
                  { value: 'org',       label: 'Specific clients' },
                ]}
              />
            </div>
          </div>

          {targetType === 'plan_type' && (
            <div>
              <label htmlFor="ann-plan" style={labelStyle}>Plan</label>
              <Select
                id="ann-plan"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                style={{ width: '100%' }}
                options={[
                  { value: '',         label: 'Select plan' },
                  { value: 'maintain', label: 'Maintain' },
                  { value: 'scale',    label: 'Scale' },
                  { value: 'tune',     label: 'Tune' },
                  { value: 'launch',   label: 'Launch' },
                ]}
              />
            </div>
          )}

          <div>
            <label htmlFor="ann-expires" style={labelStyle}>Expiry date (optional)</label>
            <Input
              id="ann-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              inputSize="md"
              style={{ width: '100%' }}
            />
          </div>

          <label style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            color: 'var(--color-text)',
          }}>
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              style={{ accentColor: 'var(--color-brand)' }}
            />
            Publish immediately
          </label>
        </div>
      </SlideOver.Body>

      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          size="sm"
          onClick={handleSubmit}
          disabled={saving || !title.trim() || !content.trim()}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined}
        >
          {saving ? 'Creating...' : 'Create'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}
