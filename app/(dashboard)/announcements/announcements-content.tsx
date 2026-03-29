'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Megaphone, RefreshCw, X, ChevronDown, ChevronUp,
  Calendar, Target,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
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

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  info: { bg: 'var(--color-info-bg)', text: 'var(--color-info)' },
  warning: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)' },
  success: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
  maintenance: { bg: 'var(--status-draft-bg)', text: 'var(--status-draft-text)' },
}

const TARGET_LABELS: Record<string, string> = {
  all: 'All Clients',
  plan_type: 'By Plan',
  org: 'Specific Clients',
}

// -- Create Announcement Modal --

function CreateAnnouncementModal({
  onClose,
  onCreated,
}: {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-announcement-title"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 id="create-announcement-title" className="text-lg font-bold text-[var(--color-text)]">
            Create Announcement
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" role="alert" aria-live="polite" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              {error}
            </div>
          )}

          <div>
            <label htmlFor="ann-title" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Title
            </label>
            <input
              id="ann-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              placeholder="Announcement title"
            />
          </div>

          <div>
            <label htmlFor="ann-content" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Content
            </label>
            <textarea
              id="ann-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] resize-none"
              placeholder="Write the announcement content..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ann-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Type
              </label>
              <select
                id="ann-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="success">Success</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>

            <div>
              <label htmlFor="ann-target" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Target
              </label>
              <select
                id="ann-target"
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="all">All Clients</option>
                <option value="plan_type">By Plan Type</option>
                <option value="org">Specific Clients</option>
              </select>
            </div>
          </div>

          {targetType === 'plan_type' && (
            <div>
              <label htmlFor="ann-plan" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Plan Type
              </label>
              <select
                id="ann-plan"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="">Select plan</option>
                <option value="maintain">Maintain</option>
                <option value="scale">Scale</option>
                <option value="tune">Tune</option>
                <option value="launch">Launch</option>
              </select>
            </div>
          )}

          <div>
            <label htmlFor="ann-expires" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Expiry Date (optional)
            </label>
            <input
              id="ann-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              className="rounded border-[var(--color-border)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
            />
            <span className="text-sm text-[var(--color-text)]">Publish immediately</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose}>
              Cancel
            </TahiButton>
            <TahiButton type="submit" loading={saving}>
              Create
            </TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}

// -- Main Component --

export function AnnouncementsContent() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/announcements'))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { announcements: Announcement[] }
      setAnnouncements(data.announcements ?? [])
    } catch {
      setAnnouncements([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAnnouncements()
  }, [fetchAnnouncements])

  function getStatus(a: Announcement): { label: string; color: string; bg: string } {
    const now = new Date().toISOString()
    if (!a.publishedAt) {
      return { label: 'Draft', color: 'var(--status-draft-text)', bg: 'var(--status-draft-bg)' }
    }
    if (a.expiresAt && a.expiresAt < now) {
      return { label: 'Expired', color: 'var(--status-archived-text)', bg: 'var(--status-archived-bg)' }
    }
    return { label: 'Active', color: 'var(--color-success)', bg: 'var(--color-success-bg)' }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Announcements</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Create and manage announcements for the client portal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TahiButton variant="secondary" size="sm" onClick={fetchAnnouncements} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </TahiButton>
          <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
            Create Announcement
          </TahiButton>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="w-8 h-8 text-white" />}
          title="No announcements yet"
          description="Create your first announcement to notify clients."
          ctaLabel="Create Announcement"
          onCtaClick={() => setShowCreate(true)}
        />
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          {announcements.map((a, i) => {
            const status = getStatus(a)
            const typeColors = TYPE_COLORS[a.type] ?? TYPE_COLORS.info
            const isExpanded = expandedId === a.id

            return (
              <div
                key={a.id}
                className={i < announcements.length - 1 ? 'border-b border-[var(--color-border-subtle)]' : ''}
              >
                {/* Row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : a.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">
                      {a.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        {formatDate(a.createdAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Target className="w-3 h-3" aria-hidden="true" />
                        {TARGET_LABELS[a.targetType] ?? a.targetType}
                      </span>
                    </div>
                  </div>

                  {/* Type badge */}
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: typeColors.bg, color: typeColors.text }}
                  >
                    {a.type}
                  </span>

                  {/* Status badge */}
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: status.bg, color: status.color }}
                  >
                    {status.label}
                  </span>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-5 pb-4">
                    <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 text-sm text-[var(--color-text)] whitespace-pre-wrap">
                      {a.body}
                    </div>
                    {a.expiresAt && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-2">
                        Expires: {formatDate(a.expiresAt)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateAnnouncementModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchAnnouncements}
        />
      )}
    </div>
  )
}
